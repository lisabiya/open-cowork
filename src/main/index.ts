/**
 * @module main/index
 *
 * Electron main-process entry point (2181 lines).
 *
 * Responsibilities:
 * - App lifecycle: ready, activate, before-quit, window-will-close
 * - Central IPC hub: ~60 handlers namespaced as config.*, mcp.*, session.*,
 *   sandbox.*, logs.*, remote.*, schedule.*, etc.
 * - BrowserWindow creation and deep-link / protocol handling
 *
 * Dependencies: session-manager, config-store, mcp-manager, sandbox-adapter,
 *               skills-manager, scheduled-task-manager, nav-server, remote-manager
 */
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, Tray } from 'electron';
import { join, resolve, dirname, isAbsolute, basename } from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { config } from 'dotenv';
import { initDatabase, closeDatabase } from './db/database';
import { SessionManager } from './session/session-manager';
import { SkillsManager } from './skills/skills-manager';
import { PluginCatalogService } from './skills/plugin-catalog-service';
import { PluginRuntimeService } from './skills/plugin-runtime-service';
import { configStore, type AppConfig, type AppTheme } from './config/config-store';
import { shutdownSandbox } from './sandbox/sandbox-adapter';
import { SandboxSync } from './sandbox/sandbox-sync';
import { getSandboxBootstrap } from './sandbox/sandbox-bootstrap';
import type { ClientEvent, ServerEvent } from '../renderer/types';
import { remoteManager, type AgentExecutor } from './remote/remote-manager';
import { remoteConfigStore } from './remote/remote-config-store';
import { startNavServer, stopNavServer } from './nav-server';
import { ScheduledTaskManager } from './schedule/scheduled-task-manager';
import { createScheduledTaskStore } from './schedule/scheduled-task-store';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from '../shared/schedule/task-title';
import {
  isUncPath,
  isWindowsDrivePath,
  localPathFromAppUrlPathname,
  localPathFromFileUrl,
  decodePathSafely,
} from '../shared/local-file-path';
import { eventRequiresSessionManager } from './client-event-utils';
import { getUnsupportedWorkspacePathReason } from './workspace-path-constraints';
import { log, logWarn, logError, closeLogFile, setDevLogsEnabled } from './utils/logger';
import { listRecentWorkspaceFiles } from './utils/recent-workspace-files';
import { registerConfigHandlers } from './ipc/config-handlers';
import { registerMcpHandlers } from './ipc/mcp-handlers';
import { registerSkillsHandlers } from './ipc/skills-handlers';
import { registerSandboxHandlers } from './ipc/sandbox-handlers';
import { registerLogHandlers } from './ipc/log-handlers';
import { registerRemoteHandlers } from './ipc/remote-handlers';
import { registerScheduleHandlers } from './ipc/schedule-handlers';

// Current working directory used for new sessions and relative path resolution.
let currentWorkingDir: string | null = null;

// Load .env file from project root (for development)
const envPath = resolve(__dirname, '../../.env');
log('[dotenv] Loading from:', envPath);
const dotenvResult = config({ path: envPath });
if (dotenvResult.error) {
  logWarn('[dotenv] Failed to load .env:', dotenvResult.error.message);
} else {
  log('[dotenv] Loaded successfully');
}

// Apply saved config (this overrides .env if config exists)
if (configStore.isConfigured()) {
  log('[Config] Applying saved configuration...');
  configStore.applyToEnv();
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let sessionManager: SessionManager | null = null;
let skillsManager: SkillsManager | null = null;
let pluginRuntimeService: PluginRuntimeService | null = null;
let scheduledTaskManager: ScheduledTaskManager | null = null;

function sanitizeDiagnosticBaseUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.origin}${pathname}`;
  } catch {
    return value.replace(/[?#].*$/, '');
  }
}

async function resolveScheduledTaskTitle(
  prompt: string,
  _cwd?: string,
  fallbackTitle?: string
): Promise<string> {
  const normalizedPrompt = prompt.trim();
  const fallback = fallbackTitle
    ? buildScheduledTaskTitle(fallbackTitle)
    : buildScheduledTaskFallbackTitle(normalizedPrompt);
  if (!sessionManager) {
    return fallback;
  }
  try {
    return await sessionManager.generateScheduledTaskTitle(normalizedPrompt);
  } catch (error) {
    logWarn('[Schedule] Failed to generate title via session title flow, using fallback', error);
    return fallback;
  }
}

async function waitForDevServer(url: string, maxAttempts = 30, intervalMs = 500): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        if (attempt > 1) {
          log(`[App] Dev server ready after ${attempt} attempt(s): ${url}`);
        }
        return true;
      }
    } catch {
      // Ignore and retry until timeout
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  logWarn(`[App] Dev server did not become ready within timeout: ${url}`);
  return false;
}

// Single-instance lock: skip in dev mode so vite-plugin-electron can restart freely
// without the old process blocking the new one during async cleanup.
const isDev = !!process.env.VITE_DEV_SERVER_URL;
const ELECTRON_DEVTOOLS_DEBUG_PORT = '9223';

// Enable Chrome DevTools Protocol in dev mode so the renderer can be inspected
// via chrome://inspect or connected to by Puppeteer/Playwright at localhost:9223.
// Chrome MCP uses 9222, so keep Electron on a separate port in development.
if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', ELECTRON_DEVTOOLS_DEBUG_PORT);
  app.commandLine.appendSwitch(
    'remote-allow-origins',
    `http://localhost:${ELECTRON_DEVTOOLS_DEBUG_PORT}`
  );
}

const hasSingleInstanceLock = isDev || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logWarn('[App] Another instance is already running, quitting this instance');
  app.quit();
} else if (!isDev) {
  app.on('second-instance', () => {
    const existingWindow =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

    if (!existingWindow) {
      log('[App] No existing window found, creating new one');
      createWindow();
      return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = existingWindow;
    }
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.show();
    existingWindow.focus();
    log('[App] Blocked second instance and focused existing window');
  });
}

// Tray instance (kept alive to prevent GC)
let tray: Tray | null = null;
const DARK_BG = '#171614';
const LIGHT_BG = '#f5f3ee';

function buildMacMenu() {
  if (process.platform !== 'darwin') return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'CmdOrCtrl+,',
          click: () =>
            mainWindow?.webContents.send('server-event', { type: 'navigate', payload: 'settings' }),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray() {
  if (tray) return;

  // Use .ico on Windows for proper multi-resolution tray support; fall back to .png if absent
  const iconName =
    process.platform === 'darwin'
      ? 'tray-iconTemplate.png'
      : process.platform === 'win32'
        ? 'tray-icon.ico'
        : 'tray-icon.png';
  // TODO: create resources/tray-icon.ico from tray-icon.png for full Windows tray fidelity
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, iconName)
    : join(__dirname, '../../resources', iconName);

  // On Windows, fall back to .png if the .ico file has not been created yet
  const resolvedIconPath =
    process.platform === 'win32' && !fs.existsSync(iconPath)
      ? app.isPackaged
        ? join(process.resourcesPath, 'tray-icon.png')
        : join(__dirname, '../../resources', 'tray-icon.png')
      : iconPath;

  // Gracefully skip tray if icon is missing (e.g. dev environment)
  if (!fs.existsSync(resolvedIconPath)) {
    log('[Tray] Icon not found at', resolvedIconPath, '— skipping tray setup');
    return;
  }

  tray = new Tray(resolvedIconPath);
  tray.setToolTip('Open Cowork');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide Window',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'New Session',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('server-event', { type: 'new-session' });
        }
      },
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('server-event', { type: 'navigate', payload: 'settings' });
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getSavedThemePreference(): AppTheme {
  const theme = configStore.get('theme');
  return theme === 'dark' || theme === 'system' ? theme : 'light';
}

function resolveEffectiveTheme(theme: AppTheme): 'dark' | 'light' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return theme;
}

function applyNativeThemePreference(theme: AppTheme): void {
  nativeTheme.themeSource = theme;
}

function createWindow() {
  const savedTheme = getSavedThemePreference();
  applyNativeThemePreference(savedTheme);
  const effectiveTheme = resolveEffectiveTheme(savedTheme);
  const THEME =
    effectiveTheme === 'dark'
      ? {
          background: DARK_BG,
          titleBar: DARK_BG,
          titleBarSymbol: '#f1ece4',
        }
      : {
          background: LIGHT_BG,
          titleBar: LIGHT_BG,
          titleBarSymbol: '#1a1a1a',
        };

  // Platform-specific window configuration
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  // Base window options
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: THEME.background,
    icon: (() => {
      const windowIconName = isMac ? 'icon.icns' : isWindows ? 'icon.ico' : 'icon.png';
      return app.isPackaged
        ? join(process.resourcesPath, windowIconName)
        : join(__dirname, `../../resources/${windowIconName}`);
    })(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };

  if (isMac) {
    // macOS: Use hiddenInset for native traffic light buttons
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    // Windows: Use frameless window with custom titlebar
    // Note: frame: false removes native frame, allowing custom titlebar
    windowOptions.frame = false;
  } else {
    // Linux: Use frameless window
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);

  const allowedOrigins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
    } catch {
      // 忽略无效的开发服务地址
    }
  }
  const allowedProtocols = new Set<string>(['file:', 'devtools:']);

  const isExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (allowedProtocols.has(parsed.protocol)) {
        return false;
      }
      if (allowedOrigins.has(parsed.origin)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const extractLocalPathFromNavigationUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') {
        return localPathFromFileUrl(url);
      }
      if (!allowedOrigins.has(parsed.origin)) {
        return null;
      }
      return localPathFromAppUrlPathname(parsed.pathname || '');
    } catch {
      return null;
    }
  };

  async function revealNavigationTarget(url: string): Promise<boolean> {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (!localPath) {
      return false;
    }
    return revealFileInFolder(localPath);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      void revealNavigationTarget(url);
      return { action: 'deny' };
    }
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      event.preventDefault();
      void revealNavigationTarget(url);
      return;
    }
    if (isExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    void (async () => {
      await waitForDevServer(devServerUrl, 40, 500);
      if (!mainWindow || mainWindow.isDestroyed()) return;

      try {
        await mainWindow.loadURL(devServerUrl);
      } catch (error) {
        logError('[App] Failed to load dev server URL:', error);
      }
    })();
    // mainWindow.webContents.openDevTools(); // Commented out - open manually with Cmd+Option+I if needed
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Notify renderer about config status after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const isConfigured = configStore.isConfigured();
    log('[Config] Notifying renderer, isConfigured:', isConfigured);
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: configStore.getAll(),
      },
    });

    // Send current working directory to renderer
    sendToRenderer({
      type: 'workdir.changed',
      payload: { path: currentWorkingDir || '' },
    });

    // Start sandbox bootstrap after window is loaded
    startSandboxBootstrap();
  });
}

/**
 * Initialize fallback working directory.
 */
function initializeDefaultWorkingDir(): string {
  // Create default working directory in user data path (this is the permanent global default)
  const userDataPath = app.getPath('userData');
  const defaultDir = join(userDataPath, 'default_working_dir');

  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
    log('[App] Created default working directory:', defaultDir);
  }

  currentWorkingDir = defaultDir;

  log('[App] Global default working directory:', currentWorkingDir);
  return currentWorkingDir;
}

/**
 * Get current working directory
 */
function getWorkingDir(): string | null {
  return currentWorkingDir;
}

function getWorkspacePathUnsupportedReason(workspacePath?: string): string | null {
  return getUnsupportedWorkspacePathReason({
    platform: process.platform,
    sandboxEnabled: configStore.get('sandboxEnabled') !== false,
    workspacePath,
  });
}

/**
 * Set working directory
 * - If sessionId is provided: update only that session's cwd (for switching directories within a chat)
 * - If no sessionId: update the pending working directory for the next new session
 */
async function setWorkingDir(
  newDir: string,
  sessionId?: string
): Promise<{ success: boolean; path: string; error?: string }> {
  const unsupportedReason = getWorkspacePathUnsupportedReason(newDir);
  if (unsupportedReason) {
    return { success: false, path: newDir, error: unsupportedReason };
  }

  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: 'Directory does not exist' };
  }

  if (sessionId && sessionManager) {
    // Update only this session's cwd - don't change the global default
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    sessionManager.updateSessionCwd(sessionId, newDir);

    // Clear this session's sandbox mapping so next query uses the new directory
    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('./sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  } else {
    currentWorkingDir = newDir;
    remoteManager.setDefaultWorkingDirectory(currentWorkingDir || undefined);
  }

  // Notify renderer of workdir change (for UI display)
  // This updates what the user sees, and will be passed to startSession for new sessions
  sendToRenderer({
    type: 'workdir.changed',
    payload: { path: newDir },
  });

  log(
    '[App] Working directory for UI updated:',
    newDir,
    sessionId ? `(session: ${sessionId})` : '(pending new session)'
  );

  return { success: true, path: newDir };
}

/**
 * Start sandbox bootstrap in the background
 * This pre-initializes WSL/Lima environment at app startup
 */
async function startSandboxBootstrap(): Promise<void> {
  // Skip sandbox bootstrap if disabled - use native mode directly
  const sandboxEnabled = configStore.get('sandboxEnabled');
  if (sandboxEnabled === false) {
    log('[App] Sandbox disabled, skipping bootstrap (using native mode)');
    return;
  }

  const bootstrap = getSandboxBootstrap();

  // Skip if already complete
  if (bootstrap.isComplete()) {
    log('[App] Sandbox bootstrap already complete');
    return;
  }

  // Set up progress callback to notify renderer
  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({
      type: 'sandbox.progress',
      payload: progress,
    });
  });

  // Start bootstrap (non-blocking)
  log('[App] Starting sandbox bootstrap...');
  try {
    const result = await bootstrap.bootstrap();
    log('[App] Sandbox bootstrap complete:', result.mode);
  } catch (error) {
    logError('[App] Sandbox bootstrap error:', error);
  }
}

// 发送事件到渲染进程（含远程会话拦截）
function sendToRenderer(event: ServerEvent) {
  const payload =
    'payload' in event
      ? (event.payload as { sessionId?: string; [key: string]: unknown })
      : undefined;
  const sessionId = payload?.sessionId;

  // 判断是否远程会话
  if (sessionId && remoteManager.isRemoteSession(sessionId)) {
    // 处理远程会话事件

    // 拦截 stream.message，用于回传到远程通道
    if (event.type === 'stream.message') {
      const message = payload.message as {
        role?: string;
        content?: Array<{ type: string; text?: string }>;
      };
      if (message?.role === 'assistant' && message?.content) {
        // 提取助手文本内容
        const textContent = message.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n');

        if (textContent) {
          // 发送到远程通道（带缓冲）
          remoteManager.sendResponseToChannel(sessionId, textContent).catch((err: Error) => {
            logError('[Remote] Failed to send response to channel:', err);
          });
        }
      }
    }

    // 拦截 trace.step 作为工具进度
    if (event.type === 'trace.step') {
      const step = payload.step as {
        type?: string;
        toolName?: string;
        status?: string;
        title?: string;
      };
      if (step?.type === 'tool_call' && step?.toolName) {
        remoteManager
          .sendToolProgress(
            sessionId,
            step.toolName,
            step.status === 'completed'
              ? 'completed'
              : step.status === 'error'
                ? 'error'
                : 'running'
          )
          .catch((err: Error) => {
            logError('[Remote] Failed to send tool progress:', err);
          });
      }
    }

    // trace.update 预留；当前主要用 trace.step

    // 拦截 session.status 用于清理
    if (event.type === 'session.status') {
      const status = payload.status as string;
      if (status === 'idle' || status === 'error') {
        // 会话结束，清空缓冲
        remoteManager.clearSessionBuffer(sessionId).catch((err: Error) => {
          logError('[Remote] Failed to clear session buffer:', err);
        });
      }
    }

    // 拦截 permission.request
    if (event.type === 'permission.request' && payload.toolUseId && payload.toolName) {
      log('[Remote] Intercepting permission for remote session:', sessionId);
      remoteManager
        .handlePermissionRequest(
          sessionId,
          payload.toolUseId as string,
          payload.toolName as string,
          (payload.input as Record<string, unknown> | undefined) ?? {}
        )
        .then((result) => {
          if (result !== null && sessionManager) {
            let permissionResult: 'allow' | 'deny' | 'allow_always';
            if (result.allow) {
              permissionResult = result.remember ? 'allow_always' : 'allow';
            } else {
              permissionResult = 'deny';
            }
            sessionManager.handlePermissionResponse(payload.toolUseId as string, permissionResult);
          }
        })
        .catch((err) => {
          logError('[Remote] Failed to handle permission request:', err);
        });
      return; // 不发送到本地 UI
    }
  }

  // 发送到本地 UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server-event', event);
  }
}

// Initialize app
app
  .whenReady()
  .then(async () => {
    // Smoke test mode: verify the app can start, then exit cleanly
    if (process.argv.includes('--smoke-test')) {
      log('[SmokeTest] App launched successfully in smoke test mode');
      log('[SmokeTest] Platform:', process.platform, 'Arch:', process.arch);
      log('[SmokeTest] Electron:', process.versions.electron, 'Node:', process.versions.node);
      try {
        // Verify critical native modules load
        require('better-sqlite3');
        log('[SmokeTest] better-sqlite3: OK');
      } catch (e) {
        log('[SmokeTest] FAIL: better-sqlite3 failed to load:', e);
        process.exit(1);
      }
      log('[SmokeTest] PASSED');
      process.exit(0);
    }

    // Apply dev logs setting from config
    const enableDevLogs = configStore.get('enableDevLogs');
    setDevLogsEnabled(enableDevLogs);

    // Log environment variables for debugging
    log('=== Open Cowork Starting ===');
    log('Config file:', configStore.getPath());
    log('Is configured:', configStore.isConfigured());
    log('[Runtime] Using pi-coding-agent SDK for all providers');
    log('Developer logs:', enableDevLogs ? 'Enabled' : 'Disabled');
    log('Environment Variables:');
    log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');
    log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(not set)');
    log('  CLAUDE_MODEL:', process.env.CLAUDE_MODEL || '(not set)');
    log('  CLAUDE_CODE_PATH:', process.env.CLAUDE_CODE_PATH || '(not set)');
    log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set');
    log('  OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL || '(not set)');
    log('  OPENAI_MODEL:', process.env.OPENAI_MODEL || '(not set)');
    log('  OPENAI_API_MODE:', process.env.OPENAI_API_MODE || '(default)');
    log('===========================');

    // Initialize default working directory
    initializeDefaultWorkingDir();
    log('Working directory:', currentWorkingDir);
    // 远程会话默认使用全局工作目录
    remoteManager.setDefaultWorkingDirectory(currentWorkingDir || undefined);

    // Initialize database
    const db = initDatabase();

    pluginRuntimeService = new PluginRuntimeService(new PluginCatalogService());

    // Initialize session manager before creating an interactive window.
    // This avoids session.start racing the startup path and hitting a null manager.
    sessionManager = new SessionManager(db, sendToRenderer, pluginRuntimeService);
    skillsManager = new SkillsManager(db, {
      getConfiguredGlobalSkillsPath: () => configStore.get('globalSkillsPath') || '',
      setConfiguredGlobalSkillsPath: (nextPath: string) => {
        configStore.update({ globalSkillsPath: nextPath });
      },
      watchStorage: true,
    });
    skillsManager.onStorageChanged((event) => {
      sendToRenderer({
        type: 'skills.storageChanged',
        payload: event,
      });
    });
    // pi-ai handles model routing natively — no proxy warmup needed

    // macOS: application menu, dock menu, tray icon
    buildMacMenu();
    setupTray();

    // Show window after core managers are ready so first-load actions can be handled.
    createWindow();

    // macOS: dock menu
    if (process.platform === 'darwin') {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: 'New Session',
          click: () => mainWindow?.webContents.send('server-event', { type: 'new-session' }),
        },
        {
          label: 'Settings',
          click: () =>
            mainWindow?.webContents.send('server-event', { type: 'navigate', payload: 'settings' }),
        },
      ]);
      app.dock?.setMenu(dockMenu);
    }

    // macOS: send initial system theme to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on('did-finish-load', () => {
        sendToRenderer({
          type: 'native-theme.changed',
          payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
        });
      });
    }

    // Listen for system theme changes
    nativeTheme.on('updated', () => {
      sendToRenderer({
        type: 'native-theme.changed',
        payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
      });
      if (getSavedThemePreference() === 'system' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
      }
    });

    // Auto-updater: check for updates in production
    if (!isDev) {
      import('electron-updater')
        .then(({ autoUpdater }) => {
          autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
            log('[AutoUpdater] Update check failed:', err);
          });
        })
        .catch((err: unknown) => {
          log('[AutoUpdater] Failed to load electron-updater:', err);
        });
    }

    startNavServer(() => mainWindow);

    const scheduledTaskStore = createScheduledTaskStore(db);
    scheduledTaskManager = new ScheduledTaskManager({
      store: scheduledTaskStore,
      executeTask: async (task) => {
        if (!sessionManager) {
          throw new Error('Session manager not initialized');
        }
        const unsupportedReason = getWorkspacePathUnsupportedReason(task.cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        const fallbackTitle = buildScheduledTaskFallbackTitle(task.prompt);
        const needsRegeneratedTitle = !task.title?.trim() || task.title === fallbackTitle;
        const title = needsRegeneratedTitle
          ? await resolveScheduledTaskTitle(task.prompt, task.cwd, task.title)
          : buildScheduledTaskTitle(task.title);
        if (title !== task.title) {
          scheduledTaskStore.update(task.id, { title });
        }
        const started = await sessionManager.startSession(title, task.prompt, task.cwd);
        // 定时任务创建的新会话需要主动同步到前端会话列表
        sendToRenderer({
          type: 'session.update',
          payload: { sessionId: started.id, updates: started },
        });
        return { sessionId: started.id };
      },
      onTaskError: (taskId, error) => {
        sendToRenderer({
          type: 'scheduled-task.error',
          payload: { taskId, error },
        });
      },
      now: () => Date.now(),
    });
    scheduledTaskManager.start();

    // 初始化远程管理器
    remoteManager.setRendererCallback(sendToRenderer);
    const agentExecutor: AgentExecutor = {
      startSession: async (title, prompt, cwd) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        return sessionManager.startSession(title, prompt, cwd);
      },
      continueSession: async (sessionId, prompt, content, cwd) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        if (cwd) {
          const result = await setWorkingDir(cwd, sessionId);
          if (!result.success) {
            throw new Error(result.error || 'Failed to update working directory');
          }
        }
        await sessionManager.continueSession(sessionId, prompt, content);
      },
      stopSession: async (sessionId) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        await sessionManager.stopSession(sessionId);
      },
      validateWorkingDirectory: async (cwd) => {
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          return unsupportedReason;
        }
        if (!fs.existsSync(cwd)) {
          return 'Directory does not exist';
        }
        return null;
      },
    };
    remoteManager.setAgentExecutor(agentExecutor);

    // 远程控制启用时启动
    if (remoteConfigStore.isEnabled()) {
      remoteManager.start().catch((error) => {
        logError('[App] Failed to start remote control:', error);
      });
    }

    app.on('activate', () => {
      const hasVisibleWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed());
      if (!hasVisibleWindow) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    logError('[App] Startup failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox('Open Cowork 启动失败', `${message}\n\n请查看日志获取更多信息。`);
    app.quit();
  });

// Flag to prevent double cleanup
let isCleaningUp = false;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

/**
 * Cleanup all sandbox resources
 * Called on app quit (both Windows and macOS)
 */
async function cleanupSandboxResources(): Promise<void> {
  if (isCleaningUp) {
    log('[App] Cleanup already in progress, skipping...');
    return;
  }
  isCleaningUp = true;

  stopNavServer();
  skillsManager?.stopStorageMonitoring();
  scheduledTaskManager?.stop();
  tray?.destroy();
  tray = null;

  // 停止远程控制
  try {
    log('[App] Stopping remote control...');
    await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');
    log('[App] Remote control stopped');
  } catch (error) {
    logError('[App] Error stopping remote control:', error);
  }

  // Cleanup all sandbox sessions (sync changes back to host OS first)
  try {
    log('[App] Cleaning up all sandbox sessions...');

    // Cleanup WSL sessions
    await withTimeout(SandboxSync.cleanupAllSessions(), 30000, 'WSL session cleanup');

    // Cleanup Lima sessions
    const { LimaSync } = await import('./sandbox/lima-sync');
    await withTimeout(LimaSync.cleanupAllSessions(), 30000, 'Lima session cleanup');

    log('[App] Sandbox sessions cleanup complete');
  } catch (error) {
    logError('[App] Error cleaning up sandbox sessions:', error);
  }

  // Shutdown sandbox adapter
  try {
    await withTimeout(shutdownSandbox(), 8000, 'Sandbox shutdown');
    log('[App] Sandbox shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down sandbox:', error);
  }

  // Shutdown MCP servers
  try {
    const mcpManager = sessionManager?.getMCPManager();
    if (mcpManager) {
      log('[App] Shutting down MCP servers...');
      await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');
      log('[App] MCP servers shutdown complete');
    }
  } catch (error) {
    logError('[App] Error shutting down MCP servers:', error);
  }

  try {
    closeDatabase();
  } catch (error) {
    logError('[App] Error closing database:', error);
  }

  closeLogFile();

  // pi-ai doesn't need proxy shutdown
}

// Handle app quit - window-all-closed (primary for Windows/Linux)
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin' || process.env.VITE_DEV_SERVER_URL) {
    // On Windows/Linux, closing all windows means quit.
    // On macOS dev mode, also quit — so vite-plugin-electron can restart cleanly
    // without the old process holding the single-instance lock.
    await cleanupSandboxResources();
    app.quit();
  }
  // On macOS production, keep app alive — cleanup happens in before-quit
});

// Handle SIGTERM/SIGINT (e.g. pkill) — route through app.quit() for clean shutdown
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => app.quit());
}

// Handle app quit - before-quit (for macOS Cmd+Q and other quit methods)
app.on('before-quit', async (event) => {
  if (!isCleaningUp) {
    // In dev mode, exit quickly — no need for async sandbox cleanup
    if (process.env.VITE_DEV_SERVER_URL) {
      stopNavServer();
      try {
        closeDatabase();
      } catch {
        /* best-effort */
      }
      closeLogFile();
      tray?.destroy();
      tray = null;
      return;
    }
    // Set the flag immediately before any await to prevent re-entrant cleanup
    isCleaningUp = true;
    event.preventDefault();
    try {
      await cleanupSandboxResources();
    } catch (error) {
      logError('[App] before-quit cleanup failed, forcing quit:', error);
    }
    app.quit();
  }
});

// IPC Handlers
ipcMain.on('client-event', async (_event, data: ClientEvent) => {
  try {
    await handleClientEvent(data);
  } catch (error) {
    logError('Error handling client event:', error);
    sendToRenderer({
      type: 'error',
      payload: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

ipcMain.handle('client-invoke', async (_event, data: ClientEvent) => {
  return handleClientEvent(data);
});

ipcMain.handle('get-version', () => {
  try {
    return app.getVersion();
  } catch (error) {
    logError('[IPC] Error getting version:', error);
    return 'unknown';
  }
});

ipcMain.handle('system.getTheme', () => {
  try {
    return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
  } catch (error) {
    logError('[IPC] Error getting theme:', error);
    return { shouldUseDarkColors: true };
  }
});

ipcMain.handle('shell.openExternal', async (_event, url: string) => {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      logWarn('[shell.openExternal] Blocked URL with disallowed protocol:', parsed.protocol);
      return false;
    }
  } catch {
    logWarn('[shell.openExternal] Blocked invalid URL:', url);
    return false;
  }

  return shell.openExternal(url);
});

async function openLocalPath(targetPath: string): Promise<boolean> {
  if (!targetPath) {
    return false;
  }

  const trimInput = targetPath.trim();
  if (!trimInput) {
    return false;
  }

  let normalizedPath = decodePathSafely(trimInput);
  if (normalizedPath.startsWith('file://')) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      logWarn('[shell.openPath] could not parse file URL:', normalizedPath);
      return false;
    }
    normalizedPath = localPath;
  }

  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    logWarn('[shell.openPath] blocked non-absolute path:', targetPath);
    return false;
  }

  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }

  if (!fs.existsSync(normalizedPath)) {
    logWarn('[shell.openPath] path does not exist:', normalizedPath);
    return false;
  }

  const openResult = await shell.openPath(normalizedPath);
  if (openResult) {
    logWarn('[shell.openPath] openPath returned warning:', openResult);
    return false;
  }
  return true;
}

ipcMain.handle('shell.openPath', async (_event, targetPath: string) => {
  try {
    return await openLocalPath(targetPath);
  } catch (error) {
    logError('[shell.openPath] failed:', error);
    return false;
  }
});

async function revealFileInFolder(filePath: string, cwd?: string): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  const trimInput = filePath.trim();
  if (!trimInput) {
    return false;
  }

  let normalizedPath = decodePathSafely(trimInput);

  if (normalizedPath.startsWith('file://')) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      logWarn('[shell.showItemInFolder] could not parse file URL:', normalizedPath);
      return false;
    }
    normalizedPath = localPath;
  }

  const baseDir = cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath('home');
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    normalizedPath = resolve(baseDir, normalizedPath);
  }

  if (
    normalizedPath.startsWith('/workspace/') ||
    /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
  ) {
    const relativePart = normalizedPath.startsWith('/workspace/')
      ? normalizedPath.slice('/workspace/'.length)
      : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
    normalizedPath = resolve(baseDir, relativePart);
  }

  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }
  log('[shell.showItemInFolder] request:', { filePath, cwd, resolved: normalizedPath });

  const findFileByName = (fileName: string, roots: string[]): string | null => {
    if (!fileName) {
      return null;
    }

    const visited = new Set<string>();
    const queue = roots
      .map((root) => resolve(root))
      .filter((root) => !!root && fs.existsSync(root) && fs.statSync(root).isDirectory());

    let scannedDirs = 0;
    const MAX_DIRS = 2000;

    while (queue.length > 0 && scannedDirs < MAX_DIRS) {
      const dir = queue.shift()!;
      if (visited.has(dir)) {
        continue;
      }
      visited.add(dir);
      scannedDirs += 1;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
          return fullPath;
        }
        if (entry.isDirectory()) {
          queue.push(fullPath);
        }
      }
    }

    return null;
  };

  try {
    if (fs.existsSync(normalizedPath)) {
      const stat = fs.statSync(normalizedPath);
      if (stat.isDirectory()) {
        const openDirResult = await shell.openPath(normalizedPath);
        if (openDirResult) {
          logWarn('[shell.showItemInFolder] openPath returned warning:', openDirResult);
        }
      } else {
        if (process.platform === 'darwin') {
          try {
            execFileSync('open', ['-R', normalizedPath]);
          } catch (error) {
            logWarn(
              '[shell.showItemInFolder] open -R failed, fallback to shell.showItemInFolder:',
              error
            );
            shell.showItemInFolder(normalizedPath);
          }
        } else {
          shell.showItemInFolder(normalizedPath);
        }
      }
      return true;
    }

    const fileName = basename(normalizedPath);
    const defaultWorkingDir = getWorkingDir() || '';
    const discoveredPath = findFileByName(fileName, [
      cwd || '',
      defaultWorkingDir,
      join(app.getPath('userData'), 'default_working_dir'),
    ]);

    if (discoveredPath) {
      logWarn('[shell.showItemInFolder] resolved path not found, discovered by filename:', {
        requested: normalizedPath,
        discoveredPath,
      });
      if (process.platform === 'darwin') {
        try {
          execFileSync('open', ['-R', discoveredPath]);
        } catch (error) {
          logWarn(
            '[shell.showItemInFolder] open -R discovered file failed, fallback to shell.showItemInFolder:',
            error
          );
          shell.showItemInFolder(discoveredPath);
        }
      } else {
        shell.showItemInFolder(discoveredPath);
      }
      return true;
    }

    const parentDir = dirname(normalizedPath);
    if (parentDir && fs.existsSync(parentDir)) {
      logWarn('[shell.showItemInFolder] file not found, opening parent directory:', parentDir);
      const openParentResult = await shell.openPath(parentDir);
      if (openParentResult) {
        logWarn('[shell.showItemInFolder] openPath parent returned warning:', openParentResult);
      }
      return true;
    }

    logWarn('[shell.showItemInFolder] path and parent directory do not exist:', normalizedPath);
    return false;
  } catch (error) {
    logError('[shell.showItemInFolder] failed:', error);
    return false;
  }
}

ipcMain.handle('shell.showItemInFolder', async (_event, filePath: string, cwd?: string) => {
  return revealFileInFolder(filePath, cwd);
});

ipcMain.handle(
  'artifacts.listRecentFiles',
  async (_event, cwd: string, sinceMs: number, limit: number = 50) => {
    if (!cwd || !isAbsolute(cwd)) {
      return [];
    }
    return listRecentWorkspaceFiles(cwd, sinceMs, limit);
  }
);

ipcMain.handle('dialog.selectFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files',
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

registerConfigHandlers({
  getSessionManager: () => sessionManager,
  sendToRenderer,
});
registerMcpHandlers({ getSessionManager: () => sessionManager });
registerSkillsHandlers({
  getSkillsManager: () => skillsManager,
  getPluginRuntimeService: () => pluginRuntimeService,
  getSessionManager: () => sessionManager,
  sendToRenderer,
});

// Window control IPC handlers
ipcMain.on('window.minimize', () => {
  try {
    mainWindow?.minimize();
  } catch (error) {
    logError('[Window] Error minimizing:', error);
  }
});

ipcMain.on('window.maximize', () => {
  try {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  } catch (error) {
    logError('[Window] Error maximizing:', error);
  }
});

ipcMain.on('window.close', () => {
  try {
    mainWindow?.close();
  } catch (error) {
    logError('[Window] Error closing:', error);
  }
});

registerSandboxHandlers({ sendToRenderer });
registerLogHandlers({
  getMainWindow: () => mainWindow,
  getCurrentWorkingDir: () => currentWorkingDir,
  sanitizeDiagnosticBaseUrl,
  getSessionManager: () => sessionManager,
});
registerRemoteHandlers();
registerScheduleHandlers({
  getScheduledTaskManager: () => scheduledTaskManager,
  getWorkspacePathUnsupportedReason,
  resolveScheduledTaskTitle,
});
async function handleClientEvent(event: ClientEvent): Promise<unknown> {
  // Check if configured before starting sessions
  if (event.type === 'session.start' && !configStore.hasUsableCredentialsForActiveSet()) {
    sendToRenderer({
      type: 'error',
      payload: {
        message: '当前方案未配置可用凭证，请先在 API 设置中完成配置',
        code: 'CONFIG_REQUIRED_ACTIVE_SET',
        action: 'open_api_settings',
      },
    });
    return null;
  }

  if (eventRequiresSessionManager(event) && !sessionManager) {
    throw new Error('Session manager not initialized');
  }
  // After the guard above, sessionManager is guaranteed non-null for session.* events.
  // Use a local alias to satisfy TypeScript's control-flow narrowing.
  const sm = sessionManager!;

  switch (event.type) {
    case 'session.start':
      if (getWorkspacePathUnsupportedReason(event.payload.cwd)) {
        sendToRenderer({
          type: 'error',
          payload: {
            message: getWorkspacePathUnsupportedReason(event.payload.cwd)!,
          },
        });
        return null;
      }
      return sm.startSession(
        event.payload.title,
        event.payload.prompt,
        event.payload.cwd,
        event.payload.allowedTools,
        event.payload.content,
        event.payload.contextConfig
      );

    case 'session.continue':
      return sm.continueSession(
        event.payload.sessionId,
        event.payload.prompt,
        event.payload.content,
        event.payload.contextConfig
      );

    case 'session.compact':
      return sm.compactSession(event.payload.sessionId);

    case 'session.stop':
      return sm.stopSession(event.payload.sessionId);

    case 'session.delete':
      return sm.deleteSession(event.payload.sessionId);

    case 'session.batchDelete':
      return sm.batchDeleteSessions(event.payload.sessionIds);

    case 'session.list': {
      const sessions = sm.listSessions();
      sendToRenderer({ type: 'session.list', payload: { sessions } });
      return sessions;
    }

    case 'session.getMessages':
      return sm.getMessagesPage(
        event.payload.sessionId,
        event.payload.limit,
        event.payload.beforeTimestamp
      );

    case 'session.getTraceSteps':
      return sm.getTraceSteps(event.payload.sessionId);

    case 'permission.response':
      return sm.handlePermissionResponse(event.payload.toolUseId, event.payload.result);

    case 'sudo.password.response':
      return sm.handleSudoPasswordResponse(event.payload.toolUseId, event.payload.password);

    case 'folder.select': {
      const folderResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
      });
      if (!folderResult.canceled && folderResult.filePaths.length > 0) {
        sendToRenderer({
          type: 'folder.selected',
          payload: { path: folderResult.filePaths[0] },
        });
        return folderResult.filePaths[0];
      }
      return null;
    }

    case 'workdir.get':
      return getWorkingDir();

    case 'workdir.set':
      return setWorkingDir(event.payload.path, event.payload.sessionId);

    case 'workdir.select': {
      const dialogDefaultPath =
        event.payload.currentPath && isAbsolute(event.payload.currentPath)
          ? event.payload.currentPath
          : currentWorkingDir || undefined;
      const workdirResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select Working Directory',
        defaultPath: dialogDefaultPath,
      });
      if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
        const selectedPath = workdirResult.filePaths[0];
        return setWorkingDir(selectedPath, event.payload.sessionId);
      }
      return { success: false, path: '', error: 'User cancelled' };
    }

    case 'settings.update':
      {
        const configUpdates: Partial<AppConfig> = {};
        if (
          event.payload.theme === 'dark' ||
          event.payload.theme === 'light' ||
          event.payload.theme === 'system'
        ) {
          const nextTheme = event.payload.theme as AppTheme;
          configUpdates.theme = nextTheme;
          applyNativeThemePreference(nextTheme);
          if (mainWindow && !mainWindow.isDestroyed()) {
            const effectiveTheme = resolveEffectiveTheme(nextTheme);
            mainWindow.setBackgroundColor(effectiveTheme === 'dark' ? DARK_BG : LIGHT_BG);
          }
        }
        if (
          event.payload.memoryStrategy === 'auto' ||
          event.payload.memoryStrategy === 'manual' ||
          event.payload.memoryStrategy === 'rolling'
        ) {
          configUpdates.memoryStrategy = event.payload.memoryStrategy;
        }
        if (
          typeof event.payload.maxContextTokens === 'number' &&
          Number.isFinite(event.payload.maxContextTokens)
        ) {
          configUpdates.maxContextTokens = Math.max(
            8192,
            Math.floor(event.payload.maxContextTokens)
          );
        }
        if (Object.keys(configUpdates).length > 0) {
          configStore.update(configUpdates);
        }
        if (Object.keys(configUpdates).length > 0 || event.payload.theme !== undefined) {
          sendToRenderer({
            type: 'config.status',
            payload: {
              isConfigured: configStore.isConfigured(),
              config: configStore.getAll(),
            },
          });
        }
      }
      return null;

    default:
      logWarn('Unknown event type:', event);
      return null;
  }
}
