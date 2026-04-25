import { afterEach, describe, expect, it, vi } from 'vitest';

const storeState: Record<string, unknown> = {};

function assertNoUndefined(value: unknown, path = 'store'): void {
  if (value === undefined) {
    throw new TypeError(`Setting a value of type undefined for key ${path} is not allowed`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUndefined(item, `${path}.${index}`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assertNoUndefined(child, `${path}.${key}`);
    }
  }
}

vi.mock('electron-store', () => ({
  default: class MockStore {
    store = storeState;
    get(key: string) {
      return storeState[key];
    }
    set(keyOrObject: string | Record<string, unknown>, value?: unknown) {
      if (typeof keyOrObject === 'string') {
        assertNoUndefined(value, keyOrObject);
        storeState[keyOrObject] = value;
      } else {
        assertNoUndefined(keyOrObject);
        Object.assign(storeState, keyOrObject);
      }
    }
  },
}));

describe('ConfigStore context window projection', () => {
  afterEach(() => {
    for (const key of Object.keys(storeState)) {
      delete storeState[key];
    }
  });

  it('projects active profile context settings onto runtime config', async () => {
    const { ConfigStore } = await import('../main/config/config-store');
    const configStore = new ConfigStore();

    configStore.update({
      provider: 'custom',
      customProtocol: 'openai',
      activeProfileKey: 'custom:openai',
      profiles: {
        'custom:openai': {
          apiKey: 'test-key',
          baseUrl: 'https://api.deepseek.com',
          model: 'deepseek-v4-flash',
          contextWindow: 1_024_000,
          maxTokens: 384_000,
        },
      },
    });

    const config = configStore.getAll();

    expect(config.model).toBe('deepseek-v4-flash');
    expect(config.contextWindow).toBe(1_024_000);
    expect(config.maxTokens).toBe(384_000);
    expect(config.profiles['custom:openai']?.contextWindow).toBe(1_024_000);
  });

  it('does not persist undefined context fields when creating or switching config sets', async () => {
    const { ConfigStore } = await import('../main/config/config-store');
    const configStore = new ConfigStore();

    const created = configStore.createSet({
      name: 'empty auto context',
      mode: 'blank',
    });
    const createdSetId = created.configSets.find((set) => set.name === 'empty auto context')?.id;

    expect(createdSetId).toBeTruthy();
    expect(() => configStore.switchSet({ id: createdSetId as string })).not.toThrow();
    expect(JSON.stringify(storeState)).not.toContain('contextWindow');
    expect(JSON.stringify(storeState)).not.toContain('maxTokens');
  });
});
