import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsPanelContent = readFileSync(settingsPanelPath, 'utf8');

describe('SettingsPanel schedule tab entry', () => {
  it('renders schedule tab id', () => {
    expect(settingsPanelContent).toContain("id: 'schedule' as TabId");
  });

  it('uses schedule i18n keys', () => {
    expect(settingsPanelContent).toContain("t('settings.schedule'");
    expect(settingsPanelContent).toContain("t('settings.scheduleDesc'");
  });

  it('handles null nextRunAt explicitly', () => {
    expect(settingsPanelContent).toContain("task.nextRunAt === null ? '无' : formatTime(task.nextRunAt)");
  });

  it('avoids resetting schedule time when editing without changing runAt', () => {
    expect(settingsPanelContent).toContain('shouldResetScheduleTime');
    expect(settingsPanelContent).toContain('runAt !== originalRunAtInput');
  });

  it('polls schedule list in background', () => {
    expect(settingsPanelContent).toContain("void loadTasks({ silent: true })");
  });

  it('validates future run time and suggests runNow for immediate execution', () => {
    expect(settingsPanelContent).toContain('执行时间必须晚于当前时间；如需立刻执行请使用“立即执行”');
  });

  it('shows model-generated title hints and only regenerates on prompt change', () => {
    expect(settingsPanelContent).toContain('自动标题（用于会话区分）');
    expect(settingsPanelContent).toContain('保存后将自动生成：[定时任务] + 模型摘要');
    expect(settingsPanelContent).toContain('shouldRegenerateTitle');
    expect(settingsPanelContent).toContain('检测到 Prompt 已修改，保存后会重新生成标题。');
    expect(settingsPanelContent).toContain('未修改 Prompt 时将保留现有标题。');
  });

  it('renders schedule rule and last-run details for better task readability', () => {
    expect(settingsPanelContent).toContain('执行策略：{formatScheduleRule(task)}');
    expect(settingsPanelContent).toContain('上次执行：{task.lastRunAt === null ? \'尚未执行\' : formatTime(task.lastRunAt)}');
    expect(settingsPanelContent).toContain('{task.title}');
    expect(settingsPanelContent).toContain('最近会话：{task.lastRunSessionId}');
  });

  it('shows clear stop semantics hint', () => {
    expect(settingsPanelContent).toContain('停用仅阻止后续自动触发，已开始执行的会话需在会话列表中手动停止');
  });

  it('provides stop-run control for running scheduled sessions', () => {
    expect(settingsPanelContent).toContain('停止执行');
    expect(settingsPanelContent).toContain("type: 'session.stop'");
    expect(settingsPanelContent).toContain('该任务当前没有正在执行的会话');
  });
});
