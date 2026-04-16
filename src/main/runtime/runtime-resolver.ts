import * as fs from 'fs';
import * as path from 'path';

export type RuntimeSource = 'bundled' | 'configured' | 'workspace' | 'system' | 'wsl' | 'unknown';
export type RuntimeKind = 'shell' | 'node' | 'python' | 'git';
export type ShellFlavor = 'pwsh' | 'powershell' | 'bash' | 'cmd' | 'unknown';

export interface ResolvedRuntime {
  kind: RuntimeKind;
  path: string;
  source: RuntimeSource;
  flavor?: ShellFlavor;
  warnings: string[];
}

function splitPathEntries(pathValue: string | undefined): string[] {
  if (!pathValue) return [];
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return pathValue
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function findExecutableInPath(executableNames: string[]): string | null {
  const entries = splitPathEntries(process.env.PATH);
  for (const entry of entries) {
    for (const executableName of executableNames) {
      const candidate = path.join(entry, executableName);
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore invalid path entry
      }
    }
  }
  return null;
}

function resolveExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore invalid candidate
    }
  }
  return null;
}

export function isWindowsStoreAliasPath(executablePath: string | null | undefined): boolean {
  if (!executablePath) return false;
  return /\\AppData\\Local\\Microsoft\\WindowsApps\\/i.test(executablePath);
}

export function resolvePreferredWindowsShell(): ResolvedRuntime | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const warnings: string[] = [];
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pwsh =
    resolveExisting([
      path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      path.join(programFiles, 'PowerShell', '6', 'pwsh.exe'),
    ]) || findExecutableInPath(['pwsh.exe', 'pwsh']);

  if (pwsh) {
    return {
      kind: 'shell',
      path: pwsh,
      source: 'system',
      flavor: 'pwsh',
      warnings,
    };
  }

  const systemRoot = process.env['SystemRoot'] || 'C:\\Windows';
  const powershell =
    resolveExisting([
      path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ]) || findExecutableInPath(['powershell.exe', 'powershell']);

  if (powershell) {
    warnings.push('PowerShell 7 not found; falling back to Windows PowerShell 5.1.');
    return {
      kind: 'shell',
      path: powershell,
      source: 'system',
      flavor: 'powershell',
      warnings,
    };
  }

  const cmd =
    resolveExisting([path.join(systemRoot, 'System32', 'cmd.exe')]) ||
    process.env.COMSPEC ||
    'cmd.exe';

  warnings.push('PowerShell not found; falling back to cmd.exe compatibility mode.');
  return {
    kind: 'shell',
    path: cmd,
    source: 'system',
    flavor: 'cmd',
    warnings,
  };
}

export function resolvePythonFromPath(): ResolvedRuntime | null {
  const executableName = process.platform === 'win32' ? 'python.exe' : 'python3';
  const found = findExecutableInPath([executableName, 'python']);
  if (!found) return null;

  const warnings: string[] = [];
  if (process.platform === 'win32' && isWindowsStoreAliasPath(found)) {
    warnings.push('Resolved python points to WindowsApps alias and may not be executable in agent sub-processes.');
  }

  return {
    kind: 'python',
    path: found,
    source: 'system',
    warnings,
  };
}

export function resolveNodeFromPath(): ResolvedRuntime | null {
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
  const found = findExecutableInPath([executableName, 'node']);
  if (!found) return null;

  return {
    kind: 'node',
    path: found,
    source: 'system',
    warnings: [],
  };
}

export interface RuntimeDiagnosticsSnapshot {
  shell: ResolvedRuntime | null;
  python: ResolvedRuntime | null;
  node: ResolvedRuntime | null;
}

export function collectRuntimeDiagnostics(): RuntimeDiagnosticsSnapshot {
  return {
    shell: process.platform === 'win32' ? resolvePreferredWindowsShell() : null,
    python: resolvePythonFromPath(),
    node: resolveNodeFromPath(),
  };
}
