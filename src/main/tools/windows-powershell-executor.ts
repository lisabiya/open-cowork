import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { resolvePreferredWindowsShell } from '../runtime/runtime-resolver';

export interface PowerShellExecutionParams {
  script: string;
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface PowerShellExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  shellPath: string;
  shellFlavor: 'pwsh' | 'powershell' | 'cmd';
  timedOut?: boolean;
}

export async function executeWindowsPowerShell({
  script,
  cwd,
  timeoutMs = 60000,
  env,
  signal,
}: PowerShellExecutionParams): Promise<PowerShellExecutionResult> {
  if (process.platform !== 'win32') {
    throw new Error('executeWindowsPowerShell should only be used on Windows');
  }

  const resolvedShell = resolvePreferredWindowsShell();
  if (!resolvedShell) {
    throw new Error('No Windows shell runtime available');
  }

  const flavor = resolvedShell.flavor;
  if (flavor !== 'pwsh' && flavor !== 'powershell') {
    throw new Error('PowerShell runtime not available; refusing to run PowerShell script via cmd.exe');
  }

  const shellFlavor = flavor;

  const scriptPath = path.join(os.tmpdir(), `oc-pwsh-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
  fs.writeFileSync(scriptPath, script, 'utf-8');

  return await new Promise<PowerShellExecutionResult>((resolve, reject) => {
    const child = spawn(
      resolvedShell.path,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        cwd,
        env: {
          ...process.env,
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (abortHandler) {
        signal?.removeEventListener('abort', abortHandler);
      }
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        // best-effort cleanup
      }
    };

    const finish = (result: PowerShellExecutionResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    const abortHandler = signal
      ? () => {
          child.kill();
          fail(new Error('Command aborted'));
        }
      : undefined;

    if (abortHandler) {
      signal?.addEventListener('abort', abortHandler, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      fail(error);
    });

    child.on('close', (code) => {
      finish({
        stdout,
        stderr: timedOut ? `${stderr}${stderr ? '\n' : ''}Command timed out after ${timeoutMs}ms` : stderr,
        exitCode: timedOut ? 124 : (code ?? 1),
        shellPath: resolvedShell.path,
        shellFlavor,
        timedOut,
      });
    });
  });
}
