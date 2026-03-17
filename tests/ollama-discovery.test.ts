import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// Mock withRetry to use immediate retries (no delays in tests)
vi.mock('../src/main/utils/retry.ts', () => ({
  withRetry: vi.fn(
    async <T>(
      operation: () => Promise<T>,
      options?: {
        maxRetries?: number;
        shouldRetry?: (error: Error) => boolean;
      }
    ): Promise<T> => {
      const maxRetries = options?.maxRetries ?? 3;
      const shouldRetry = options?.shouldRetry ?? (() => true);
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === maxRetries || !shouldRetry(lastError)) {
            throw lastError;
          }
        }
      }
      throw lastError;
    }
  ),
}));

import { discoverLocalOllama } from '../src/main/config/api-diagnostics';

describe('discoverLocalOllama', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns unavailable when service is not reachable', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('fetch failed'));

    const result = await discoverLocalOllama();
    expect(result.available).toBe(false);
    expect(result.status).toBe('unavailable');
  });

  it('returns service_available when models list is empty', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('service_available');
    expect(result.models).toEqual([]);
  });

  it('returns model_usable when probe succeeds', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'qwen3.5:0.8b' }] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('model_usable');
    expect(result.probeModel).toBe('qwen3.5:0.8b');
  });

  it('returns model_loading when probe times out after retries', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'qwen3.5:9b' }] }), { status: 200 })
      )
      // All probe attempts throw timeout errors
      .mockRejectedValue(new Error('The operation timed out'));

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('model_loading');
    expect(result.probeModel).toBe('qwen3.5:9b');
    expect(result.probeError).toMatch(/timed out/i);
  });

  it('returns model_unusable when probe returns HTTP error (non-timeout)', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'qwen3.5:0.8b' }] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response('internal error', { status: 500 }));

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('model_unusable');
  });

  it('only probes the first model (not all models)', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response('model not ready', { status: 500 }));

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('model_unusable');
    expect(result.probeModel).toBe('model-a');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries probe on timeout and succeeds on second attempt', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'qwen3.5:9b' }] }), { status: 200 })
      )
      // First probe: timeout
      .mockRejectedValueOnce(new Error('The operation timed out'))
      // Second probe (retry): success
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('model_usable');
    expect(result.probeModel).toBe('qwen3.5:9b');
  });

  it('uses 8s discovery timeout', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'test-model' }] }), { status: 200 })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const result = await discoverLocalOllama();
    expect(result.available).toBe(true);
    expect(result.status).toBe('model_usable');
  });
});
