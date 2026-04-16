import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import type { ExecutionResult } from '../sandbox/types';
import { log } from '../utils/logger';

export interface WindowsBashExecutionParams {
  sessionId: string;
  command: string;
  cwd: string;
  timeout?: number;
  signal?: AbortSignal;
  stdin?: string;
}

export interface WindowsBashExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  backend: 'wsl' | 'git-bash';
  timedOut?: boolean;
}

function detectConfiguredBashFromPiSettings(): string | null {
  const settingsPath = path.join(os.homedir(), '.pi', 'agent', 'settings.json');

  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }

    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as { shellPath?: unknown };
    const shellPath = typeof parsed.shellPath === 'string' ? parsed.shellPath.trim() : '';
    if (!shellPath) {
      return null;
    }

    if (fs.existsSync(shellPath)) {
      return shellPath;
    }
  } catch {
    // ignore invalid or unreadable settings
  }

  return null;
}

function detectGitBashFromPath(): string | null {
  const pathValue = process.env.PATH || '';
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const candidates = pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => [
      `${entry.replace(/[\\/]+$/, '')}\\bash.exe`,
      `${entry.replace(/[\\/]+$/, '')}\\..\\bin\\bash.exe`,
    ]);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore invalid path candidates
    }
  }

  return null;
}

export function detectGitBash(): string | null {
  const configuredShellPath = detectConfiguredBashFromPiSettings();
  if (configuredShellPath) {
    return configuredShellPath;
  }

  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return detectGitBashFromPath();
}

function shellEscapeSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function formatExecutionResult(
  result: ExecutionResult,
  backend: 'wsl' | 'git-bash',
  timedOut = false
): WindowsBashExecutionResult {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    backend,
    timedOut,
  };
}

async function executeViaSandbox(
  command: string,
  cwd: string,
  timeoutMs: number,
  backend: 'wsl',
  signal?: AbortSignal
): Promise<WindowsBashExecutionResult> {
  const sandbox = getSandboxAdapter();

  return await new Promise<WindowsBashExecutionResult>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (abortHandler) {
        signal?.removeEventListener('abort', abortHandler);
      }
    };

    const finish = (result: WindowsBashExecutionResult) => {
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
      finish({
        stdout: '',
        stderr: `Command timed out after ${timeoutMs}ms`,
        exitCode: 124,
        backend,
        timedOut: true,
      });
    }, timeoutMs);

    const abortHandler = signal ? () => fail(new Error('Command aborted')) : undefined;

    if (abortHandler) {
      signal?.addEventListener('abort', abortHandler, { once: true });
    }

    sandbox
      .executeCommand(command, cwd, {
        OPEN_COWORK_BASH_BACKEND: backend,
      })
      .then((result) => {
        const timedOut = !result.success && /timed out|timeout/i.test(result.stderr);
        if (timedOut) {
          log(`[WindowsBashExecutor] ${backend} execution timed out after ${timeoutMs}ms`);
        }
        finish(formatExecutionResult(result, backend, timedOut));
      })
      .catch((error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

async function executeViaGitBash({
  gitBashPath,
  command,
  cwd,
  timeout,
  signal,
  stdin,
}: {
  gitBashPath: string;
  command: string;
  cwd: string;
  timeout: number;
  signal?: AbortSignal;
  stdin?: string;
}): Promise<WindowsBashExecutionResult> {
  const bashCommand = `cd ${shellEscapeSingleQuoted(cwd.replace(/\\/g, '/'))} && ${command}`;

  return await new Promise<WindowsBashExecutionResult>((resolve, reject) => {
    const child = spawn(gitBashPath, ['-lc', bashCommand], {
      cwd,
      env: {
        ...process.env,
        OPEN_COWORK_BASH_BACKEND: 'git-bash',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (abortHandler) signal?.removeEventListener('abort', abortHandler);
    };

    const finish = (result: WindowsBashExecutionResult) => {
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
    }, timeout);

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
        stderr: timedOut ? `${stderr}${stderr ? '\n' : ''}Command timed out after ${timeout}ms` : stderr,
        exitCode: timedOut ? 124 : (code ?? 1),
        backend: 'git-bash',
        timedOut,
      });
    });

    if (stdin) {
      child.stdin?.write(stdin);
    }
    child.stdin?.end();
  });
}

export async function executeWindowsBash({
  sessionId,
  command,
  cwd,
  timeout = 120,
  signal,
  stdin,
}: WindowsBashExecutionParams): Promise<WindowsBashExecutionResult> {
  if (process.platform !== 'win32') {
    throw new Error('executeWindowsBash should only be used on Windows');
  }

  const timeoutMs = Math.max(1, timeout) * 1000;
  const sandbox = getSandboxAdapter();

  if (sandbox.isWSL && sandbox.wslStatus?.distro) {
    log(
      `[WindowsBashExecutor] Session ${sessionId}: executing via WSL (${sandbox.wslStatus.distro})`
    );

    if (stdin) {
      const escapedInput = shellEscapeSingleQuoted(stdin);
      const wrappedCommand = `printf %s ${escapedInput} | (${command})`;
      return await executeViaSandbox(wrappedCommand, cwd, timeoutMs, 'wsl', signal);
    }

    return await executeViaSandbox(command, cwd, timeoutMs, 'wsl', signal);
  }

  const gitBashPath = detectGitBash();
  if (gitBashPath) {
    log(`[WindowsBashExecutor] Session ${sessionId}: executing via Git Bash (${gitBashPath})`);
    return await executeViaGitBash({
      gitBashPath,
      command,
      cwd,
      timeout: timeoutMs,
      signal,
      stdin,
    });
  }

  const tried = [
    'WSL sandbox',
    `${path.join(os.homedir(), '.pi', 'agent', 'settings.json')} (optional shellPath override)`,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'PATH lookup for bash.exe',
  ].join('\n');

  throw new Error(
    `No executable bash environment available on Windows.\nTried:\n${tried}\n\nRecommended fixes:\n- Enable WSL2 in Open Cowork settings\n- Install Git for Windows`
  );
}
