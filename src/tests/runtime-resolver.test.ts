import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('runtime-resolver', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalPath = process.env.PATH;
  const originalProgramFiles = process.env.ProgramFiles;
  const originalSystemRoot = process.env.SystemRoot;
  let tmpDir: string;

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    process.env.PATH = originalPath;
    process.env.ProgramFiles = originalProgramFiles;
    process.env.SystemRoot = originalSystemRoot;
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('prefers PowerShell 7 on Windows when available', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    });

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-runtime-'));
    const shellDir = path.join(tmpDir, 'pwsh-bin');
    fs.mkdirSync(shellDir, { recursive: true });
    fs.writeFileSync(path.join(shellDir, 'pwsh.exe'), '');

    process.env.ProgramFiles = path.join(tmpDir, 'missing-program-files');
    process.env.SystemRoot = path.join(tmpDir, 'missing-system-root');
    process.env.PATH = shellDir;

    const { resolvePreferredWindowsShell } = await import('../main/runtime/runtime-resolver');
    const resolved = resolvePreferredWindowsShell();

    expect(resolved?.flavor).toBe('pwsh');
    expect(resolved?.path).toBe(path.join(shellDir, 'pwsh.exe'));
    expect(resolved?.warnings).toEqual([]);
  });

  it('falls back to Windows PowerShell when pwsh is unavailable', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    });

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-runtime-'));
    const systemRoot = path.join(tmpDir, 'Windows');
    const powershellDir = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
    fs.mkdirSync(powershellDir, { recursive: true });
    fs.writeFileSync(path.join(powershellDir, 'powershell.exe'), '');

    process.env.ProgramFiles = path.join(tmpDir, 'missing-program-files');
    process.env.SystemRoot = systemRoot;
    process.env.PATH = '';

    const { resolvePreferredWindowsShell } = await import('../main/runtime/runtime-resolver');
    const resolved = resolvePreferredWindowsShell();

    expect(resolved?.flavor).toBe('powershell');
    expect(resolved?.path).toBe(path.join(powershellDir, 'powershell.exe'));
    expect(resolved?.warnings[0]).toContain('PowerShell 7 not found');
  });

  it('detects WindowsApps python alias as warning', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      writable: true,
      configurable: true,
    });

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-runtime-'));
    const windowsApps = path.join(
      tmpDir,
      'Users',
      'user',
      'AppData',
      'Local',
      'Microsoft',
      'WindowsApps'
    );
    fs.mkdirSync(windowsApps, { recursive: true });
    fs.writeFileSync(path.join(windowsApps, 'python.exe'), '');

    process.env.PATH = windowsApps;

    const { resolvePythonFromPath } = await import('../main/runtime/runtime-resolver');
    const resolved = resolvePythonFromPath();

    expect(resolved?.path).toBe(path.join(windowsApps, 'python.exe'));
    expect(resolved?.warnings[0]).toContain('WindowsApps alias');
  });
});
