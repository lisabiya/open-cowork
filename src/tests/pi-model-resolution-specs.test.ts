import { describe, expect, it } from 'vitest';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
} from '../main/claude/pi-model-resolution';

describe('pi model resolution known specs', () => {
  it.each([
    ['gpt-5.5-pro', 1050000, 128000],
    ['openai/gpt-5.5-pro', 1050000, 128000],
    ['openai/gpt-5.5-pro-20260423', 1050000, 128000],
    ['OpenAI: GPT-5.5 Pro', 1050000, 128000],
    ['deepseek-v4-pro', 1048576, 384000],
    ['deepseek/deepseek-v4-pro-20260423', 1048576, 384000],
    ['DeepSeek: DeepSeek V4 Pro', 1048576, 384000],
    ['deepseek-v4-flash', 1048576, 384000],
    ['qwen3.6-plus-04-02', 1000000, 65536],
    ['Anthropic: Claude Opus 4.7', 1000000, 128000],
  ])('matches aliases for %s', (modelId, contextWindow, maxTokens) => {
    const model = buildSyntheticPiModel(modelId, 'custom', 'openai');

    expect(model.contextWindow).toBe(contextWindow);
    expect(model.maxTokens).toBe(maxTokens);
  });

  it('applies known specs to registry models that still carry old defaults', () => {
    const model = applyPiModelRuntimeOverrides(
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek: DeepSeek V4 Pro',
        api: 'openai-completions',
        provider: 'deepseek',
        baseUrl: '',
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 180000,
        maxTokens: 12000,
      } as any,
      { requestedModelString: 'deepseek-v4-pro' }
    );

    expect(model.contextWindow).toBe(1048576);
    expect(model.maxTokens).toBe(384000);
  });
});
