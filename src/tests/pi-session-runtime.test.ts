import { describe, expect, it } from 'vitest';
import {
  buildPiSessionRuntimeSignature,
  diffPiSessionRuntimeSignatures,
} from '../main/claude/pi-session-runtime';

describe('pi session runtime signature', () => {
  it('tracks model context settings so cached sessions are recreated after overrides change', () => {
    const previous = buildPiSessionRuntimeSignature({
      configProvider: 'custom',
      customProtocol: 'openai',
      modelProvider: 'deepseek',
      modelApi: 'openai-completions',
      modelBaseUrl: 'https://api.deepseek.com',
      contextWindow: 128000,
      maxTokens: 8192,
      effectiveCwd: 'E:\\workspace',
      apiKey: 'secret',
    });
    const next = buildPiSessionRuntimeSignature({
      configProvider: 'custom',
      customProtocol: 'openai',
      modelProvider: 'deepseek',
      modelApi: 'openai-completions',
      modelBaseUrl: 'https://api.deepseek.com',
      contextWindow: 1000000,
      maxTokens: 8192,
      effectiveCwd: 'E:\\workspace',
      apiKey: 'secret',
    });

    expect(diffPiSessionRuntimeSignatures(previous, next)).toContain('contextWindow');
  });
});
