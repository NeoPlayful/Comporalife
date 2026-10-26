import Modal from '@/components/ui/Modal';
import SwitchRow from '@/components/ui/SwitchRow';
import type { RateProviderStatus, RateSyncFrequency, RateSyncSettings } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { CheckCircle2, Info, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
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
    <Modal
      open={open}
      variant="drawer"
      size="md"
      title={t('exchangeRates.syncDrawer.title')}
      description={t('exchangeRates.syncDrawer.subtitle')}
      dirty={dirty}
      busy={saving}
      onClose={onClose}
      footer={
        <>
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
        </>
      }
    >
        <div className="space-y-5">
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

          {/* 启用开关：草稿态，改动随底部保存一起提交 */}
          <SwitchRow
            title={t('exchangeRates.syncDrawer.enable')}
            hint={t('exchangeRates.syncDrawer.enable_hint')}
            checked={enabled}
            // 未配置汇率源时开启等于承诺一件做不到的事
            disabled={!configured}
            onCheckedChange={setEnabled}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-3"
          />

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
    </Modal>
  );
}
