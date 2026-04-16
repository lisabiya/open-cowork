import { platform } from 'os';
import { resolvePreferredWindowsShell } from '../runtime/runtime-resolver';

/**
 * Returns the appropriate shell for the current platform.
 * Windows: prefers PowerShell 7, then Windows PowerShell, then cmd.exe
 * Unix: uses SHELL env var or falls back to /bin/bash
 */
export function getDefaultShell(): string {
  if (platform() === 'win32') {
    return resolvePreferredWindowsShell()?.path || process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

/**
 * Returns shell execution arguments for running a command string.
 * Windows PowerShell/pwsh: ['-NoProfile', '-NonInteractive', '-Command', command]
 * Windows cmd: ['/c', command]
 * Unix bash/zsh: ['-c', command]
 */
export function getShellArgs(command: string): [string, string[]] {
  const shell = getDefaultShell();
  if (platform() === 'win32') {
    if (/cmd\.exe$/i.test(shell)) {
      return [shell, ['/c', command]];
    }
    return [shell, ['-NoProfile', '-NonInteractive', '-Command', command]];
  }
  return [shell, ['-c', command]];
}
