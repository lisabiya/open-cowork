import { getModel, type Api, type Model } from '@mariozechner/pi-ai';
import { isOfficialOpenAIBaseUrl } from '../config/auth-utils';

const COMMON_FALLBACK_PROVIDERS = ['openai', 'anthropic', 'google'] as const;
const INVALID_REGISTRY_PROVIDERS = new Set(['', 'custom']);
const REASONING_MODEL_PATTERN =
  /\bthinking\b|\breasoner\b|deepseek-r1|kimi-k2|qwen3(?:\.5)?(?=[:/-]|$)/i;
type PiRegistryProvider = Parameters<typeof getModel>[0];

export interface PiModelStringInput {
  provider?: string;
  customProtocol?: string;
  model?: string;
  defaultModel?: string;
}

export interface PiModelLookupOptions {
  configProvider?: string;
  rawProvider?: string;
  customBaseUrl?: string;
  customProtocol?: string;
  requestedModelString?: string;
}

export interface PiModelLookupCandidate {
  provider: string;
  model: string;
}

export interface SyntheticPiModelFallbackInput {
  rawModel?: string;
  resolvedModelString: string;
  rawProvider?: string;
  routeProtocol: string;
  baseUrl?: string;
}

export interface SyntheticPiModelFallback {
  provider: string;
  modelId: string;
}

export function resolvePiRouteProtocol(provider?: string, customProtocol?: string): string {
  if (provider === 'custom') {
    if (customProtocol === 'openai' || customProtocol === 'gemini') {
      return customProtocol;
    }
    return 'anthropic';
  }
  if (provider === 'ollama') return 'openai';
  if (provider === 'openai') return 'openai';
  if (provider === 'openrouter') return 'openai';
  if (provider === 'gemini') return 'gemini';
  return provider || 'anthropic';
}

function shouldDisableDeveloperRoleForEndpoint(
  model: Model<Api>,
  options: PiModelLookupOptions
): boolean {
  if (model.api !== 'openai-completions' && model.api !== 'openai-responses') {
    return false;
  }

  const endpoint = options.customBaseUrl?.trim() || model.baseUrl?.trim();
  if (!endpoint || isOfficialOpenAIBaseUrl(endpoint)) {
    return false;
  }

  return true;
}

export function inferPiApi(protocol: string): string {
  switch (protocol) {
    case 'anthropic':
      return 'anthropic-messages';
    case 'gemini':
    case 'google':
      return 'google-generative-ai';
    case 'openai':
    default:
      return 'openai-completions';
  }
}

interface KnownModelSpecs {
  contextWindow: number;
  maxTokens: number;
}

interface KnownModelSpecEntry extends KnownModelSpecs {
  aliases: string[];
}

/**
 * OpenRouter model specs refreshed from /api/v1/models on 2026-04-25.
 * Scope: text-output language and multimodal models created since 2025-10-25.
 */
const RECENT_OPENROUTER_MODEL_SPECS: KnownModelSpecEntry[] = [
  {
    aliases: ['openai/gpt-5.5-pro', 'openai/gpt-5.5-pro-20260423'],
    contextWindow: 1050000,
    maxTokens: 128000,
  },
  {
    aliases: ['openai/gpt-5.5', 'openai/gpt-5.5-20260423'],
    contextWindow: 1050000,
    maxTokens: 128000,
  },
  {
    aliases: ['deepseek/deepseek-v4-pro', 'deepseek/deepseek-v4-pro-20260423'],
    contextWindow: 1048576,
    maxTokens: 384000,
  },
  {
    aliases: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-flash-20260423'],
    contextWindow: 1048576,
    maxTokens: 384000,
  },
  {
    aliases: ['inclusionai/ling-2.6-1t:free', 'inclusionai/ling-2.6-1t-20260423'],
    contextWindow: 262144,
    maxTokens: 32768,
  },
  {
    aliases: ['tencent/hy3-preview:free', 'tencent/hy3-preview-20260421'],
    contextWindow: 262144,
    maxTokens: 262144,
  },
  {
    aliases: ['xiaomi/mimo-v2.5-pro', 'xiaomi/mimo-v2.5-pro-20260422'],
    contextWindow: 1048576,
    maxTokens: 131072,
  },
  {
    aliases: ['xiaomi/mimo-v2.5', 'xiaomi/mimo-v2.5-20260422'],
    contextWindow: 1048576,
    maxTokens: 131072,
  },
  {
    aliases: ['openai/gpt-5.4-image-2', 'openai/gpt-5.4-image-2-20260421'],
    contextWindow: 272000,
    maxTokens: 128000,
  },
  {
    aliases: ['inclusionai/ling-2.6-flash:free', 'inclusionai/ling-2.6-flash-20260421'],
    contextWindow: 262144,
    maxTokens: 32768,
  },
  { aliases: ['~anthropic/claude-opus-latest'], contextWindow: 1000000, maxTokens: 128000 },
  {
    aliases: ['baidu/qianfan-ocr-fast:free', 'baidu/qianfan-ocr-fast-20260420'],
    contextWindow: 65536,
    maxTokens: 28672,
  },
  {
    aliases: ['moonshotai/kimi-k2.6', 'moonshotai/kimi-k2.6-20260420'],
    contextWindow: 256000,
    maxTokens: 65536,
  },
  {
    aliases: ['anthropic/claude-opus-4.7', 'anthropic/claude-4.7-opus-20260416'],
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    aliases: ['anthropic/claude-opus-4.6-fast', 'anthropic/claude-4.6-opus-fast-20260407'],
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  { aliases: ['z-ai/glm-5.1', 'z-ai/glm-5.1-20260406'], contextWindow: 202752, maxTokens: 65535 },
  {
    aliases: ['google/gemma-4-26b-a4b-it:free', 'google/gemma-4-26b-a4b-it-20260403'],
    contextWindow: 262144,
    maxTokens: 32768,
  },
  {
    aliases: ['google/gemma-4-26b-a4b-it', 'google/gemma-4-26b-a4b-it-20260403'],
    contextWindow: 262144,
    maxTokens: 16384,
  },
  {
    aliases: ['google/gemma-4-31b-it:free', 'google/gemma-4-31b-it-20260402'],
    contextWindow: 262144,
    maxTokens: 32768,
  },
  {
    aliases: ['google/gemma-4-31b-it', 'google/gemma-4-31b-it-20260402'],
    contextWindow: 262144,
    maxTokens: 16384,
  },
  {
    aliases: ['qwen/qwen3.6-plus', 'qwen/qwen3.6-plus-04-02'],
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    aliases: ['z-ai/glm-5v-turbo', 'z-ai/glm-5v-turbo-20260401'],
    contextWindow: 202752,
    maxTokens: 131072,
  },
  { aliases: ['arcee-ai/trinity-large-thinking'], contextWindow: 262144, maxTokens: 262144 },
  {
    aliases: ['x-ai/grok-4.20-multi-agent', 'x-ai/grok-4.20-multi-agent-20260309'],
    contextWindow: 2000000,
    maxTokens: 16384,
  },
  {
    aliases: ['x-ai/grok-4.20', 'x-ai/grok-4.20-20260309'],
    contextWindow: 2000000,
    maxTokens: 16384,
  },
  {
    aliases: ['google/lyria-3-pro-preview', 'google/lyria-3-pro-preview-20260330'],
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    aliases: ['google/lyria-3-clip-preview', 'google/lyria-3-clip-preview-20260330'],
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    aliases: ['kwaipilot/kat-coder-pro-v2', 'kwaipilot/kat-coder-pro-v2-20260327'],
    contextWindow: 256000,
    maxTokens: 80000,
  },
  {
    aliases: ['rekaai/reka-edge', 'rekaai/reka-edge-2603'],
    contextWindow: 16384,
    maxTokens: 16384,
  },
  {
    aliases: ['xiaomi/mimo-v2-omni', 'xiaomi/mimo-v2-omni-20260318'],
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    aliases: ['xiaomi/mimo-v2-pro', 'xiaomi/mimo-v2-pro-20260318'],
    contextWindow: 1048576,
    maxTokens: 131072,
  },
  {
    aliases: ['minimax/minimax-m2.7', 'minimax/minimax-m2.7-20260318'],
    contextWindow: 196608,
    maxTokens: 16384,
  },
  {
    aliases: ['openai/gpt-5.4-nano', 'openai/gpt-5.4-nano-20260317'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    aliases: ['openai/gpt-5.4-mini', 'openai/gpt-5.4-mini-20260317'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  { aliases: ['mistralai/mistral-small-2603'], contextWindow: 262144, maxTokens: 16384 },
  {
    aliases: ['z-ai/glm-5-turbo', 'z-ai/glm-5-turbo-20260315'],
    contextWindow: 202752,
    maxTokens: 131072,
  },
  {
    aliases: [
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-super-120b-a12b-20230311',
    ],
    contextWindow: 262144,
    maxTokens: 262144,
  },
  {
    aliases: ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3-super-120b-a12b-20230311'],
    contextWindow: 262144,
    maxTokens: 16384,
  },
  {
    aliases: ['bytedance-seed/seed-2.0-lite', 'bytedance-seed/seed-2.0-lite-20260309'],
    contextWindow: 262144,
    maxTokens: 131072,
  },
  {
    aliases: ['qwen/qwen3.5-9b', 'qwen/qwen3.5-9b-20260310'],
    contextWindow: 262144,
    maxTokens: 16384,
  },
  {
    aliases: ['openai/gpt-5.4-pro', 'openai/gpt-5.4-pro-20260305'],
    contextWindow: 1050000,
    maxTokens: 128000,
  },
  {
    aliases: ['openai/gpt-5.4', 'openai/gpt-5.4-20260305'],
    contextWindow: 1050000,
    maxTokens: 128000,
  },
  {
    aliases: ['inception/mercury-2', 'inception/mercury-2-20260304'],
    contextWindow: 128000,
    maxTokens: 50000,
  },
  {
    aliases: ['openai/gpt-5.3-chat', 'openai/gpt-5.3-chat-20260303'],
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    aliases: [
      'google/gemini-3.1-flash-lite-preview',
      'google/gemini-3.1-flash-lite-preview-20260303',
    ],
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    aliases: ['bytedance-seed/seed-2.0-mini', 'bytedance-seed/seed-2.0-mini-20260224'],
    contextWindow: 262144,
    maxTokens: 131072,
  },
  {
    aliases: [
      'google/gemini-3.1-flash-image-preview',
      'google/gemini-3.1-flash-image-preview-20260226',
    ],
    contextWindow: 65536,
    maxTokens: 65536,
  },
  {
    aliases: ['qwen/qwen3.5-35b-a3b', 'qwen/qwen3.5-35b-a3b-20260224'],
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    aliases: ['qwen/qwen3.5-27b', 'qwen/qwen3.5-27b-20260224'],
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    aliases: ['qwen/qwen3.5-122b-a10b', 'qwen/qwen3.5-122b-a10b-20260224'],
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    aliases: ['qwen/qwen3.5-flash-02-23', 'qwen/qwen3.5-flash-20260224'],
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    aliases: ['liquid/lfm-2-24b-a2b', 'liquid/lfm-2-24b-a2b-20260224'],
    contextWindow: 32768,
    maxTokens: 16384,
  },
  {
    aliases: [
      'google/gemini-3.1-pro-preview-customtools',
      'google/gemini-3.1-pro-preview-customtools-20260219',
    ],
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    aliases: ['openai/gpt-5.3-codex', 'openai/gpt-5.3-codex-20260224'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    aliases: ['aion-labs/aion-2.0', 'aion-labs/aion-2.0-20260223'],
    contextWindow: 131072,
    maxTokens: 32768,
  },
  {
    aliases: ['google/gemini-3.1-pro-preview', 'google/gemini-3.1-pro-preview-20260219'],
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    aliases: ['anthropic/claude-sonnet-4.6', 'anthropic/claude-4.6-sonnet-20260217'],
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    aliases: ['qwen/qwen3.5-plus-02-15', 'qwen/qwen3.5-plus-20260216'],
    contextWindow: 1000000,
    maxTokens: 65536,
  },
  {
    aliases: ['qwen/qwen3.5-397b-a17b', 'qwen/qwen3.5-397b-a17b-20260216'],
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    aliases: ['minimax/minimax-m2.5:free', 'minimax/minimax-m2.5-20260211'],
    contextWindow: 196608,
    maxTokens: 8192,
  },
  {
    aliases: ['minimax/minimax-m2.5', 'minimax/minimax-m2.5-20260211'],
    contextWindow: 196608,
    maxTokens: 131072,
  },
  { aliases: ['z-ai/glm-5', 'z-ai/glm-5-20260211'], contextWindow: 202752, maxTokens: 16384 },
  {
    aliases: ['qwen/qwen3-max-thinking', 'qwen/qwen3-max-thinking-20260123'],
    contextWindow: 262144,
    maxTokens: 32768,
  },
  {
    aliases: ['anthropic/claude-opus-4.6', 'anthropic/claude-4.6-opus-20260205'],
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    aliases: ['qwen/qwen3-coder-next', 'qwen/qwen3-coder-next-2025-02-03'],
    contextWindow: 262144,
    maxTokens: 262144,
  },
  { aliases: ['stepfun/step-3.5-flash'], contextWindow: 262144, maxTokens: 65536 },
  { aliases: ['arcee-ai/trinity-large-preview'], contextWindow: 131000, maxTokens: 16384 },
  {
    aliases: ['moonshotai/kimi-k2.5', 'moonshotai/kimi-k2.5-0127'],
    contextWindow: 262144,
    maxTokens: 65535,
  },
  { aliases: ['upstage/solar-pro-3'], contextWindow: 128000, maxTokens: 16384 },
  {
    aliases: ['minimax/minimax-m2-her', 'minimax/minimax-m2-her-20260123'],
    contextWindow: 65536,
    maxTokens: 2048,
  },
  {
    aliases: ['writer/palmyra-x5', 'writer/palmyra-x5-20250428'],
    contextWindow: 1040000,
    maxTokens: 8192,
  },
  {
    aliases: ['liquid/lfm-2.5-1.2b-thinking:free', 'liquid/lfm-2.5-1.2b-thinking-20260120'],
    contextWindow: 32768,
    maxTokens: 16384,
  },
  {
    aliases: ['liquid/lfm-2.5-1.2b-instruct:free', 'liquid/lfm-2.5-1.2b-instruct-20260120'],
    contextWindow: 32768,
    maxTokens: 16384,
  },
  { aliases: ['openai/gpt-audio'], contextWindow: 128000, maxTokens: 16384 },
  { aliases: ['openai/gpt-audio-mini'], contextWindow: 128000, maxTokens: 16384 },
  {
    aliases: ['z-ai/glm-4.7-flash', 'z-ai/glm-4.7-flash-20260119'],
    contextWindow: 202752,
    maxTokens: 16384,
  },
  {
    aliases: ['openai/gpt-5.2-codex', 'openai/gpt-5.2-codex-20260114'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    aliases: ['allenai/olmo-3.1-32b-instruct', 'allenai/olmo-3.1-32b-instruct-20251215'],
    contextWindow: 65536,
    maxTokens: 16384,
  },
  {
    aliases: ['bytedance-seed/seed-1.6-flash', 'bytedance-seed/seed-1.6-flash-20250625'],
    contextWindow: 262144,
    maxTokens: 32768,
  },
  {
    aliases: ['bytedance-seed/seed-1.6', 'bytedance-seed/seed-1.6-20250625'],
    contextWindow: 262144,
    maxTokens: 32768,
  },
  { aliases: ['minimax/minimax-m2.1'], contextWindow: 196608, maxTokens: 196608 },
  { aliases: ['z-ai/glm-4.7', 'z-ai/glm-4.7-20251222'], contextWindow: 202752, maxTokens: 16384 },
  {
    aliases: ['google/gemini-3-flash-preview', 'google/gemini-3-flash-preview-20251217'],
    contextWindow: 1048576,
    maxTokens: 65536,
  },
  {
    aliases: ['mistralai/mistral-small-creative', 'mistralai/mistral-small-creative-20251216'],
    contextWindow: 32768,
    maxTokens: 16384,
  },
  {
    aliases: ['xiaomi/mimo-v2-flash', 'xiaomi/mimo-v2-flash-20251210'],
    contextWindow: 262144,
    maxTokens: 65536,
  },
  {
    aliases: ['nvidia/nemotron-3-nano-30b-a3b:free', 'nvidia/nemotron-3-nano-30b-a3b'],
    contextWindow: 256000,
    maxTokens: 16384,
  },
  { aliases: ['nvidia/nemotron-3-nano-30b-a3b'], contextWindow: 262144, maxTokens: 228000 },
  {
    aliases: ['openai/gpt-5.2-chat', 'openai/gpt-5.2-chat-20251211'],
    contextWindow: 128000,
    maxTokens: 32000,
  },
  {
    aliases: ['openai/gpt-5.2-pro', 'openai/gpt-5.2-pro-20251211'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    aliases: ['openai/gpt-5.2', 'openai/gpt-5.2-20251211'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  { aliases: ['mistralai/devstral-2512'], contextWindow: 262144, maxTokens: 16384 },
  {
    aliases: ['relace/relace-search', 'relace/relace-search-20251208'],
    contextWindow: 256000,
    maxTokens: 128000,
  },
  { aliases: ['z-ai/glm-4.6v', 'z-ai/glm-4.6-20251208'], contextWindow: 131072, maxTokens: 24000 },
  { aliases: ['nex-agi/deepseek-v3.1-nex-n1'], contextWindow: 131072, maxTokens: 163840 },
  { aliases: ['essentialai/rnj-1-instruct'], contextWindow: 32768, maxTokens: 16384 },
  {
    aliases: ['openai/gpt-5.1-codex-max', 'openai/gpt-5.1-codex-max-20251204'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  { aliases: ['amazon/nova-2-lite-v1'], contextWindow: 1000000, maxTokens: 65535 },
  { aliases: ['mistralai/ministral-14b-2512'], contextWindow: 262144, maxTokens: 16384 },
  { aliases: ['mistralai/ministral-8b-2512'], contextWindow: 262144, maxTokens: 16384 },
  { aliases: ['mistralai/ministral-3b-2512'], contextWindow: 131072, maxTokens: 16384 },
  { aliases: ['mistralai/mistral-large-2512'], contextWindow: 262144, maxTokens: 16384 },
  {
    aliases: ['arcee-ai/trinity-mini', 'arcee-ai/trinity-mini-20251201'],
    contextWindow: 131072,
    maxTokens: 131072,
  },
  {
    aliases: ['deepseek/deepseek-v3.2-speciale', 'deepseek/deepseek-v3.2-speciale-20251201'],
    contextWindow: 163840,
    maxTokens: 163840,
  },
  {
    aliases: ['deepseek/deepseek-v3.2', 'deepseek/deepseek-v3.2-20251201'],
    contextWindow: 131072,
    maxTokens: 65536,
  },
  {
    aliases: ['prime-intellect/intellect-3', 'prime-intellect/intellect-3-20251126'],
    contextWindow: 131072,
    maxTokens: 131072,
  },
  {
    aliases: ['anthropic/claude-opus-4.5', 'anthropic/claude-4.5-opus-20251124'],
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    aliases: ['allenai/olmo-3-32b-think', 'allenai/olmo-3-32b-think-20251121'],
    contextWindow: 65536,
    maxTokens: 65536,
  },
  {
    aliases: ['google/gemini-3-pro-image-preview', 'google/gemini-3-pro-image-preview-20251120'],
    contextWindow: 65536,
    maxTokens: 32768,
  },
  { aliases: ['x-ai/grok-4.1-fast'], contextWindow: 2000000, maxTokens: 30000 },
  {
    aliases: ['deepcogito/cogito-v2.1-671b', 'deepcogito/cogito-v2.1-671b-20251118'],
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    aliases: ['openai/gpt-5.1', 'openai/gpt-5.1-20251113'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    aliases: ['openai/gpt-5.1-chat', 'openai/gpt-5.1-chat-20251113'],
    contextWindow: 128000,
    maxTokens: 16384,
  },
  {
    aliases: ['openai/gpt-5.1-codex', 'openai/gpt-5.1-codex-20251113'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    aliases: ['openai/gpt-5.1-codex-mini', 'openai/gpt-5.1-codex-mini-20251113'],
    contextWindow: 400000,
    maxTokens: 128000,
  },
  {
    aliases: ['moonshotai/kimi-k2-thinking', 'moonshotai/kimi-k2-thinking-20251106'],
    contextWindow: 262144,
    maxTokens: 262144,
  },
  { aliases: ['amazon/nova-premier-v1'], contextWindow: 1000000, maxTokens: 32000 },
  { aliases: ['perplexity/sonar-pro-search'], contextWindow: 200000, maxTokens: 8000 },
  { aliases: ['mistralai/voxtral-small-24b-2507'], contextWindow: 32000, maxTokens: 16384 },
  { aliases: ['openai/gpt-oss-safeguard-20b'], contextWindow: 131072, maxTokens: 65536 },
  {
    aliases: ['nvidia/nemotron-nano-12b-v2-vl:free', 'nvidia/nemotron-nano-12b-v2-vl'],
    contextWindow: 128000,
    maxTokens: 128000,
  },
  { aliases: ['nvidia/nemotron-nano-12b-v2-vl'], contextWindow: 131072, maxTokens: 16384 },
];

/**
 * Older broad family specs kept for local Ollama-style names.
 * Recent provider models above are exact/alias matched first to avoid prefix collisions.
 */
const KNOWN_FAMILY_MODEL_SPECS: Record<string, KnownModelSpecs> = {
  'qwen3.5': { contextWindow: 258048, maxTokens: 32768 },
  qwen3: { contextWindow: 40960, maxTokens: 8192 },
  'qwen2.5': { contextWindow: 131072, maxTokens: 8192 },
  llama3: { contextWindow: 131072, maxTokens: 4096 },
  'llama3.1': { contextWindow: 131072, maxTokens: 4096 },
  'llama3.2': { contextWindow: 131072, maxTokens: 4096 },
  'llama3.3': { contextWindow: 131072, maxTokens: 4096 },
  'deepseek-r1': { contextWindow: 65536, maxTokens: 8192 },
  'deepseek-v3': { contextWindow: 65536, maxTokens: 8192 },
  gemma2: { contextWindow: 8192, maxTokens: 4096 },
  gemma3: { contextWindow: 131072, maxTokens: 8192 },
  phi3: { contextWindow: 131072, maxTokens: 4096 },
  phi4: { contextWindow: 16384, maxTokens: 4096 },
  mistral: { contextWindow: 32768, maxTokens: 4096 },
  mixtral: { contextWindow: 32768, maxTokens: 4096 },
  codellama: { contextWindow: 16384, maxTokens: 4096 },
  'command-r': { contextWindow: 131072, maxTokens: 4096 },
};

function stripDateSuffix(value: string): string {
  return value
    .replace(/-(?:20\d{2})(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$/, '')
    .replace(/-(?:20\d{2})-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01])$/, '')
    .replace(/-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/, '');
}

function normalizeModelLookupKey(value: string): string {
  const withoutDisplayProvider =
    value.includes(':') && !value.includes('/') ? value.split(':').slice(1).join(':') : value;
  return withoutDisplayProvider
    .trim()
    .toLowerCase()
    .replace(/^~/, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9./:+-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function addModelLookupVariants(keys: Set<string>, value: string): void {
  const normalized = normalizeModelLookupKey(value);
  if (!normalized) return;

  const variants = new Set<string>([normalized, stripDateSuffix(normalized)]);
  for (const variant of Array.from(variants)) {
    if (variant.endsWith(':free')) variants.add(variant.slice(0, -':free'.length));
    if (variant.includes('/')) variants.add(variant.split('/').slice(1).join('/'));
  }
  for (const variant of Array.from(variants)) {
    if (variant.includes('/')) {
      const bare = variant.split('/').slice(1).join('/');
      variants.add(stripDateSuffix(bare));
      if (bare.endsWith(':free')) variants.add(bare.slice(0, -':free'.length));
    }
  }
  for (const variant of variants) {
    if (variant) keys.add(variant);
  }
}

function buildKnownModelSpecMap(): Map<string, KnownModelSpecs> {
  const specsByKey = new Map<string, KnownModelSpecs>();
  for (const entry of RECENT_OPENROUTER_MODEL_SPECS) {
    for (const alias of entry.aliases) {
      const keys = new Set<string>();
      addModelLookupVariants(keys, alias);
      for (const key of keys) {
        specsByKey.set(key, {
          contextWindow: entry.contextWindow,
          maxTokens: entry.maxTokens,
        });
      }
    }
  }
  return specsByKey;
}

const KNOWN_MODEL_SPEC_MAP = buildKnownModelSpecMap();

function lookupModelSpecs(modelId: string): KnownModelSpecs | undefined {
  const exactKeys = new Set<string>();
  addModelLookupVariants(exactKeys, modelId);
  for (const key of exactKeys) {
    const specs = KNOWN_MODEL_SPEC_MAP.get(key);
    if (specs) return specs;
  }

  const lower = normalizeModelLookupKey(modelId);
  // Match by prefix: "qwen3.5:0.8b" → "qwen3.5", "deepseek-r1-distill" → "deepseek-r1"
  for (const [key, specs] of Object.entries(KNOWN_FAMILY_MODEL_SPECS)) {
    if (lower === key || lower.startsWith(key + ':') || lower.startsWith(key + '-')) {
      return specs;
    }
  }
  return undefined;
}

export function resolveKnownModelSpecs(modelId: string): KnownModelSpecs | undefined {
  return lookupModelSpecs(modelId);
}

function lookupModelSpecsForModel(
  model: Pick<Model<Api>, 'id' | 'name'>,
  requestedModelString?: string
): KnownModelSpecs | undefined {
  const candidates = [requestedModelString, model.id, model.name].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
  );
  for (const candidate of candidates) {
    const specs = lookupModelSpecs(candidate);
    if (specs) return specs;
  }
  return undefined;
}

export function buildSyntheticPiModel(
  modelId: string,
  provider: string,
  protocol: string,
  baseUrl?: string,
  apiOverride?: string,
  reasoning?: boolean,
  contextWindow?: number,
  maxTokens?: number
): Model<Api> {
  const api = apiOverride || inferPiApi(protocol);
  const autoReasoning = reasoning ?? REASONING_MODEL_PATTERN.test(modelId);
  const knownSpecs = lookupModelSpecs(modelId);
  return {
    id: modelId,
    name: modelId,
    api,
    provider,
    baseUrl: baseUrl || '',
    reasoning: autoReasoning,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? knownSpecs?.contextWindow ?? 128000,
    maxTokens: maxTokens ?? knownSpecs?.maxTokens ?? 16384,
  } as Model<Api>;
}

export function resolveSyntheticPiModelFallback(
  input: SyntheticPiModelFallbackInput
): SyntheticPiModelFallback {
  const rawModel = input.rawModel?.trim() || '';
  const modelString = input.resolvedModelString.trim();
  const parts = modelString.split('/');
  const parsedProvider = parts.length >= 2 ? parts[0] : '';
  const strippedModelId = parts.length >= 2 ? parts.slice(1).join('/') : modelString;
  const baseUrl = input.baseUrl?.trim() || '';
  const preservesExplicitPrefixedId =
    rawModel.includes('/') &&
    (input.rawProvider === 'openrouter' ||
      input.rawProvider === 'custom' ||
      (input.rawProvider === 'openai' && !!baseUrl && !isOfficialOpenAIBaseUrl(baseUrl))) &&
    input.routeProtocol === 'openai';

  if (input.rawProvider === 'openrouter') {
    return {
      provider: 'openrouter',
      modelId: preservesExplicitPrefixedId ? modelString : strippedModelId,
    };
  }

  const fallbackProvider =
    input.rawProvider === 'custom' || input.rawProvider === 'ollama'
      ? input.routeProtocol || 'anthropic'
      : parsedProvider || input.rawProvider || input.routeProtocol || 'anthropic';

  return {
    provider: preservesExplicitPrefixedId ? parsedProvider || fallbackProvider : fallbackProvider,
    modelId: preservesExplicitPrefixedId ? modelString : strippedModelId,
  };
}

export function resolvePiModelString(input: PiModelStringInput): string {
  const model = input.model?.trim();
  if (!model) {
    return input.defaultModel || 'anthropic/claude-sonnet-4-6';
  }
  if (model.includes('/')) {
    return model;
  }
  const provider = input.provider || 'anthropic';
  const protocol = input.customProtocol || provider;
  return `${protocol}/${model}`;
}

function addLookupCandidate(
  candidates: PiModelLookupCandidate[],
  seen: Set<string>,
  provider: string | undefined,
  model: string | undefined
): void {
  const normalizedProvider = provider?.trim() || '';
  const normalizedModel = model?.trim() || '';
  if (
    !normalizedProvider ||
    !normalizedModel ||
    INVALID_REGISTRY_PROVIDERS.has(normalizedProvider)
  ) {
    return;
  }

  const key = `${normalizedProvider}\u0000${normalizedModel}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push({ provider: normalizedProvider, model: normalizedModel });
}

export function buildPiModelLookupCandidates(
  modelString: string,
  options: Pick<PiModelLookupOptions, 'configProvider' | 'rawProvider'> = {}
): PiModelLookupCandidate[] {
  const keyProvider =
    options.configProvider === 'custom' ? 'anthropic' : options.configProvider || 'anthropic';
  const rawProvider = options.rawProvider?.trim() || '';
  const trimmedModel = modelString.trim();
  const parts = trimmedModel.split('/');
  const seen = new Set<string>();
  const candidates: PiModelLookupCandidate[] = [];

  if (parts.length >= 2) {
    const parsedProvider = parts[0];
    const parsedModelId = parts.slice(1).join('/');

    if (rawProvider && rawProvider !== keyProvider && rawProvider !== parsedProvider) {
      addLookupCandidate(candidates, seen, rawProvider, trimmedModel);
    }
    if (keyProvider !== parsedProvider) {
      addLookupCandidate(candidates, seen, keyProvider, trimmedModel);
    }
    addLookupCandidate(candidates, seen, parsedProvider, parsedModelId);
    for (const fallbackProvider of COMMON_FALLBACK_PROVIDERS) {
      addLookupCandidate(candidates, seen, fallbackProvider, parsedModelId);
    }
    return candidates;
  }

  addLookupCandidate(candidates, seen, keyProvider, trimmedModel);
  for (const fallbackProvider of COMMON_FALLBACK_PROVIDERS) {
    addLookupCandidate(candidates, seen, fallbackProvider, trimmedModel);
  }
  return candidates;
}

export function applyPiModelRuntimeOverrides(
  model: Model<Api>,
  options: PiModelLookupOptions = {}
): Model<Api> {
  let nextModel = model;
  const knownSpecs = lookupModelSpecsForModel(nextModel, options.requestedModelString);
  if (knownSpecs) {
    nextModel = {
      ...nextModel,
      contextWindow: knownSpecs.contextWindow,
      maxTokens: knownSpecs.maxTokens,
    } as typeof nextModel;
  }

  const isCustomProvider = options.rawProvider === 'custom' || options.configProvider === 'custom';
  const shouldHonorConfiguredBaseUrl = options.rawProvider === 'openai' || isCustomProvider;
  const modelHasBaseUrl = Boolean(nextModel.baseUrl);

  if (options.customBaseUrl && (shouldHonorConfiguredBaseUrl || !modelHasBaseUrl)) {
    nextModel = { ...nextModel, baseUrl: options.customBaseUrl } as typeof nextModel;
  }

  const effectiveProvider = options.rawProvider || options.configProvider;
  if (options.customBaseUrl && isCustomProvider && nextModel.api === 'openai-responses') {
    // Most custom OpenAI-compatible relays only implement chat/completions.
    nextModel = { ...nextModel, api: 'openai-completions' } as typeof nextModel;
  }
  if (effectiveProvider === 'openrouter' && nextModel.api !== 'openai-completions') {
    nextModel = { ...nextModel, api: 'openai-completions' } as typeof nextModel;
  }
  if (shouldDisableDeveloperRoleForEndpoint(nextModel, options)) {
    nextModel = {
      ...nextModel,
      compat: {
        ...(nextModel.compat || {}),
        supportsDeveloperRole: false,
        supportsStore: false,
      },
    } as typeof nextModel;
  }

  if (
    options.rawProvider === 'ollama' &&
    nextModel.reasoning &&
    nextModel.api === 'openai-completions'
  ) {
    const currentCompat = (nextModel.compat || {}) as Record<string, unknown>;
    const currentReasoningEffortMap = (
      currentCompat.reasoningEffortMap && typeof currentCompat.reasoningEffortMap === 'object'
        ? currentCompat.reasoningEffortMap
        : {}
    ) as Record<string, string>;
    nextModel = {
      ...nextModel,
      compat: {
        ...currentCompat,
        supportsReasoningEffort: true,
        reasoningEffortMap: {
          ...currentReasoningEffortMap,
          off: 'none',
        },
      },
    } as typeof nextModel;
  }

  // Handle custom provider with explicit protocol override
  if (isCustomProvider && options.customProtocol) {
    const targetApi = inferPiApi(options.customProtocol);
    if (nextModel.api !== targetApi) {
      nextModel = { ...nextModel, api: targetApi } as typeof nextModel;
    }
  }

  return nextModel;
}

export function resolvePiRegistryModel(
  modelString: string,
  options: PiModelLookupOptions = {}
): Model<Api> | undefined {
  for (const candidate of buildPiModelLookupCandidates(modelString, options)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (getModel as (...args: unknown[]) => Model<Api> | undefined)(
      candidate.provider as PiRegistryProvider,
      candidate.model
    );
    if (model) {
      return applyPiModelRuntimeOverrides(model, {
        ...options,
        requestedModelString: modelString,
      });
    }
  }
  return undefined;
}
