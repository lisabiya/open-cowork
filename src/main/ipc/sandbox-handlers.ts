import { ipcMain } from 'electron';
import type { ServerEvent } from '../../renderer/types';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { getSandboxBootstrap } from '../sandbox/sandbox-bootstrap';
import { LimaBridge } from '../sandbox/lima-bridge';
import { WSLBridge } from '../sandbox/wsl-bridge';
import { logError } from '../utils/logger';

export interface RegisterSandboxHandlersDeps {
  sendToRenderer: (event: ServerEvent) => void;
}

export function registerSandboxHandlers({ sendToRenderer }: RegisterSandboxHandlersDeps): void {
  ipcMain.handle('sandbox.getStatus', async () => {
    try {
      const adapter = getSandboxAdapter();
      const platform = process.platform;

      if (platform === 'win32') {
        const wslStatus = await WSLBridge.checkWSLStatus();
        return {
          platform: 'win32',
          mode: adapter.initialized ? adapter.mode : 'none',
          initialized: adapter.initialized,
          wsl: wslStatus,
          lima: null,
        };
      } else if (platform === 'darwin') {
        const limaStatus = await LimaBridge.checkLimaStatus();
        return {
          platform: 'darwin',
          mode: adapter.initialized ? adapter.mode : 'native',
          initialized: adapter.initialized,
          wsl: null,
          lima: limaStatus,
        };
      } else {
        return {
          platform,
          mode: adapter.initialized ? adapter.mode : 'native',
          initialized: adapter.initialized,
          wsl: null,
          lima: null,
        };
      }
    } catch (error) {
      logError('[Sandbox] Error getting status:', error);
      return {
        platform: process.platform,
        mode: 'none',
        initialized: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('sandbox.checkWSL', async () => {
    try {
      return await WSLBridge.checkWSLStatus();
    } catch (error) {
      logError('[Sandbox] Error checking WSL:', error);
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.installNodeInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installNodeInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing Node.js:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installPythonInWSL', async (_event, distro: string) => {
    try {
      return await WSLBridge.installPythonInWSL(distro);
    } catch (error) {
      logError('[Sandbox] Error installing Python:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.checkLima', async () => {
    try {
      return await LimaBridge.checkLimaStatus();
    } catch (error) {
      logError('[Sandbox] Error checking Lima:', error);
      return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.createLimaInstance', async () => {
    try {
      return await LimaBridge.createLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error creating Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.startLimaInstance', async () => {
    try {
      return await LimaBridge.startLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error starting Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.stopLimaInstance', async () => {
    try {
      return await LimaBridge.stopLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error stopping Lima instance:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installNodeInLima', async () => {
    try {
      return await LimaBridge.installNodeInLima();
    } catch (error) {
      logError('[Sandbox] Error installing Node.js in Lima:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.installPythonInLima', async () => {
    try {
      return await LimaBridge.installPythonInLima();
    } catch (error) {
      logError('[Sandbox] Error installing Python in Lima:', error);
      return false;
    }
  });

  ipcMain.handle('sandbox.retryLimaSetup', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Lima is only available on macOS' };
    }

    try {
      const bootstrap = getSandboxBootstrap();
      bootstrap.setProgressCallback((progress) => {
        sendToRenderer({
          type: 'sandbox.progress',
          payload: progress,
        });
      });

      try {
        await LimaBridge.stopLimaInstance();
      } catch (error) {
        logError('[Sandbox] Error stopping Lima before retry:', error);
      }

      bootstrap.reset();
      const result = await bootstrap.bootstrap();
      const success = !result.error;
      return { success, result, error: result.error };
    } catch (error) {
      logError('[Sandbox] Error retrying Lima setup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('sandbox.retrySetup', async () => {
    try {
      const bootstrap = getSandboxBootstrap();
      bootstrap.setProgressCallback((progress) => {
        sendToRenderer({
          type: 'sandbox.progress',
          payload: progress,
        });
      });

      bootstrap.reset();
      const result = await bootstrap.bootstrap();
      const success = !result.error;
      return { success, result, error: result.error };
    } catch (error) {
      logError('[Sandbox] Error retrying setup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
