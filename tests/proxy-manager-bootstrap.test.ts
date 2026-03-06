import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * These tests exercise `ClaudeProxyManager.ensurePythonRuntime()` — the private
 * method that bootstraps a Python venv and pip-installs proxy dependencies.
 *
 * We mock `node:child_process` (execFileSync) and `node:fs` so no real
 * processes or file-system mutations occur.
 */

// ---------------------------------------------------------------------------
// Module-level mocks — vi.mock factories are hoisted, so we cannot reference
// variables declared in this file. Instead, we mock with `async importOriginal`
// and then grab the mock handles via `vi.mocked()` inside tests.
// ---------------------------------------------------------------------------

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    execFileSync: vi.fn().mockReturnValue(Buffer.from('')),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const actualDefault = actual.default as Record<string, unknown>;
  return {
    ...actual,
    default: {
      ...actualDefault,
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockReturnValue(''),
      mkdirSync: vi.fn().mockReturnValue(undefined),
      writeFileSync: vi.fn().mockReturnValue(undefined),
    },
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(''),
    mkdirSync: vi.fn().mockReturnValue(undefined),
    writeFileSync: vi.fn().mockReturnValue(undefined),
  };
});

// Bypass bundled runtime so ensurePythonRuntime always takes the venv path.
vi.mock('../src/main/proxy/claude-proxy-manager', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resolveBundledPythonRuntime: vi.fn().mockReturnValue(null),
  };
});

// Now import the modules — mocks are already in place.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import {
  ClaudeProxyManager,
  PROXY_REQUIREMENTS_FINGERPRINT,
  PROXY_RUNTIME_VERSION_FILENAME,
} from '../src/main/proxy/claude-proxy-manager';

// ---------------------------------------------------------------------------
// Derived paths (match what the production code computes)
// ---------------------------------------------------------------------------

const runtimeRoot = path.join(os.tmpdir(), 'open-cowork', 'claude-proxy-runtime');
const venvPython =
  process.platform === 'win32'
    ? path.join(runtimeRoot, 'venv', 'Scripts', 'python.exe')
    : path.join(runtimeRoot, 'venv', 'bin', 'python3');
const markerFile = path.join(runtimeRoot, PROXY_RUNTIME_VERSION_FILENAME);

// Typed handles to the mocked functions.
const execFileSyncMock = vi.mocked(execFileSync);
const existsSyncMock = vi.mocked(fs.existsSync);
const readFileSyncMock = vi.mocked(fs.readFileSync);
const mkdirSyncMock = vi.mocked(fs.mkdirSync);
const writeFileSyncMock = vi.mocked(fs.writeFileSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function callEnsurePythonRuntime(manager: ClaudeProxyManager, vendorRoot = '/fake/vendor') {
  return (manager as any).ensurePythonRuntime(vendorRoot);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensurePythonRuntime', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset().mockReturnValue(Buffer.from(''));
    existsSyncMock.mockReset().mockReturnValue(false);
    readFileSyncMock.mockReset().mockReturnValue('' as any);
    mkdirSyncMock.mockReset().mockReturnValue(undefined as any);
    writeFileSyncMock.mockReset().mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. Existing valid venv → skips creation and pip install
  // -----------------------------------------------------------------------
  it('skips venv creation and pip install when version marker matches', async () => {
    existsSyncMock.mockImplementation((p: any) => {
      const ps = String(p);
      if (ps === venvPython) return true;
      if (ps === markerFile) return true;
      return false;
    });
    readFileSyncMock.mockImplementation((p: any) => {
      if (String(p) === markerFile) return PROXY_REQUIREMENTS_FINGERPRINT;
      return '' as any;
    });

    const manager = new ClaudeProxyManager();
    const result = await callEnsurePythonRuntime(manager);

    expect(result.source).toBe('venv');
    expect(result.python).toBe(venvPython);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 2. venv creation fails → propagates a descriptive error
  // -----------------------------------------------------------------------
  it('propagates a descriptive error when venv creation fails', async () => {
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReturnValue('' as any);

    const venvError = new Error('Command failed: python3 -m venv');
    (venvError as any).status = 1;
    (venvError as any).stderr = Buffer.from('No module named venv');

    // resolveSystemPythonCandidate also calls execFileSync to probe for
    // python candidates, so we need to let those succeed but throw when
    // the actual venv creation step runs (args include '-m', 'venv').
    execFileSyncMock.mockImplementation((_cmd: any, args: any) => {
      if (Array.isArray(args) && args.includes('venv')) {
        throw venvError;
      }
      return Buffer.from('');
    });

    const manager = new ClaudeProxyManager();
    await expect(callEnsurePythonRuntime(manager)).rejects.toThrow(/venv/i);
  });

  // -----------------------------------------------------------------------
  // 3. pip install times out → error mentions timeout
  // -----------------------------------------------------------------------
  it('surfaces a timeout error when pip install exceeds time limit', async () => {
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReturnValue('' as any);

    // Let python resolution and venv creation succeed, but throw ETIMEDOUT
    // on the first pip command (args include 'pip').
    let pipCallCount = 0;
    execFileSyncMock.mockImplementation((_cmd: any, args: any) => {
      if (Array.isArray(args) && args.includes('pip')) {
        pipCallCount += 1;
        const err = new Error('ETIMEDOUT') as any;
        err.killed = true;
        err.signal = 'SIGTERM';
        err.code = 'ETIMEDOUT';
        throw err;
      }
      return Buffer.from('');
    });

    const manager = new ClaudeProxyManager();
    await expect(callEnsurePythonRuntime(manager)).rejects.toThrow(/ETIMEDOUT/);
  });

  // -----------------------------------------------------------------------
  // 4. Concurrent calls → both succeed without corrupting state
  // -----------------------------------------------------------------------
  it('handles concurrent calls without corrupting state', async () => {
    existsSyncMock.mockReturnValue(false);
    readFileSyncMock.mockReturnValue('' as any);
    execFileSyncMock.mockReturnValue(Buffer.from(''));

    const manager = new ClaudeProxyManager();

    const [r1, r2] = await Promise.all([
      callEnsurePythonRuntime(manager, '/vendor/a'),
      callEnsurePythonRuntime(manager, '/vendor/b'),
    ]);

    expect(r1.source).toBe('venv');
    expect(r1.python).toBe(venvPython);
    expect(r2.source).toBe('venv');
    expect(r2.python).toBe(venvPython);

    // Each call goes through: python resolution probes + venv create + pip upgrade
    // + pip install. With instance-level caching, the second concurrent call
    // returns the cached result from the first, so we expect at least 3 core calls.
    expect(execFileSyncMock.mock.calls.length).toBeGreaterThanOrEqual(3);

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      markerFile,
      PROXY_REQUIREMENTS_FINGERPRINT,
      'utf-8'
    );
  });
});
