import { createHash } from 'node:crypto';

export interface PiSessionRuntimeSignatureInput {
  configProvider?: string;
  customProtocol?: string;
  modelProvider?: string;
  modelApi?: string;
  modelBaseUrl?: string;
  effectiveCwd?: string;
  apiKey?: string;
}

export interface PiSessionRuntimeSignatureParts {
  configProvider: string;
  customProtocol: string;
  modelProvider: string;
  modelApi: string;
  modelBaseUrl: string;
  effectiveCwd: string;
  apiKeyFingerprint: string;
}

function normalizeText(value: string | undefined): string {
  return value?.trim() || '';
}

function fingerprintSecret(value: string | undefined): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  return createHash('sha256').update(normalized).digest('hex');
}

export function buildPiSessionRuntimeSignature(
  input: PiSessionRuntimeSignatureInput,
): string {
  return JSON.stringify({
    configProvider: normalizeText(input.configProvider),
    customProtocol: normalizeText(input.customProtocol),
    modelProvider: normalizeText(input.modelProvider),
    modelApi: normalizeText(input.modelApi),
    modelBaseUrl: normalizeText(input.modelBaseUrl).replace(/\/+$/, ''),
    effectiveCwd: normalizeText(input.effectiveCwd),
    apiKeyFingerprint: fingerprintSecret(input.apiKey),
  });
}

function parsePiSessionRuntimeSignature(
  signature: string,
): PiSessionRuntimeSignatureParts | null {
  try {
    const parsed = JSON.parse(signature) as Partial<PiSessionRuntimeSignatureParts>;
    return {
      configProvider: normalizeText(parsed.configProvider),
      customProtocol: normalizeText(parsed.customProtocol),
      modelProvider: normalizeText(parsed.modelProvider),
      modelApi: normalizeText(parsed.modelApi),
      modelBaseUrl: normalizeText(parsed.modelBaseUrl).replace(/\/+$/, ''),
      effectiveCwd: normalizeText(parsed.effectiveCwd),
      apiKeyFingerprint: normalizeText(parsed.apiKeyFingerprint),
    };
  } catch {
    return null;
  }
}

export function diffPiSessionRuntimeSignatures(
  previous: string,
  next: string,
): string[] {
  const previousParts = parsePiSessionRuntimeSignature(previous);
  const nextParts = parsePiSessionRuntimeSignature(next);

  if (!previousParts || !nextParts) {
    return ['signature_parse_failed'];
  }

  const changedKeys: string[] = [];
  const keys = Object.keys(previousParts) as Array<keyof PiSessionRuntimeSignatureParts>;
  for (const key of keys) {
    if (previousParts[key] !== nextParts[key]) {
      changedKeys.push(key);
    }
  }
  return changedKeys;
}
