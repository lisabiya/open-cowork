import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedGatewayProfile } from '../src/main/claude/unified-gateway-resolver';
import {
  buildProfileSignature,
  ClaudeProxyManager,
} from '../src/main/proxy/claude-proxy-manager';

const profile: UnifiedGatewayProfile = {
  upstreamKind: 'openai',
  upstreamBaseUrl: 'https://api.duckcoding.ai/v1',
  upstreamApiKey: 'sk-test',
  model: 'gpt-5.3-codex',
  requiresProxy: true,
  provider: 'custom',
  customProtocol: 'openai',
};

const runtimeState = {
  baseUrl: 'http://127.0.0.1:18082',
  host: '127.0.0.1',
  port: 18082,
  upstreamKind: 'openai',
  signature: 'test-signature',
  sdkApiKey: 'sk-ant-local-proxy',
  pid: 9999,
} as const;

function createManagedState(signature: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ...runtimeState,
    signature,
    process: {
      exitCode: null,
      killed: false,
      kill: vi.fn(),
      once: vi.fn(),
    },
    logs: [],
    startedAt: Date.now(),
    lastUsedAt: Date.now(),
    leaseCount: 0,
    ...overrides,
  };
}

type ManagerInternals = {
  activeStates: Map<string, Record<string, unknown>>;
  latestSignature: string | null;
  startInternal: (...args: unknown[]) => Promise<Record<string, unknown>>;
  pruneStaleStates: (keepSet: Set<string>) => Promise<void>;
};

function getInternals(manager: ClaudeProxyManager): ManagerInternals {
  return manager as unknown as ManagerInternals;
}

describe('ClaudeProxyManager pool management', () => {
  let manager: ClaudeProxyManager;

  beforeEach(() => {
    delete process.env.COWORK_DISABLE_CLAUDE_PROXY;
    manager = new ClaudeProxyManager();
  });

  afterEach(() => {
    delete process.env.COWORK_DISABLE_CLAUDE_PROXY;
    vi.restoreAllMocks();
  });

  it('reuses existing proxy when ensureReady is called twice with the same profile', async () => {
    const signature = buildProfileSignature(profile);
    const state = createManagedState(signature);
    const startInternalSpy = vi
      .spyOn(manager as never, 'startInternal' as never)
      .mockResolvedValue(state as never);

    // Stub pruneStaleStates so it doesn't interfere
    vi.spyOn(manager as never, 'pruneStaleStates' as never).mockResolvedValue(undefined as never);

    // First call — should invoke startInternal to create the proxy
    await manager.ensureReady(profile);
    expect(startInternalSpy).toHaveBeenCalledTimes(1);

    // Second call — should reuse the existing proxy (exitCode === null)
    await manager.ensureReady(profile);
    expect(startInternalSpy).toHaveBeenCalledTimes(1); // still 1, no new spawn
  });

  it('prunes a stale proxy whose lastUsedAt exceeds the TTL', async () => {
    const STALE_TTL_MS = 10 * 60 * 1000; // mirrors PROXY_STALE_TTL_MS in source
    const staleSignature = 'stale-sig';
    const staleState = createManagedState(staleSignature, {
      lastUsedAt: Date.now() - (STALE_TTL_MS + 1000), // 1 s past TTL
      leaseCount: 0,
    });

    const internals = getInternals(manager);
    internals.activeStates.set(staleSignature, staleState);

    const stopStateInternalSpy = vi
      .spyOn(manager as never, 'stopStateInternal' as never)
      .mockResolvedValue(undefined as never);

    await (manager as never)['pruneStaleStates'](new Set<string>());

    expect(stopStateInternalSpy).toHaveBeenCalledTimes(1);
    expect(stopStateInternalSpy).toHaveBeenCalledWith(staleState);
    expect(internals.activeStates.has(staleSignature)).toBe(false);
  });

  it('spawns a new proxy when the existing process has crashed (exitCode !== null)', async () => {
    const signature = buildProfileSignature(profile);
    // Pre-populate with a crashed proxy
    const crashedState = createManagedState(signature, {
      process: {
        exitCode: 1, // crashed
        killed: false,
        kill: vi.fn(),
        once: vi.fn(),
      },
    });
    const internals = getInternals(manager);
    internals.activeStates.set(signature, crashedState);
    internals.latestSignature = signature;

    const freshState = createManagedState(signature);
    const startInternalSpy = vi
      .spyOn(manager as never, 'startInternal' as never)
      .mockResolvedValue(freshState as never);
    vi.spyOn(manager as never, 'pruneStaleStates' as never).mockResolvedValue(undefined as never);

    await manager.ensureReady(profile);

    // Because the existing state has exitCode !== null, ensureReady must call startInternal
    expect(startInternalSpy).toHaveBeenCalledTimes(1);
  });

  it('returns immediately from ensureReady on the happy path without awaiting pruneStaleStates', async () => {
    const signature = buildProfileSignature(profile);
    const state = createManagedState(signature);
    const internals = getInternals(manager);
    internals.activeStates.set(signature, state);
    internals.latestSignature = signature;

    // Make pruneStaleStates slow — if ensureReady awaited it, the test would take > 500ms
    let pruneResolveFn: (() => void) | undefined;
    const prunePromise = new Promise<void>((resolve) => {
      pruneResolveFn = resolve;
    });
    const pruneSpy = vi
      .spyOn(manager as never, 'pruneStaleStates' as never)
      .mockReturnValue(prunePromise as never);

    const start = Date.now();
    const result = await manager.ensureReady(profile);
    const elapsed = Date.now() - start;

    // ensureReady should resolve nearly instantly because it uses `void this.pruneStaleStates()`
    expect(elapsed).toBeLessThan(200);
    expect(result).toBeDefined();
    expect(result.signature).toBe(signature);

    // pruneStaleStates was called but NOT awaited
    expect(pruneSpy).toHaveBeenCalledTimes(1);

    // Clean up the dangling promise
    pruneResolveFn!();
  });
});
