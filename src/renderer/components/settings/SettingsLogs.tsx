import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Save,
  Globe,
  Trash2,
  Copy,
  Stethoscope,
} from 'lucide-react';
import { formatAppDateTime } from '../../utils/i18n-format';
import { SettingsContentSection } from './shared';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

type EnvironmentDoctorReport = Awaited<
  ReturnType<typeof window.electronAPI.diagnostics.getEnvironmentDoctor>
> extends { report?: infer R }
  ? R
  : never;

export function SettingsLogs({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [logFiles, setLogFiles] = useState<
    Array<{ name: string; path: string; size: number; mtime: Date }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [logsDirectory, setLogsDirectory] = useState('');
  const [devLogsEnabled, setDevLogsEnabled] = useState(true);
  const [environmentDoctor, setEnvironmentDoctor] = useState<EnvironmentDoctorReport | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      const [files, dir] = await Promise.all([
        window.electronAPI.logs.getAll(),
        window.electronAPI.logs.getDirectory(),
      ]);
      setLogFiles(files || []);
      setLogsDirectory(dir || '');
      setError('');
    } catch (err) {
      console.error('Failed to load logs:', err);
      setError(t('logs.exportFailed'));
    }
  }, [t]);

  const loadDevLogsStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.logs.isEnabled();
      if (result.success && typeof result.enabled === 'boolean') {
        setDevLogsEnabled(result.enabled);
      }
    } catch (err) {
      console.error('Failed to load dev logs status:', err);
    }
  }, []);

  const loadEnvironmentDoctor = useCallback(async () => {
    try {
      const result = await window.electronAPI.diagnostics.getEnvironmentDoctor();
      if (result.success && result.report) {
        setEnvironmentDoctor(result.report);
      }
    } catch (err) {
      console.error('Failed to load environment doctor:', err);
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) {
      return;
    }
    void loadLogs();
    void loadDevLogsStatus();
    void loadEnvironmentDoctor();
    const interval = setInterval(() => {
      void loadLogs();
    }, 3000);
    return () => clearInterval(interval);
  }, [isActive, loadDevLogsStatus, loadEnvironmentDoctor, loadLogs]);

  async function handleToggleDevLogs() {
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const newEnabled = !devLogsEnabled;
      const result = await window.electronAPI.logs.setEnabled(newEnabled);
      if (result.success) {
        setDevLogsEnabled(newEnabled);
        setSuccess(newEnabled ? t('logs.devLogsEnabled') : t('logs.devLogsDisabled'));
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(result.error || t('logs.toggleFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.toggleFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleExport() {
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await window.electronAPI.logs.export();
      if (result.success) {
        setSuccess(t('logs.exportSuccess', { path: result.path }));
        setTimeout(() => setSuccess(''), 5000);
      } else {
        setError(result.error || t('logs.exportFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.exportFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpen() {
    setIsLoading(true);
    try {
      await window.electronAPI.logs.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.exportFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleClear() {
    if (!confirm(t('logs.clearConfirm'))) {
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const result = await window.electronAPI.logs.clear();
      if (result.success) {
        setSuccess(t('logs.clearSuccess', { count: result.deletedCount }));
        await loadLogs();
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(result.error || t('logs.clearFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logs.clearFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(date: Date): string {
    return formatAppDateTime(date);
  }

  const totalSize = logFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-4">
      {/* Error/Success Messages */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Developer Logs Toggle */}
      <section className="rounded-lg border border-border-subtle bg-background px-4 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-text-primary">{t('logs.enableDevLogs')}</h4>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t('logs.enableDevLogsDesc')}</p>
          </div>
          <button
            onClick={handleToggleDevLogs}
            disabled={isLoading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:opacity-50 flex-shrink-0 ${
              devLogsEnabled ? 'bg-accent' : 'bg-surface-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-text-primary transition-transform ${
                devLogsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Stats */}
      <SettingsContentSection
        title={t('logs.logFiles')}
        description={t('logs.inventoryDescription')}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-lg bg-background border border-border-subtle">
            <div className="text-2xl font-bold text-text-primary">{logFiles.length}</div>
            <div className="text-sm text-text-muted">{t('logs.logFiles')}</div>
          </div>
          <div className="p-4 rounded-lg bg-background border border-border-subtle">
            <div className="text-2xl font-bold text-text-primary">{formatFileSize(totalSize)}</div>
            <div className="text-sm text-text-muted">{t('logs.totalSize')}</div>
          </div>
        </div>
      </SettingsContentSection>

      {/* Log Files List */}
      <SettingsContentSection title={t('logs.logFiles')} description={t('logs.recentDescription')}>
        {logFiles.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p>{t('logs.noLogFiles')}</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {logFiles.map((file) => (
              <div
                key={file.path}
                className="p-3 rounded-lg bg-background border border-border-subtle"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-text-primary truncate">{file.name}</div>
                    <div className="text-xs text-text-muted mt-1">
                      {formatFileSize(file.size)} • {formatDate(file.mtime)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsContentSection>

      {/* Directory Path */}
      {logsDirectory && (
        <SettingsContentSection
          title={t('logs.logsDirectory')}
          description={t('logs.directoryDescription')}
        >
          <div className="p-3 rounded-lg bg-background border border-border-subtle">
            <div className="text-xs text-text-muted mb-1">{t('logs.logsDirectory')}</div>
            <div className="flex items-start gap-2">
              <button
                className="font-mono text-xs text-text-secondary break-all text-left hover:text-accent hover:underline cursor-pointer bg-transparent border-none p-0"
                onClick={() => window.electronAPI.logs.open()}
                title={t('logs.openFolder')}
              >
                {logsDirectory}
              </button>
              <button
                className="shrink-0 p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
                onClick={() => navigator.clipboard.writeText(logsDirectory)}
                title={t('common.copy')}
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
        </SettingsContentSection>
      )}

      {environmentDoctor && (
        <SettingsContentSection
          title={t('logs.environmentDoctorTitle')}
          description={t('logs.environmentDoctorDescription')}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {environmentDoctor.capabilities.map((capability) => (
                <div
                  key={capability.key}
                  className="p-3 rounded-lg bg-background border border-border-subtle"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary flex items-center gap-2">
                        <Stethoscope className="w-4 h-4 text-text-muted" />
                        <span>{capability.label}</span>
                      </div>
                      <div className="mt-1 text-xs text-text-muted break-all">{capability.detail}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
                        capability.status === 'available'
                          ? 'bg-success/10 text-success'
                          : capability.status === 'warning'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-error/10 text-error'
                      }`}
                    >
                      {t(`logs.status.${capability.status}`)}
                    </span>
                  </div>
                  {(capability.source || capability.actionHint || capability.fixCommand) && (
                    <div className="mt-2 space-y-1 text-xs text-text-muted">
                      {capability.source && (
                        <div>{t('logs.capabilitySource', { source: capability.source })}</div>
                      )}
                      {capability.actionHint && <div>{capability.actionHint}</div>}
                      {capability.fixCommand && (
                        <div className="mt-2 rounded border border-border-subtle bg-surface-subtle p-2">
                          <div className="font-mono break-all text-text-secondary">
                            {capability.fixCommand}
                          </div>
                          <div className="mt-2 flex justify-end">
                            <button
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
                              onClick={() => {
                                navigator.clipboard.writeText(capability.fixCommand!);
                                setSuccess(t('logs.fixCommandCopied'));
                                setTimeout(() => setSuccess(''), 2500);
                              }}
                            >
                              <Copy className="w-3 h-3" />
                              <span>{t('logs.copyFixCommand')}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {environmentDoctor.preflightIssues.length > 0 && (
              <div className="rounded-lg border border-border-subtle bg-background p-3">
                <div className="text-sm font-medium text-text-primary mb-2">
                  {t('logs.preflightIssuesTitle')}
                </div>
                <div className="space-y-2">
                  {environmentDoctor.preflightIssues.map((issue, index) => (
                    <div key={`${issue.resource}-${index}`} className="text-xs text-text-muted">
                      <span className="font-medium text-text-primary">{issue.resource}</span>
                      {' · '}
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SettingsContentSection>
      )}

      {/* Action Buttons */}
      <SettingsContentSection
        title={t('logs.actionsTitle')}
        description={t('logs.actionsDescription')}
      >
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={handleExport}
            disabled={isLoading}
            className="py-3 px-4 rounded-lg bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span className="text-sm">{t('logs.exportZip')}</span>
          </button>
          <button
            onClick={handleOpen}
            disabled={isLoading}
            className="py-3 px-4 rounded-lg bg-background border border-border-subtle text-text-primary font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Globe className="w-4 h-4" />
            <span className="text-sm">{t('logs.openFolder')}</span>
          </button>
          <button
            onClick={handleClear}
            disabled={isLoading || logFiles.length === 0}
            className="py-3 px-4 rounded-lg bg-error/10 text-error font-medium hover:bg-error/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-sm">{t('logs.clearAll')}</span>
          </button>
        </div>
      </SettingsContentSection>

      {/* Help Text */}
      <div className="text-xs text-text-muted text-center space-y-1">
        <p>{t('logs.helpText1')}</p>
        <p>{t('logs.helpText2')}</p>
      </div>
    </div>
  );
}
