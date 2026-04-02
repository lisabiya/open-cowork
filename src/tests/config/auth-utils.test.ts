import { describe, it, expect } from 'vitest';
import { normalizeOpenAICompatibleBaseUrl } from '../../main/config/auth-utils';

describe('normalizeOpenAICompatibleBaseUrl', () => {
  // --- Empty / undefined inputs ---
  it('returns undefined for undefined input', () => {
    expect(normalizeOpenAICompatibleBaseUrl(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(normalizeOpenAICompatibleBaseUrl('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only string', () => {
    expect(normalizeOpenAICompatibleBaseUrl('   ')).toBeUndefined();
  });

  // --- URLs that already end with /v1 (should be unchanged) ---
  it('preserves URL that already ends with /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1'
    );
  });

  it('preserves URL with sub-path ending in /v1', () => {
    expect(
      normalizeOpenAICompatibleBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  // --- URLs missing /v1 (should be appended) ---
  it('appends /v1 to URL without version path', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://dashscope.aliyuncs.com/compatible-mode')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
  });

  it('appends /v1 to bare host URL', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://my-proxy.example.com')).toBe(
      'https://my-proxy.example.com/v1'
    );
  });

  it('appends /v1 to bare host URL with trailing slash', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://my-proxy.example.com/')).toBe(
      'https://my-proxy.example.com/v1'
    );
  });

  // --- URLs with /chat/completions suffix (should be stripped) ---
  it('strips /v1/chat/completions and preserves /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/chat/completions')).toBe(
      'https://api.openai.com/v1'
    );
  });

  it('strips /chat/completions and appends /v1', () => {
    expect(
      normalizeOpenAICompatibleBaseUrl(
        'https://dashscope.aliyuncs.com/compatible-mode/chat/completions'
      )
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('strips /chat/completions from sub-path and appends /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://my-proxy.example.com/chat/completions')).toBe(
      'https://my-proxy.example.com/v1'
    );
  });

  it('strips /v1/chat/completions from sub-path URL', () => {
    expect(
      normalizeOpenAICompatibleBaseUrl(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
      )
    ).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  // --- Trailing slashes ---
  it('cleans trailing slashes from URL ending with /v1/', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1'
    );
  });

  it('cleans multiple trailing slashes', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1///')).toBe(
      'https://api.openai.com/v1'
    );
  });

  // --- OpenRouter URLs (special handling preserved) ---
  it('adds /api/v1 to bare OpenRouter URL', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('adds /api/v1 to OpenRouter URL with trailing slash', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('completes /api to /api/v1 for OpenRouter', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  it('preserves correct OpenRouter /api/v1 path', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1'
    );
  });

  // --- Whitespace handling ---
  it('trims leading and trailing whitespace', () => {
    expect(normalizeOpenAICompatibleBaseUrl('  https://api.openai.com/v1  ')).toBe(
      'https://api.openai.com/v1'
    );
  });

  // --- Port and protocol preservation ---
  it('preserves port in URL', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:8080')).toBe(
      'http://localhost:8080/v1'
    );
  });

  it('preserves port in URL that already has /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:8080/v1')).toBe(
      'http://localhost:8080/v1'
    );
  });
});
