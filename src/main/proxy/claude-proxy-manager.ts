import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { AppConfig } from '../config/config-store';
import { log, logError, logWarn } from '../utils/logger';
import {
  resolveUnifiedGatewayProfile,
  type ProxyRouteDecision,
  type UnifiedGatewayProfile,
} from '../claude/unified-gateway-resolver';

const PROXY_VENDOR_COMMIT = 'dd4a29aff3b470710187505daaeed20ea025e5bf';
const PROXY_SDK_API_KEY = 'sk-ant-local-proxy';
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT_START = 18082;
const PROXY_PORT_END = 18120;
const PROXY_START_TIMEOUT_MS = 25000;
const PROXY_STOP_TIMEOUT_MS = 5000;
const PROXY_STALE_TTL_MS = 10 * 60 * 1000;
const PROXY_MAX_POOL_SIZE = 4;
export const PROXY_RUNTIME_VERSION_FILENAME = 'runtime-version.txt';
export const PROXY_REQUIREMENTS_FINGERPRINT = [
  `vendor=${PROXY_VENDOR_COMMIT}`,
  'fastapi[standard]>=0.115.11',
  'uvicorn>=0.34.0',
  'httpx>=0.25.0',
  'pydantic>=2.0.0',
  'litellm>=1.77.7',
  'python-dotenv>=1.0.0',
  'google-auth>=2.41.1',
  'google-cloud-aiplatform>=1.120.0',
].join('|');

export interface ClaudeProxyRuntimeState {
  baseUrl: string;
  host: string;
  port: number;
  upstreamKind: UnifiedGatewayProfile['upstreamKind'];
  signature: string;
  sdkApiKey: string;
  pid: number;
}

interface ActiveProxyState extends ClaudeProxyRuntimeState {
  process: ChildProcess;
  logs: string[];
  startedAt: number;
  lastUsedAt: number;
  leaseCount: number;
}

interface ResolvedPythonRuntime {
  python: string;
  pythonRoot?: string;
  env: NodeJS.ProcessEnv;
  source: 'bundled' | 'venv';
}

let _cachedVendorRoot: string | null | undefined;
function resolveVendorRoot(): string | null {
  if (_cachedVendorRoot !== undefined) return _cachedVendorRoot;

  let appPathCandidate = '';
  try {
    if (typeof app?.getAppPath === 'function') {
      appPathCandidate = app.getAppPath();
    }
  } catch {
    appPathCandidate = '';
  }

  const candidates = [
    path.resolve(process.cwd(), 'vendor', 'claude-code-proxy'),
    path.resolve(process.cwd(), 'src', 'vendor', 'claude-code-proxy'),
    path.resolve(process.cwd(), 'app.asar.unpacked', 'vendor', 'claude-code-proxy'),
    ...(appPathCandidate ? [path.resolve(appPathCandidate, 'vendor', 'claude-code-proxy')] : []),
    ...(appPathCandidate ? [path.resolve(appPathCandidate, 'app.asar.unpacked', 'vendor', 'claude-code-proxy')] : []),
    path.resolve(process.resourcesPath || '', 'vendor', 'claude-code-proxy'),
    path.resolve(process.resourcesPath || '', 'app.asar.unpacked', 'vendor', 'claude-code-proxy'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'server.py'))) {
      _cachedVendorRoot = candidate;
      return candidate;
    }
  }
  _cachedVendorRoot = null;
  return null;
}

function resolveRuntimeRoot(): string {
  try {
    if (typeof app?.getPath === 'function') {
      return path.join(app.getPath('userData'), 'claude-proxy-runtime');
    }
  } catch {
    // Fall through to temp dir in unit tests or non-Electron runtime.
  }
  return path.join(os.tmpdir(), 'open-cowork', 'claude-proxy-runtime');
}

function resolveVenvPython(runtimeRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(runtimeRoot, 'venv', 'Scripts', 'python.exe');
  }
  return path.join(runtimeRoot, 'venv', 'bin', 'python3');
}

function resolveVersionMarker(runtimeRoot: string): string {
  return path.join(runtimeRoot, PROXY_RUNTIME_VERSION_FILENAME);
}

function buildBundledPythonEnv(pythonRoot: string): NodeJS.ProcessEnv {
  const extraSite = path.join(pythonRoot, 'site-packages');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONHOME: pythonRoot,
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUTF8: '1',
  };
  if (fs.existsSync(extraSite)) {
    env.PYTHONPATH = [extraSite, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  }
  return env;
}

function hasBundledProxyDependencies(pythonRoot: string): boolean {
  const sitePackages = path.join(pythonRoot, 'site-packages');
  if (!fs.existsSync(sitePackages)) {
    return false;
  }
  const markerFile = resolveVersionMarker(pythonRoot);
  const marker = fs.existsSync(markerFile) ? fs.readFileSync(markerFile, 'utf-8').trim() : '';
  if (marker !== PROXY_REQUIREMENTS_FINGERPRINT) {
    return false;
  }

  const requiredEntries = [
    path.join(sitePackages, 'fastapi'),
    path.join(sitePackages, 'uvicorn'),
    path.join(sitePackages, 'httpx'),
    path.join(sitePackages, 'pydantic'),
    path.join(sitePackages, 'litellm'),
    path.join(sitePackages, 'dotenv'),
    path.join(sitePackages, 'google', 'auth'),
    path.join(sitePackages, 'google', 'cloud', 'aiplatform'),
  ];

  return requiredEntries.every((candidate) => fs.existsSync(candidate));
}

function resolveResourcesDirCandidates(): string[] {
  const candidates = [
    process.env.OPEN_COWORK_RESOURCES_PATH?.trim(),
    process.resourcesPath?.trim(),
    path.resolve(process.cwd(), 'resources'),
    path.resolve(__dirname, '..', '..', '..', 'resources'),
    path.resolve(__dirname, '..', '..', '..', '..', 'resources'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return [...new Set(candidates)];
}

export function resolveBundledPythonCandidate(
  options: {
    platform?: NodeJS.Platform;
    arch?: string;
    resourcesPath?: string;
  } = {}
): string | null {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' && platform !== 'linux') {
    return null;
  }

  const arch = (options.arch ?? process.arch) === 'arm64' ? 'arm64' : 'x64';
  const resourcesCandidates = options.resourcesPath
    ? [options.resourcesPath, ...resolveResourcesDirCandidates()]
    : resolveResourcesDirCandidates();
  const candidatePaths = resourcesCandidates.flatMap((resourcesDir) => ([
    path.join(resourcesDir, 'python', 'bin', 'python3'),
    path.join(resourcesDir, 'python', `${platform}-${arch}`, 'bin', 'python3'),
  ]));

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function resolveBundledPythonRuntime(
  options: {
    platform?: NodeJS.Platform;
    arch?: string;
    resourcesPath?: string;
  } = {}
): ResolvedPythonRuntime | null {
  const bundledPython = resolveBundledPythonCandidate(options);
  if (!bundledPython) {
    return null;
  }

  const pythonRoot = path.resolve(bundledPython, '..', '..');
  if (!hasBundledProxyDependencies(pythonRoot)) {
    return null;
  }

  return {
    python: bundledPython,
    pythonRoot,
    env: buildBundledPythonEnv(pythonRoot),
    source: 'bundled',
  };
}

function resolveSystemPythonCandidate(): string {
  const explicit = process.env.OPEN_COWORK_PYTHON_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const candidates = process.platform === 'win32'
    ? ['python.exe', 'python']
    : ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3', 'python'];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // Continue.
    }
  }

  throw new Error(
    'proxy_boot_failed:python_not_found:Unable to resolve python3 runtime for claude-code-proxy'
  );
}

function resolveBootstrapPythonCandidate(): string {
  const explicit = process.env.OPEN_COWORK_PYTHON_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }

  const bundled = resolveBundledPythonCandidate();
  if (bundled) {
    return bundled;
  }

  return resolveSystemPythonCandidate();
}

export function buildProfileSignature(profile: UnifiedGatewayProfile): string {
  const serialized = JSON.stringify({
    upstreamKind: profile.upstreamKind,
    upstreamBaseUrl: profile.upstreamBaseUrl,
    upstreamApiKey: profile.upstreamApiKey,
    upstreamHeaders: profile.upstreamHeaders || {},
    model: profile.model,
    provider: profile.provider,
    customProtocol: profile.customProtocol || 'anthropic',
    openaiAccountId: profile.openaiAccountId || '',
    useCodexOAuth: Boolean(profile.useCodexOAuth),
  });
  return createHash('sha256').update(serialized).digest('hex');
}

function trimLogs(lines: string[]): string {
  if (lines.length === 0) {
    return '';
  }
  return lines.slice(-12).join('\n');
}

async function waitForProcessExit(processRef: ChildProcess, timeoutMs: number): Promise<void> {
  if (processRef.exitCode !== null || processRef.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    }, timeoutMs);
    processRef.once('exit', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, PROXY_HOST);
  });
}

async function findAvailablePort(start = PROXY_PORT_START, end = PROXY_PORT_END): Promise<number> {
  const BATCH_SIZE = 8;
  for (let batchStart = start; batchStart <= end; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, end);
    const ports = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);
    const results = await Promise.all(ports.map(checkPortAvailable));
    for (let i = 0; i < results.length; i++) {
      if (results[i]) {
        return ports[i];
      }
    }
  }
  throw new Error(`proxy_boot_failed:no_available_port:${start}-${end}`);
}

export function buildProxyEnvironment(profile: UnifiedGatewayProfile): NodeJS.ProcessEnv {
  const preferredProvider = profile.upstreamKind === 'gemini' ? 'google' : profile.upstreamKind;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PREFERRED_PROVIDER: preferredProvider,
    BIG_MODEL: profile.model,
    SMALL_MODEL: profile.model,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_BASE_URL: '',
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: '',
    OPENAI_ACCOUNT_ID: '',
    OPENAI_CODEX_OAUTH: '0',
    OPENAI_DEFAULT_HEADERS_JSON: '',
    GEMINI_API_KEY: '',
    GEMINI_BASE_URL: '',
    USE_VERTEX_AUTH: '0',
    VERTEX_PROJECT: '',
    VERTEX_LOCATION: '',
  };

  if (profile.upstreamKind === 'openai') {
    env.OPENAI_API_KEY = profile.upstreamApiKey;
    env.OPENAI_BASE_URL = profile.upstreamBaseUrl;
    env.OPENAI_CODEX_OAUTH = profile.useCodexOAuth ? '1' : '0';
    if (profile.openaiAccountId) {
      env.OPENAI_ACCOUNT_ID = profile.openaiAccountId;
    }
    if (profile.upstreamHeaders && Object.keys(profile.upstreamHeaders).length > 0) {
      env.OPENAI_DEFAULT_HEADERS_JSON = JSON.stringify(profile.upstreamHeaders);
    }
  } else if (profile.upstreamKind === 'anthropic') {
    env.ANTHROPIC_API_KEY = profile.upstreamApiKey;
    env.ANTHROPIC_BASE_URL = profile.upstreamBaseUrl;
  } else {
    env.GEMINI_API_KEY = profile.upstreamApiKey;
    env.GEMINI_BASE_URL = profile.upstreamBaseUrl;
  }

  return env;
}

async function waitForHealthy(baseUrl: string, processRef: ChildProcess, logs: string[]): Promise<void> {
  const deadline = Date.now() + PROXY_START_TIMEOUT_MS;
  let lastError = '';
  let delay = 50;
  const MAX_DELAY = 400;
  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(
        `proxy_boot_failed:process_exited:${processRef.exitCode}:${lastError || trimLogs(logs)}`
      );
    }

    try {
      const response = await fetch(`${baseUrl}/`, { method: 'GET' });
      if (response.ok) {
        return;
      }
      lastError = `status=${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.ceil(delay * 1.6), MAX_DELAY);
  }

  throw new Error(`proxy_health_failed:timeout:${lastError || trimLogs(logs)}`);
}

export class ClaudeProxyManager {
  private activeStates = new Map<string, ActiveProxyState>();
  private latestSignature: string | null = null;
  private operationQueue: Promise<unknown> = Promise.resolve();
  private _cachedPythonRuntime: ResolvedPythonRuntime | null = null;
  private _warmupPromise: Promise<void> | null = null;
  private _warmupStatus: 'idle' | 'warming' | 'ready' | 'failed' = 'idle';

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  isEnabled(): boolean {
    return process.env.COWORK_DISABLE_CLAUDE_PROXY !== '1';
  }

  get warmupStatus() { return this._warmupStatus; }

  getCurrentState(): ClaudeProxyRuntimeState | null {
    const latest = this.latestSignature ? this.activeStates.get(this.latestSignature) : null;
    if (latest && latest.process.exitCode === null) {
      const { process: _ignored, logs: _logs, ...rest } = latest;
      return rest;
    }

    const fallback = Array.from(this.activeStates.values()).find((state) => state.process.exitCode === null);
    if (!fallback) {
      return null;
    }
    const { process: _ignored, logs: _logs, ...rest } = fallback;
    return rest;
  }

  resolveRoute(config: AppConfig): ProxyRouteDecision {
    return resolveUnifiedGatewayProfile(config);
  }

  async ensureReadyForConfig(config: AppConfig): Promise<ClaudeProxyRuntimeState> {
    const decision = this.resolveRoute(config);
    if (!decision.ok || !decision.profile) {
      const reason = decision.reason || 'unknown';
      if (reason === 'missing_key') {
        throw new Error('proxy_upstream_auth_failed:missing_key');
      }
      if (reason === 'missing_base_url') {
        throw new Error('proxy_upstream_not_found:missing_base_url');
      }
      throw new Error(`proxy_upstream_not_found:${reason}`);
    }
    return this.ensureReady(decision.profile);
  }

  async warmupForConfig(config: AppConfig): Promise<void> {
    if (!this.isEnabled()) {
      await this.stop();
      return;
    }
    const decision = this.resolveRoute(config);
    if (!decision.ok || !decision.profile) {
      logWarn('[ClaudeProxy] Skip warmup due to unresolved route', {
        reason: decision.reason,
        provider: config.provider,
        customProtocol: config.customProtocol,
        liveProxyCount: this.getLiveStates().length,
      });
      await this.pruneStaleStates(new Set());
      return;
    }
    this._warmupStatus = 'warming';
    this._warmupPromise = (async () => {
      await this.ensureReady(decision.profile!);
    })();
    try {
      await this._warmupPromise;
      this._warmupStatus = 'ready';
    } catch (err) {
      this._warmupStatus = 'failed';
      throw err;
    }
  }

  async awaitWarmup(timeoutMs = 5000): Promise<boolean> {
    if (!this._warmupPromise || this._warmupStatus === 'ready') return true;
    if (this._warmupStatus === 'failed') return false;
    try {
      await Promise.race([
        this._warmupPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('warmup_timeout')), timeoutMs)),
      ]);
      return true;
    } catch { return false; }
  }

  async ensureReady(profile: UnifiedGatewayProfile): Promise<ClaudeProxyRuntimeState> {
    if (!this.isEnabled()) {
      throw new Error('proxy_boot_failed:disabled_by_env');
    }

    const signature = buildProfileSignature(profile);

    // Lock-free fast path: warm proxy available, skip the queue entirely.
    const existing = this.activeStates.get(signature);
    if (existing && existing.process.exitCode === null) {
      existing.lastUsedAt = Date.now();
      this.latestSignature = signature;
      void this.pruneStaleStates(new Set([signature]));
      const { process: _process, logs: _logs, ...rest } = existing;
      return rest;
    }

    // Cold path: serialize through the queue (spawn is not idempotent).
    return this.enqueue(async () => {
      // Re-check: another caller may have spawned it while we waited.
      const rechecked = this.activeStates.get(signature);
      if (rechecked && rechecked.process.exitCode === null) {
        rechecked.lastUsedAt = Date.now();
        this.latestSignature = signature;
        void this.pruneStaleStates(new Set([signature]));
        const { process: _process, logs: _logs, ...rest } = rechecked;
        return rest;
      }

      const startedState = await this.startInternal(profile, signature);
      this.activeStates.set(signature, startedState);
      this.latestSignature = signature;
      await this.pruneStaleStates(new Set([signature]));
      const { process: _process, logs: _logs, ...rest } = startedState;
      return rest;
    });
  }

  retain(signature: string): void {
    const state = this.activeStates.get(signature);
    if (!state || state.process.exitCode !== null) {
      return;
    }
    state.leaseCount += 1;
    state.lastUsedAt = Date.now();
  }

  release(signature: string): void {
    const state = this.activeStates.get(signature);
    if (!state || state.process.exitCode !== null) {
      return;
    }
    state.leaseCount = Math.max(0, state.leaseCount - 1);
    state.lastUsedAt = Date.now();
    // Schedule prune check asynchronously — no need to block the caller.
    if (state.leaseCount === 0) {
      void this.enqueue(() => this.pruneStaleStates(new Set()));
    }
  }

  async stop(): Promise<void> {
    await this.enqueue(async () => {
      const states = Array.from(this.activeStates.values());
      for (const state of states) {
        await this.stopStateInternal(state);
      }
      this.activeStates.clear();
      this.latestSignature = null;
    });
  }

  private getLiveStates(): ActiveProxyState[] {
    return Array.from(this.activeStates.values()).filter((state) => state.process.exitCode === null);
  }

  private removeState(signature: string, state?: ActiveProxyState): void {
    const existing = this.activeStates.get(signature);
    if (!existing) {
      return;
    }
    if (state && existing !== state) {
      return;
    }
    this.activeStates.delete(signature);
    if (this.latestSignature === signature) {
      this.latestSignature = this.getLiveStates().at(-1)?.signature || null;
    }
  }

  private async pruneStaleStates(keepSignatures: Set<string>): Promise<void> {
    const now = Date.now();
    const liveStates = this.getLiveStates();
    const staleCandidates = liveStates
      .filter((state) => !keepSignatures.has(state.signature) && state.leaseCount === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    const statesToStop: ActiveProxyState[] = [];

    for (const state of staleCandidates) {
      if (now - state.lastUsedAt > PROXY_STALE_TTL_MS) {
        statesToStop.push(state);
      }
    }

    let remainingLiveCount = liveStates.length - statesToStop.length;
    for (const state of staleCandidates) {
      if (remainingLiveCount <= PROXY_MAX_POOL_SIZE) {
        break;
      }
      if (statesToStop.includes(state)) {
        continue;
      }
      statesToStop.push(state);
      remainingLiveCount -= 1;
    }

    for (const state of statesToStop) {
      await this.stopStateInternal(state);
      this.removeState(state.signature, state);
    }
  }

  private async ensurePythonRuntime(vendorRoot: string): Promise<ResolvedPythonRuntime> {
    if (this._cachedPythonRuntime) return this._cachedPythonRuntime;

    const bundledRuntime = resolveBundledPythonRuntime();
    if (bundledRuntime) {
      this._cachedPythonRuntime = bundledRuntime;
      return bundledRuntime;
    }

    const runtimeRoot = resolveRuntimeRoot();
    fs.mkdirSync(runtimeRoot, { recursive: true });

    const venvPython = resolveVenvPython(runtimeRoot);
    const markerFile = resolveVersionMarker(runtimeRoot);
    const marker = fs.existsSync(markerFile) ? fs.readFileSync(markerFile, 'utf-8').trim() : '';

    if (fs.existsSync(venvPython) && marker === PROXY_REQUIREMENTS_FINGERPRINT) {
      const result: ResolvedPythonRuntime = {
        python: venvPython,
        env: { ...process.env },
        source: 'venv',
      };
      this._cachedPythonRuntime = result;
      return result;
    }

    const bootstrapPython = resolveBootstrapPythonCandidate();
    if (!fs.existsSync(venvPython)) {
      execFileSync(bootstrapPython, ['-m', 'venv', path.join(runtimeRoot, 'venv')], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      });
    }

    execFileSync(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
      cwd: vendorRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024 * 10,
      timeout: 180_000,
    });
    execFileSync(
      venvPython,
      ['-m', 'pip', 'install', '--upgrade', ...PROXY_REQUIREMENTS_FINGERPRINT.split('|').slice(1)],
      {
        cwd: vendorRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 1024 * 1024 * 20,
        timeout: 300_000,
      }
    );

    fs.writeFileSync(markerFile, PROXY_REQUIREMENTS_FINGERPRINT, 'utf-8');
    const result: ResolvedPythonRuntime = {
      python: venvPython,
      env: { ...process.env },
      source: 'venv',
    };
    this._cachedPythonRuntime = result;
    return result;
  }

  private async startInternal(
    profile: UnifiedGatewayProfile,
    signature: string
  ): Promise<ActiveProxyState> {
    const vendorRoot = resolveVendorRoot();
    if (!vendorRoot) {
      throw new Error('proxy_boot_failed:vendor_not_found');
    }
    log('[ClaudeProxy] Resolved vendor root', { vendorRoot });

    const pythonRuntime = await this.ensurePythonRuntime(vendorRoot);
    const port = await findAvailablePort();
    const baseUrl = `http://${PROXY_HOST}:${port}`;

    const logs: string[] = [];
    const child = spawn(
      pythonRuntime.python,
      ['-m', 'uvicorn', 'server:app', '--host', PROXY_HOST, '--port', String(port), '--log-level', 'warning'],
      {
        cwd: vendorRoot,
        env: {
          ...pythonRuntime.env,
          ...buildProxyEnvironment(profile),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    child.stdout?.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (line) logs.push(line);
      if (logs.length > 200) logs.shift();
    });
    child.stderr?.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (line) logs.push(line);
      if (logs.length > 200) logs.shift();
    });

    try {
      await waitForHealthy(baseUrl, child, logs);
    } catch (error) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore kill failures.
      }
      await waitForProcessExit(child, 1500);
      throw error;
    }

    const now = Date.now();
    const state: ActiveProxyState = {
      baseUrl,
      host: PROXY_HOST,
      port,
      upstreamKind: profile.upstreamKind,
      signature,
      sdkApiKey: PROXY_SDK_API_KEY,
      pid: child.pid || -1,
      process: child,
      logs,
      startedAt: now,
      lastUsedAt: now,
      leaseCount: 0,
    };
    child.once('exit', () => {
      this.removeState(signature, state);
    });

    log('[ClaudeProxy] Started', {
      baseUrl,
      upstreamKind: profile.upstreamKind,
      pid: child.pid || -1,
      provider: profile.provider,
      customProtocol: profile.customProtocol,
      vendorCommit: PROXY_VENDOR_COMMIT,
      pythonSource: pythonRuntime.source,
    });

    return state;
  }

  private async stopStateInternal(state: ActiveProxyState): Promise<void> {
    if (state.process.exitCode !== null) {
      this.removeState(state.signature, state);
      return;
    }

    try {
      if (state.process.exitCode === null) {
        state.process.kill('SIGTERM');
      }
      await waitForProcessExit(state.process, PROXY_STOP_TIMEOUT_MS);
      if (state.process.exitCode === null) {
        state.process.kill('SIGKILL');
        await waitForProcessExit(state.process, 1500);
      }
      if (state.process.exitCode === null) {
        throw new Error('proxy_stop_failed:process_still_running_after_sigkill');
      }
    } catch (error) {
      logError('[ClaudeProxy] Failed to stop process cleanly', error);
      throw error;
    }

    this.removeState(state.signature, state);
    log('[ClaudeProxy] Stopped', {
      pid: state.pid,
      port: state.port,
    });
  }
}

export const claudeProxyManager = new ClaudeProxyManager();
