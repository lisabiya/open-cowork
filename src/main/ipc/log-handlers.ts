import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import { configStore } from '../config/config-store';
import type { SessionManager } from '../session/session-manager';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import {
  closeLogFile,
  getAllLogFiles,
  getLogFilePath,
  getLogsDirectory,
  isDevLogsEnabled,
  log,
  logError,
  logWarn,
  setDevLogsEnabled,
} from '../utils/logger';
import { buildDiagnosticsSummary } from '../utils/diagnostics-summary';
import { collectEnvironmentDoctorReport } from '../runtime/environment-doctor';

export interface RegisterLogHandlersDeps {
  getMainWindow: () => BrowserWindow | null;
  getCurrentWorkingDir: () => string | null;
  sanitizeDiagnosticBaseUrl: (value: string | undefined) => string | null;
  getSessionManager: () => SessionManager | null;
}

export function registerLogHandlers({
  getMainWindow,
  getCurrentWorkingDir,
  sanitizeDiagnosticBaseUrl,
  getSessionManager,
}: RegisterLogHandlersDeps): void {
  ipcMain.handle('logs.getPath', () => {
    try {
      return getLogFilePath();
    } catch (error) {
      logError('[Logs] Error getting log path:', error);
      return null;
    }
  });

  ipcMain.handle('logs.getDirectory', () => {
    try {
      return getLogsDirectory();
    } catch (error) {
      logError('[Logs] Error getting logs directory:', error);
      return null;
    }
  });

  ipcMain.handle('logs.getAll', () => {
    try {
      return getAllLogFiles();
    } catch (error) {
      logError('[Logs] Error getting all log files:', error);
      return [];
    }
  });

  ipcMain.handle('diagnostics.environmentDoctor', () => {
    try {
      return { success: true, report: collectEnvironmentDoctorReport() };
    } catch (error) {
      logError('[Diagnostics] Error collecting environment doctor report:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.export', async () => {
    try {
      const logFiles = getAllLogFiles();
      const sessionManager = getSessionManager();
      const diagnosticsSummary = buildDiagnosticsSummary({
        app: {
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          chromeVersion: process.versions.chrome,
        },
        runtime: {
          currentWorkingDir: getCurrentWorkingDir(),
          logsDirectory: getLogsDirectory(),
          logFileCount: logFiles.length,
          totalLogSizeBytes: logFiles.reduce((total, file) => total + file.size, 0),
          devLogsEnabled: isDevLogsEnabled(),
        },
        config: {
          provider: configStore.get('provider'),
          model: configStore.get('model'),
          baseUrl: sanitizeDiagnosticBaseUrl(configStore.get('baseUrl') || undefined),
          customProtocol: configStore.get('customProtocol') || null,
          sandboxEnabled: !!configStore.get('sandboxEnabled'),
          thinkingEnabled: !!configStore.get('enableThinking'),
          apiKeyConfigured: !!configStore.get('apiKey'),
          claudeCodePathConfigured: !!configStore.get('claudeCodePath'),
          defaultWorkdir: configStore.get('defaultWorkdir') || null,
          globalSkillsPathConfigured: !!configStore.get('globalSkillsPath'),
        },
        sandbox: {
          mode: getSandboxAdapter().mode,
          initialized: getSandboxAdapter().initialized,
        },
        environmentDoctor: collectEnvironmentDoctorReport(),
        sessions: sessionManager ? sessionManager.listSessions() : [],
        logFiles,
        deps: {
          getMessages: (sessionId: string) =>
            sessionManager ? sessionManager.getMessages(sessionId) : [],
          getTraceSteps: (sessionId: string) =>
            sessionManager ? sessionManager.getTraceSteps(sessionId) : [],
        },
      });

      const result = await dialog.showSaveDialog(getMainWindow()!, {
        title: 'Export Logs',
        defaultPath: `opencowork-logs-${new Date().toISOString().split('T')[0]}.zip`,
        filters: [
          { name: 'ZIP Archive', extensions: ['zip'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'User cancelled' };
      }

      const archiver = await import('archiver');
      const output = fs.createWriteStream(result.filePath);
      const archive = archiver.default('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        let settled = false;
        const settle = (value: {
          success: boolean;
          path?: string;
          size?: number;
          error?: string;
        }) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(value);
        };

        output.on('close', () => {
          log('[Logs] Exported logs to:', result.filePath);
          settle({
            success: true,
            path: result.filePath,
            size: archive.pointer(),
          });
        });

        output.on('error', (err: Error) => {
          logError('[Logs] Error writing exported archive:', err);
          settle({ success: false, error: err.message });
        });

        archive.on('error', (err: Error) => {
          logError('[Logs] Error creating archive:', err);
          settle({ success: false, error: err.message });
        });

        archive.pipe(output);

        for (const logFile of logFiles) {
          archive.file(logFile.path, { name: logFile.name });
        }

        const systemInfo = {
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          appVersion: app.getVersion(),
          exportDate: new Date().toISOString(),
          logFiles: logFiles.map((f) => ({
            name: f.name,
            size: f.size,
            modified: f.mtime,
          })),
        };
        archive.append(JSON.stringify(systemInfo, null, 2), { name: 'system-info.json' });
        archive.append(JSON.stringify(diagnosticsSummary, null, 2), {
          name: 'diagnostics-summary.json',
        });
        archive.append(
          [
            'Open Cowork diagnostic bundle',
            `Exported at: ${diagnosticsSummary.exportedAt}`,
            '',
            'Included files:',
            '- Application log files (*.log)',
            '- system-info.json',
            '- diagnostics-summary.json',
            '',
            'diagnostics-summary.json contains a redacted runtime/config snapshot,',
            'plus metadata-only session summaries and recent error traces to speed up debugging.',
          ].join('\n'),
          { name: 'README.txt' }
        );

        archive.finalize();
      });
    } catch (error) {
      logError('[Logs] Error exporting logs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.open', async () => {
    try {
      const logsDir = getLogsDirectory();
      await shell.openPath(logsDir);
      return { success: true };
    } catch (error) {
      logError('[Logs] Error opening logs directory:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.clear', async () => {
    try {
      const logFiles = getAllLogFiles();
      closeLogFile();

      for (const logFile of logFiles) {
        try {
          fs.unlinkSync(logFile.path);
          log('[Logs] Deleted log file:', logFile.name);
        } catch (err) {
          logError('[Logs] Failed to delete log file:', logFile.name, err);
        }
      }

      log('[Logs] Log files cleared and reinitialized');
      return { success: true, deletedCount: logFiles.length };
    } catch (error) {
      logError('[Logs] Error clearing logs:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.setEnabled', async (_event, enabled: boolean) => {
    try {
      setDevLogsEnabled(enabled);
      configStore.set('enableDevLogs', enabled);
      log('[Logs] Developer logs', enabled ? 'enabled' : 'disabled');
      return { success: true, enabled };
    } catch (error) {
      logError('[Logs] Error setting dev logs enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.isEnabled', () => {
    try {
      return { success: true, enabled: isDevLogsEnabled() };
    } catch (error) {
      logError('[Logs] Error getting dev logs enabled:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('logs.write', (_event, level: 'info' | 'warn' | 'error', args: unknown[]) => {
    try {
      if (level === 'warn') {
        logWarn(...args);
      } else if (level === 'error') {
        logError(...args);
      } else {
        log(...args);
      }
      return { success: true };
    } catch (error) {
      console.error('[Logs] Error writing log:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
