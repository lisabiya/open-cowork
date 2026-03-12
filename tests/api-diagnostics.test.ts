import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const dnsLookup = vi.fn();
  const tcpConnect = vi.fn();
  const tlsConnect = vi.fn();
  const openaiModelsList = vi.fn();

  return {
    dnsLookup,
    tcpConnect,
    tlsConnect,
    openaiModelsList,
  };
});

vi.mock('dns', () => ({
  promises: {
    lookup: mocks.dnsLookup,
  },
}));

vi.mock('net', () => ({
  createConnection: mocks.tcpConnect,
  isIP: (input: string) => {
    if (input === '127.0.0.1') return 4;
    if (input === '::1') return 6;
    return 0;
  },
}));

vi.mock('tls', () => ({
  connect: mocks.tlsConnect,
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    models = { list: mocks.openaiModelsList };
    chat = { completions: { create: vi.fn() } };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: vi.fn(),
}));

vi.mock('../src/main/config/config-store', () => ({
  PROVIDER_PRESETS: {
    openai: { baseUrl: 'https://api.openai.com/v1' },
    anthropic: { baseUrl: 'https://api.anthropic.com' },
    ollama: { baseUrl: 'http://localhost:11434/v1' },
    openrouter: { baseUrl: 'https://openrouter.ai/api' },
  },
}));

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
}));

import { runDiagnostics } from '../src/main/config/api-diagnostics';

describe('runDiagnostics TLS step', () => {
  beforeEach(() => {
    mocks.dnsLookup.mockReset();
    mocks.tcpConnect.mockReset();
    mocks.tlsConnect.mockReset();
    mocks.openaiModelsList.mockReset();

    mocks.dnsLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    mocks.openaiModelsList.mockResolvedValue({});

    mocks.tcpConnect.mockImplementation(() => {
      const handlers: Record<string, () => void> = {};
      const socket = {
        once(event: string, handler: () => void) {
          handlers[event] = handler;
          if (event === 'connect') queueMicrotask(handler);
          return socket;
        },
        destroy: vi.fn(),
      };
      return socket;
    });

    mocks.tlsConnect.mockImplementation(
      (_options: Record<string, unknown>, onSecure?: () => void) => {
        const handlers: Record<string, () => void> = {};
        const socket = {
          authorized: true,
          authorizationError: null,
          once(event: string, handler: () => void) {
            handlers[event] = handler;
            return socket;
          },
          destroy: vi.fn(),
        };
        queueMicrotask(() => {
          handlers.secureConnect?.();
          onSecure?.();
        });
        return socket;
      }
    );
  });

  it('sends servername for HTTPS hostnames so SNI-enabled endpoints validate correctly', async () => {
    const result = await runDiagnostics({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    });

    expect(result.overallOk).toBe(true);
    const [options] = mocks.tlsConnect.mock.calls[0];
    expect(options).toMatchObject({
      host: 'api.openai.com',
      port: 443,
      timeout: 5000,
      servername: 'api.openai.com',
    });
  });

  it('does not send servername for IP-based HTTPS endpoints', async () => {
    const result = await runDiagnostics({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://127.0.0.1:8443/v1',
    });

    expect(result.overallOk).toBe(true);
    const [options] = mocks.tlsConnect.mock.calls[0];
    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 8443,
      timeout: 5000,
    });
    expect(options.servername).toBeUndefined();
  });

  it('normalizes bracketed IPv6 hosts before DNS/TCP/TLS checks', async () => {
    const result = await runDiagnostics({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://[::1]:8443/v1',
    });

    expect(result.overallOk).toBe(true);
    expect(mocks.dnsLookup).not.toHaveBeenCalled();

    const [tcpOptions] = mocks.tcpConnect.mock.calls[0];
    expect(tcpOptions).toMatchObject({
      host: '::1',
      port: 8443,
      timeout: 5000,
    });

    const [tlsOptions] = mocks.tlsConnect.mock.calls[0];
    expect(tlsOptions).toMatchObject({
      host: '::1',
      port: 8443,
      timeout: 5000,
    });
    expect(tlsOptions.servername).toBeUndefined();
  });
});
