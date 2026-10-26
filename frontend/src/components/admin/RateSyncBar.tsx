import type { RateProviderStatus, RateSyncSettings } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { RefreshCw, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * 同步区的单行摘要。
 *
 * 只保留「现在是什么状态」和两个动作入口：详细配置与运行结果都在右侧抽屉里，
 * 页面上铺开会让一次性的运维配置长期占据主体内容的注意力。
 */
export default function RateSyncBar({
  settings,
  provider,
  syncing,
  onOpenSettings,
  onSync,
}: {
  settings: RateSyncSettings | null;
  provider: RateProviderStatus | null;
  syncing: boolean;
  onOpenSettings: () => void;
  onSync: () => void;
}) {
  const { t } = useTranslation('admin');

  const enabled = settings?.enabled ?? false;
  const configured = provider?.configured ?? false;
  const lastRun = provider?.lastRun;

  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-[var(--color-content-muted)]'}`}
          />
          <span className="text-sm font-medium">
            {enabled
              ? t('exchangeRates.sync.enabled_summary', {
                  frequency: t(`exchangeRates.sync.frequency.${settings?.frequency ?? 'daily'}`),
                })
              : t('exchangeRates.sync.disabled_summary')}
          </span>
        </span>

        <span className="text-[var(--color-content-muted)]">
          {lastRun?.finishedAt
            ? t('exchangeRates.sync.last_sync_at', { time: formatDateTime(lastRun.finishedAt) })
            : t('exchangeRates.sync.never_synced')}
        </span>

        {provider?.nextRunAt && enabled && (
          <span className="text-[var(--color-content-muted)]">
            {t('exchangeRates.sync.next_sync_at', { time: formatDateTime(provider.nextRunAt) })}
          </span>
        )}

        {!configured && (
          <span className="text-amber-600 dark:text-amber-400">
            {t('exchangeRates.sync.not_configured_short')}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5"
        >
          <Settings2 className="size-3.5" aria-hidden />
          {t('exchangeRates.sync.open_settings')}
        </button>
        <button
          type="button"
          onClick={onSync}
          disabled={!configured || syncing}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />
          {syncing ? t('exchangeRates.sync.syncing') : t('exchangeRates.sync.sync_now')}
        </button>
      </div>
    </section>
  );
}
