import { ipcMain } from 'electron';
import {
  configStore,
  getPiAiModelPresets,
  type AppConfig,
  type CreateConfigSetPayload,
} from '../config/config-store';
import { runConfigApiTest } from '../config/config-test-routing';
import { listOllamaModels } from '../config/ollama-api';
import type { SessionManager } from '../session/session-manager';
import { log, logError } from '../utils/logger';
import type {
  ApiTestInput,
  ApiTestResult,
  DiagnosticInput,
  ProviderModelInfo,
  ServerEvent,
} from '../../renderer/types';

export interface RegisterConfigHandlersDeps {
  getSessionManager: () => SessionManager | null;
  sendToRenderer: (event: ServerEvent) => void;
}

const buildAgentRuntimeSignature = (config: AppConfig): string =>
  JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    enableThinking: config.enableThinking,
  });

export function registerConfigHandlers({
  getSessionManager,
  sendToRenderer,
}: RegisterConfigHandlersDeps): void {
  const syncConfigAfterMutation = async (previousConfig: AppConfig) => {
    configStore.set('isConfigured', configStore.hasAnyUsableCredentials());
    configStore.applyToEnv();

    const updatedConfig = configStore.getAll();
    const shouldReloadRunner =
      buildAgentRuntimeSignature(previousConfig) !== buildAgentRuntimeSignature(updatedConfig);
    const shouldReloadSandbox = previousConfig.sandboxEnabled !== updatedConfig.sandboxEnabled;
    const sessionManager = getSessionManager();

    if (sessionManager) {
      if (shouldReloadRunner) {
        sessionManager.reloadConfig();
      }
      if (shouldReloadSandbox) {
        await sessionManager
          .reloadSandbox()
          .catch((err) => logError('[Config] Sandbox reload failed:', err));
      }
      if (shouldReloadRunner || shouldReloadSandbox) {
        log(
          '[Config] Session manager config synced:',
          JSON.stringify({
            runnerReloaded: shouldReloadRunner,
            sandboxReloaded: shouldReloadSandbox,
          })
        );
      }
    }

    const isConfigured = configStore.isConfigured();
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: updatedConfig,
      },
    });
    log('[Config] Notified renderer of config update, isConfigured:', isConfigured);
    return updatedConfig;
  };

  ipcMain.handle('config.get', () => {
    try {
      return configStore.getAll();
    } catch (error) {
      logError('[Config] Error getting config:', error);
      return {};
    }
  });

  ipcMain.handle('config.getPresets', () => {
    try {
      return getPiAiModelPresets();
    } catch (error) {
      logError('[Config] Error getting presets:', error);
      return [];
    }
  });

  ipcMain.handle('config.save', async (_event, newConfig: Partial<AppConfig>) => {
    log('[Config] Saving config:', { ...newConfig, apiKey: newConfig.apiKey ? '***' : '' });
    const previousConfig = configStore.getAll();
    configStore.update(newConfig);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.createSet', async (_event, payload: CreateConfigSetPayload) => {
    log('[Config] Creating config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.createSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.renameSet', async (_event, payload: { id: string; name: string }) => {
    log('[Config] Renaming config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.renameSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.deleteSet', async (_event, payload: { id: string }) => {
    log('[Config] Deleting config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.deleteSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.switchSet', async (_event, payload: { id: string }) => {
    log('[Config] Switching config set:', payload);
    const previousConfig = configStore.getAll();
    configStore.switchSet(payload);
    const updatedConfig = await syncConfigAfterMutation(previousConfig);
    return { success: true, config: updatedConfig };
  });

  ipcMain.handle('config.isConfigured', () => {
    try {
      return configStore.isConfigured();
    } catch (error) {
      logError('[Config] Error checking configured status:', error);
      return false;
    }
  });

  ipcMain.handle('config.test', async (_event, payload: ApiTestInput): Promise<ApiTestResult> => {
    try {
      return await runConfigApiTest(payload, configStore.getAll());
    } catch (error) {
      logError('[Config] API test failed:', error);
      return {
        ok: false,
        errorType: 'unknown',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    'config.listModels',
    async (
      _event,
      payload: { provider: AppConfig['provider']; apiKey: string; baseUrl?: string }
    ): Promise<ProviderModelInfo[]> => {
      if (payload.provider !== 'ollama') {
        return [];
      }
      return listOllamaModels(payload);
    }
  );

  ipcMain.handle('config.diagnose', async (_event, payload: DiagnosticInput) => {
    try {
      const { runDiagnostics } = await import('../config/api-diagnostics');
      return await runDiagnostics(payload);
    } catch (error) {
      logError('[Config] Error running diagnostics:', error);
      throw error;
    }
  });

  ipcMain.handle('config.discover-local', async (_event, payload?: { baseUrl?: string }) => {
    try {
      const { discoverLocalOllama } = await import('../config/api-diagnostics');
      return await discoverLocalOllama(payload);
    } catch (error) {
      logError('[Config] Error discovering local services:', error);
      return [];
    }
  });
}
