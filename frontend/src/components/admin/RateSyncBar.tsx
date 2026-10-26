import type { RateProviderStatus, RateSyncSettings } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from 'react-i18next';

/**
 * 同步状态单行摘要。
 *
 * 只回答「自动同步现在是什么状态」：开关、频率、上次与下次运行。动作入口
 * 与详细配置都在头部按钮和右侧抽屉里，这里不再重复摆按钮。
 */
export default function RateSyncBar({
  settings,
  provider,
}: {
  settings: RateSyncSettings | null;
  provider: RateProviderStatus | null;
}) {
  const { t } = useTranslation('admin');

  const enabled = settings?.enabled ?? false;
  const configured = provider?.configured ?? false;
  const lastRun = provider?.lastRun;

  return (
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

      {configured && (
        <span className="text-[var(--color-content-muted)]">
          {t('exchangeRates.sync.provider_summary', {
            provider: t(`exchangeRates.syncDrawer.providers.${provider?.provider ?? 'exchangerate-api'}`),
            anchor: provider?.anchorCurrency ?? '—',
          })}
        </span>
      )}

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
  );
}
