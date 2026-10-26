import type { AdminExchangeRateStats, RateProviderStatus } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { ArrowLeftRight, Clock, Database, Tag } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 汇率概览卡片。
 *
 * 前三张来自「当前汇率」接口的统计字段（筛选前计算，反映全局覆盖），
 * 最后一张来自供应商状态接口，因此不额外增加请求。
 *
 * 「滞后」单独占一张：只报覆盖数看不出好坏，管理员真正要判断的是
 * 「这些覆盖率里面有多少已经过期」。
 */
export default function RateStats({
  stats,
  provider,
}: {
  stats: AdminExchangeRateStats | null;
  provider: RateProviderStatus | null;
}) {
  const { t } = useTranslation('admin');

  const lastRun = provider?.lastRun;
  const lastSyncValue = lastRun?.finishedAt
    ? formatDateTime(lastRun.finishedAt)
    : t('exchangeRates.stats.last_sync_never');

  const sourceValue = stats
    ? t('exchangeRates.stats.source_value', {
        provider: stats.provider,
        manual: stats.manual,
      })
    : '—';

  const stale = stats?.stale ?? 0;

  const cards: {
    label: string;
    desc: string;
    value: ReactNode;
    icon: ReactNode;
    iconClass: string;
    alert?: boolean;
  }[] = [
    {
      label: t('exchangeRates.stats.pairs'),
      desc: t('exchangeRates.stats.pairs_desc'),
      value: stats ? String(stats.pairs) : '—',
      icon: <ArrowLeftRight className="size-4" aria-hidden />,
      iconClass: 'bg-indigo-500/10 text-indigo-500',
    },
    {
      label: t('exchangeRates.stats.stale'),
      desc: stats
        ? t('exchangeRates.stats.stale_desc', { days: stats.staleDays })
        : t('exchangeRates.stats.stale_desc_unknown'),
      value: stats ? String(stale) : '—',
      icon: <Clock className="size-4" aria-hidden />,
      iconClass: 'bg-violet-500/10 text-violet-500',
      alert: stale > 0,
    },
    {
      label: t('exchangeRates.stats.source'),
      desc: t('exchangeRates.stats.source_desc'),
      value: sourceValue,
      icon: <Tag className="size-4" aria-hidden />,
      iconClass: 'bg-amber-500/10 text-amber-600',
    },
    {
      label: t('exchangeRates.stats.last_sync'),
      desc: lastRun
        ? t('exchangeRates.stats.last_sync_desc', { count: lastRun.writtenRows })
        : t('exchangeRates.stats.last_sync_never'),
      value: lastSyncValue,
      icon: <Database className="size-4" aria-hidden />,
      iconClass: 'bg-emerald-500/10 text-emerald-600',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="card flex items-start gap-3 p-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${card.iconClass}`}
          >
            {card.icon}
          </span>
          <div className="min-w-0">
            <p className="text-xs text-[var(--color-content-muted)]">{card.label}</p>
            <p
              className={`truncate text-base font-semibold tabular-nums ${
                card.alert ? 'text-amber-600 dark:text-amber-400' : ''
              }`}
            >
              {card.value}
            </p>
            <p className="truncate text-xs text-[var(--color-content-muted)]">{card.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
