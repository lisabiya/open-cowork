import { ipcMain, shell } from 'electron';
import { configStore } from '../config/config-store';
import type { PluginComponentKind, ServerEvent } from '../../renderer/types';
import type { PluginRuntimeService } from '../skills/plugin-runtime-service';
import type { SkillsManager } from '../skills/skills-manager';
import type { SessionManager } from '../session/session-manager';
import { logError } from '../utils/logger';

export interface RegisterSkillsHandlersDeps {
  getSkillsManager: () => SkillsManager | null;
  getPluginRuntimeService: () => PluginRuntimeService | null;
  getSessionManager: () => SessionManager | null;
  sendToRenderer: (event: ServerEvent) => void;
}

export function registerSkillsHandlers({
  getSkillsManager,
  getPluginRuntimeService,
  getSessionManager,
  sendToRenderer,
}: RegisterSkillsHandlersDeps): void {
  ipcMain.handle('skills.getAll', async () => {
    try {
      const skillsManager = getSkillsManager();
      if (!skillsManager) {
        throw new Error('Skills manager is still starting');
      }
      return await skillsManager.listSkills();
    } catch (error) {
      logError('[Skills] Error getting skills:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.install', async (_event, skillPath: string) => {
    try {
      const skillsManager = getSkillsManager();
      if (!skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      const skill = await skillsManager.installSkill(skillPath);
      getSessionManager()?.invalidateSkillsSetup();
      return { success: true, skill };
    } catch (error) {
      logError('[Skills] Error installing skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.delete', async (_event, skillId: string) => {
    try {
      const skillsManager = getSkillsManager();
      if (!skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      await skillsManager.uninstallSkill(skillId);
      getSessionManager()?.invalidateSkillsSetup();
      return { success: true };
    } catch (error) {
      logError('[Skills] Error deleting skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.setEnabled', async (_event, skillId: string, enabled: boolean) => {
    try {
      const skillsManager = getSkillsManager();
      if (!skillsManager) {
        throw new Error('SkillsManager not initialized');
      }
      skillsManager.setSkillEnabled(skillId, enabled);
      getSessionManager()?.invalidateSkillsSetup();
      return { success: true };
    } catch (error) {
      logError('[Skills] Error toggling skill:', error);
      throw error;
    }
  });

  ipcMain.handle('skills.validate', async (_event, skillPath: string) => {
    try {
      const skillsManager = getSkillsManager();
      if (!skillsManager) {
        return { valid: false, errors: ['SkillsManager not initialized'] };
      }
      return await skillsManager.validateSkillFolder(skillPath);
    } catch (error) {
      logError('[Skills] Error validating skill:', error);
      return { valid: false, errors: ['Validation failed'] };
    }
  });

  ipcMain.handle('skills.getStoragePath', async () => {
    try {
      const skillsManager = getSkillsManager();
      if (!skillsManager) {
        return null;
      }
      return skillsManager.getGlobalSkillsPath();
    } catch (error) {
      logError('[Skills] Error getting storage path:', error);
      return null;
    }
  });

  ipcMain.handle('skills.setStoragePath', async (_event, targetPath: string, migrate = true) => {
    const skillsManager = getSkillsManager();
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const result = await skillsManager.setGlobalSkillsPath(targetPath, migrate !== false);
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured: configStore.isConfigured(),
        config: configStore.getAll(),
      },
    });
    return { success: true, ...result };
  });

  ipcMain.handle('skills.openStoragePath', async () => {
    const skillsManager = getSkillsManager();
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const storagePath = skillsManager.getGlobalSkillsPath();
    const openResult = await shell.openPath(storagePath);
    if (openResult) {
      return { success: false, path: storagePath, error: openResult };
    }
    return { success: true, path: storagePath };
  });

  ipcMain.handle('plugins.listCatalog', async (_event, options?: { installableOnly?: boolean }) => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      return await pluginRuntimeService.listCatalog(options);
    } catch (error) {
      logError('[Plugins] Error listing catalog:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.listInstalled', async () => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      return pluginRuntimeService.listInstalled();
    } catch (error) {
      logError('[Plugins] Error listing installed plugins:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.install', async (_event, pluginName: string) => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await pluginRuntimeService.install(pluginName);
      getSessionManager()?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error installing plugin:', error);
      throw error;
    }
  });

  ipcMain.handle('plugins.setEnabled', async (_event, pluginId: string, enabled: boolean) => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await pluginRuntimeService.setEnabled(pluginId, enabled);
      getSessionManager()?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error toggling plugin:', error);
      throw error;
    }
  });

  ipcMain.handle(
    'plugins.setComponentEnabled',
    async (_event, pluginId: string, component: PluginComponentKind, enabled: boolean) => {
      try {
        const pluginRuntimeService = getPluginRuntimeService();
        if (!pluginRuntimeService) {
          throw new Error('PluginRuntimeService not initialized');
        }
        const result = await pluginRuntimeService.setComponentEnabled(pluginId, component, enabled);
        if (component === 'skills') {
          getSessionManager()?.invalidateSkillsSetup();
        }
        return result;
      } catch (error) {
        logError('[Plugins] Error toggling plugin component:', error);
        throw error;
      }
    }
  );

  ipcMain.handle('plugins.uninstall', async (_event, pluginId: string) => {
    try {
      const pluginRuntimeService = getPluginRuntimeService();
      if (!pluginRuntimeService) {
        throw new Error('PluginRuntimeService not initialized');
      }
      const result = await pluginRuntimeService.uninstall(pluginId);
      getSessionManager()?.invalidateSkillsSetup();
      return result;
    } catch (error) {
      logError('[Plugins] Error uninstalling plugin:', error);
      throw error;
    }
  });
}
