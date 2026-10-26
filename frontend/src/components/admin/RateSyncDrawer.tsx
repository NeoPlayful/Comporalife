import type { RateProviderStatus, RateSyncFrequency, RateSyncSettings } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { CheckCircle2, Info, RefreshCw, TriangleAlert, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const FREQUENCY_ORDER: RateSyncFrequency[] = ['hourly', 'daily', 'weekly'];

/**
 * 汇率自动同步设置（右侧抽屉）。
 *
 * 这里只放「可在线调整、且不含密钥」的两项：启用开关与同步频率。
 * 数据源地址与密钥来自部署环境，页面既看不到也不允许修改——一旦允许写库，
 * 就等于把密钥交给了拥有数据库读权限的人。
 *
 * 两个值都是草稿态，点保存才一起提交；开关单独即时提交会让「改完频率再关掉」
 * 这种操作变成两次不可预期的写入。
 */
export default function RateSyncDrawer({
  open,
  settings,
  provider,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: RateSyncSettings | null;
  provider: RateProviderStatus | null;
  saving: boolean;
  onClose: () => void;
  onSave: (next: { enabled: boolean; frequency: RateSyncFrequency }) => void;
}) {
  const { t } = useTranslation('admin');

  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<RateSyncFrequency>('daily');

  // 每次打开都以服务端当前值为准，避免上次未保存的草稿残留
  useEffect(() => {
    if (!open || !settings) return;
    setEnabled(settings.enabled);
    setFrequency(settings.frequency);
  }, [open, settings]);

  // Esc 关闭：抽屉盖住整页，键盘用户不该只能去点遮罩
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const configured = provider?.configured ?? false;
  const lastRun = provider?.lastRun;
  const autoDisabled = provider?.disabledReason === 'consecutive_failures' && !settings?.enabled;
  const dirty =
    settings !== null && (settings.enabled !== enabled || settings.frequency !== frequency);

  const frequencyLabel = (value: RateSyncFrequency) =>
    t(`exchangeRates.sync.frequency.${value}`);

  const frequencyHint = (value: RateSyncFrequency) =>
    t(`exchangeRates.syncDrawer.frequency_hint.${value}`);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t('exchangeRates.syncDrawer.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      {/* 右侧滑入面板：头部固定、中部滚动、底部操作区固定 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('exchangeRates.syncDrawer.title')}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t('exchangeRates.syncDrawer.title')}</h2>
            <p className="mt-1 text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.syncDrawer.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('exchangeRates.syncDrawer.close')}
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 说明条：先说清自动同步的边界，避免管理员以为它会覆盖自己刚补录的值 */}
          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-2.5">
            <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
            <p className="text-xs text-[var(--color-content)]">
              {t('exchangeRates.syncDrawer.scope_hint')}
            </p>
          </div>

          {!configured && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('exchangeRates.syncDrawer.not_configured')}
              </p>
            </div>
          )}

          {/* 启用开关 */}
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] px-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('exchangeRates.syncDrawer.enable')}</p>
              <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
                {t('exchangeRates.syncDrawer.enable_hint')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={t('exchangeRates.syncDrawer.enable')}
              // 未配置汇率源时开启等于承诺一件做不到的事
              disabled={!configured}
              onClick={() => setEnabled((prev) => !prev)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                enabled ? 'bg-emerald-600' : 'bg-[var(--color-border-subtle)]'
              }`}
            >
              <span
                className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
                  enabled ? 'left-[1.375rem]' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {/* 频率三选一 */}
          <div>
            <p className="text-sm font-medium">{t('exchangeRates.syncDrawer.frequency')}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {FREQUENCY_ORDER.map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setFrequency(value)}
                  aria-pressed={frequency === value}
                  className={`rounded-lg border px-2 py-2 text-xs transition-colors disabled:opacity-40 ${
                    frequency === value
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 font-medium text-[var(--color-accent)]'
                      : 'border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  {frequencyLabel(value)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[var(--color-content-muted)]">
              {frequencyHint(frequency)}
            </p>
          </div>

          {/* 上次与下次同步 */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5">
              <p className="text-xs text-[var(--color-content-muted)]">
                {t('exchangeRates.syncDrawer.last_sync')}
              </p>
              <p className="mt-1 text-xs font-medium">
                {lastRun?.finishedAt
                  ? formatDateTime(lastRun.finishedAt)
                  : t('exchangeRates.syncDrawer.never')}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5">
              <p className="text-xs text-[var(--color-content-muted)]">
                {t('exchangeRates.syncDrawer.next_sync')}
              </p>
              <p className="mt-1 text-xs font-medium">
                {enabled && provider?.nextRunAt
                  ? formatDateTime(provider.nextRunAt)
                  : t('exchangeRates.syncDrawer.not_scheduled')}
              </p>
            </div>
          </div>

          {/* 运行结果三态：成功 / 失败 / 停用原因 */}
          {autoDisabled && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('exchangeRates.syncDrawer.auto_disabled')}
              </p>
            </div>
          )}

          {lastRun?.errorMessage && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--color-negative)]/40 bg-[var(--color-negative)]/10 px-3 py-2.5">
              <XCircle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" aria-hidden />
              <p className="text-xs text-[var(--color-negative)]">{lastRun.errorMessage}</p>
            </div>
          )}

          {lastRun && !lastRun.errorMessage && lastRun.status !== 'running' && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t('exchangeRates.syncDrawer.last_result', {
                  written: lastRun.writtenRows,
                  skipped: lastRun.skippedManual,
                })}
              </p>
            </div>
          )}

          {lastRun?.status === 'running' && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-accent)]">
              <RefreshCw className="size-3.5 animate-spin" aria-hidden />
              {t('exchangeRates.syncDrawer.running')}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('exchangeRates.syncDrawer.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => onSave({ enabled, frequency })}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t('exchangeRates.syncDrawer.saving') : t('exchangeRates.syncDrawer.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
