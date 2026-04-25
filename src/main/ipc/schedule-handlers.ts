import { ipcMain } from 'electron';
import type {
  ScheduledTaskCreateInput,
  ScheduledTaskManager,
  ScheduledTaskUpdateInput,
} from '../schedule/scheduled-task-manager';
import { buildScheduledTaskTitle } from '../../shared/schedule/task-title';
import { logError } from '../utils/logger';

export interface RegisterScheduleHandlersDeps {
  getScheduledTaskManager: () => ScheduledTaskManager | null;
  getWorkspacePathUnsupportedReason: (workspacePath?: string) => string | null;
  resolveScheduledTaskTitle: (
    prompt: string,
    cwd?: string,
    fallbackTitle?: string
  ) => Promise<string>;
}

export function registerScheduleHandlers({
  getScheduledTaskManager,
  getWorkspacePathUnsupportedReason,
  resolveScheduledTaskTitle,
}: RegisterScheduleHandlersDeps): void {
  ipcMain.handle('schedule.list', () => {
    try {
      const scheduledTaskManager = getScheduledTaskManager();
      if (!scheduledTaskManager) return [];
      return scheduledTaskManager.list();
    } catch (error) {
      logError('[Schedule] Error listing tasks:', error);
      return [];
    }
  });

  ipcMain.handle('schedule.create', async (_event, payload: ScheduledTaskCreateInput) => {
    const scheduledTaskManager = getScheduledTaskManager();
    if (!scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    const unsupportedReason = getWorkspacePathUnsupportedReason(payload.cwd);
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    const normalizedPrompt = payload.prompt.trim();
    const title = await resolveScheduledTaskTitle(normalizedPrompt, payload.cwd, payload.title);
    return scheduledTaskManager.create({
      ...payload,
      prompt: normalizedPrompt,
      title,
    });
  });

  ipcMain.handle('schedule.update', async (_event, id: string, updates: ScheduledTaskUpdateInput) => {
    const scheduledTaskManager = getScheduledTaskManager();
    if (!scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    const existing = scheduledTaskManager.get(id);
    if (!existing) return null;
    const nextCwd = updates.cwd ?? existing.cwd;
    const unsupportedReason = getWorkspacePathUnsupportedReason(nextCwd);
    if (unsupportedReason) {
      throw new Error(unsupportedReason);
    }
    const normalizedPrompt = updates.prompt === undefined ? existing.prompt : updates.prompt.trim();
    const normalizedUpdates: ScheduledTaskUpdateInput = {
      ...updates,
      prompt: normalizedPrompt,
    };

    if (updates.prompt !== undefined) {
      normalizedUpdates.title = await resolveScheduledTaskTitle(
        normalizedPrompt,
        updates.cwd ?? existing.cwd,
        updates.title ?? existing.title
      );
    } else if (updates.title !== undefined) {
      normalizedUpdates.title = buildScheduledTaskTitle(updates.title);
    }

    return scheduledTaskManager.update(id, normalizedUpdates);
  });

  ipcMain.handle('schedule.delete', (_event, id: string) => {
    const scheduledTaskManager = getScheduledTaskManager();
    if (!scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    return { success: scheduledTaskManager.delete(id) };
  });

  ipcMain.handle('schedule.toggle', (_event, id: string, enabled: boolean) => {
    const scheduledTaskManager = getScheduledTaskManager();
    if (!scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    return scheduledTaskManager.toggle(id, enabled);
  });

  ipcMain.handle('schedule.runNow', async (_event, id: string) => {
    const scheduledTaskManager = getScheduledTaskManager();
    if (!scheduledTaskManager) {
      throw new Error('Scheduled task manager not initialized');
    }
    return scheduledTaskManager.runNow(id);
  });
}
