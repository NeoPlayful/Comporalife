import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LoadingState from '@/components/ui/LoadingState';
import { dataQualityApi } from '@/lib/data-management';
import { formatDate, formatNumber } from '@/lib/format';
import { Link } from 'react-router-dom';

function money(amount: string, currency: string): string {
  return `${formatNumber(amount, { maximumFractionDigits: 2 })} ${currency}`;
}

interface Props {
  metricKey: string;
}

export default function QualityDetailTable({ metricKey }: Props) {
  const { t } = useTranslation('data');
  const [limit, setLimit] = useState(50);

  const uncategorized = useQuery({
    queryKey: ['quality', 'uncategorized', limit],
    queryFn: () => dataQualityApi.uncategorized({ limit }),
    enabled: metricKey === 'uncategorized',
  });

  const duplicates = useQuery({
    queryKey: ['quality', 'duplicates'],
    queryFn: () => dataQualityApi.duplicates(100),
    enabled: metricKey === 'duplicates',
  });

  const missing = useQuery({
    queryKey: ['quality', 'missing-months'],
    queryFn: () => dataQualityApi.missingMonths(12),
    enabled: metricKey === 'missing_months',
  });

  const stale = useQuery({
    queryKey: ['quality', 'stale-valuations'],
    queryFn: () => dataQualityApi.staleValuations(),
    enabled: metricKey === 'stale_valuations',
  });

  const rateLag = useQuery({
    queryKey: ['quality', 'rate-lag'],
    queryFn: () => dataQualityApi.rateLag(),
    enabled: metricKey === 'rate_lag',
  });

  const loading =
    uncategorized.isLoading || duplicates.isLoading || missing.isLoading || stale.isLoading || rateLag.isLoading;

  if (loading) return <LoadingState />;

  const empty = <p className="text-sm text-[var(--color-content-muted)]">{t('quality.no_issues')}</p>;

  if (metricKey === 'uncategorized') {
    const data = uncategorized.data;
    if (!data || data.items.length === 0) return empty;

    return (
      <div className="space-y-3">
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
          {data.items.map((item) => (
            <li key={item.transactionId} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">{item.description}</p>
                <p className="text-xs text-[var(--color-content-muted)]">
                  {formatDate(item.occurredAt)} · {item.accountName ?? '—'} ·{' '}
                  {t('quality.items', { count: item.daysOld })}
                </p>
              </div>
              <span className="shrink-0 tabular-nums">
                {money(item.amount, item.currency)}
              </span>
            </li>
          ))}
        </ul>

        {data.items.length < data.total && (
          <button
            type="button"
            onClick={() => setLimit((value) => value + 50)}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('quality.load_more')}
          </button>
        )}
      </div>
    );
  }

  if (metricKey === 'duplicates') {
    const data = duplicates.data;
    if (!data || data.items.length === 0) return empty;

    return (
      <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
        {data.items.map((item) => (
          <li key={`${item.transactionId}-${item.conflictingTransactionId}`} className="space-y-1 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate">{item.description}</p>
              <span className="shrink-0 tabular-nums">{money(item.amount, item.currency)}</span>
            </div>
            <p className="text-xs text-[var(--color-content-muted)]">
              {item.accountName} · {formatDate(item.occurredAt)} ·{' '}
              {t('quality.day_gap', { days: item.dayGap })}
            </p>
          </li>
        ))}
      </ul>
    );
  }

  if (metricKey === 'missing_months') {
    const data = missing.data;
    if (!data || data.accounts.length === 0) return empty;

    return (
      <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
        {data.accounts.map((item) => (
          <li key={item.accountId} className="p-3 text-sm">
            <p>{t('quality.missing_months_by_account', { name: item.name, months: item.missing.join('、') })}</p>
          </li>
        ))}
      </ul>
    );
  }

  if (metricKey === 'stale_valuations') {
    const data = stale.data;
    if (!data || data.items.length === 0) return empty;

    return (
      <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
        {data.items.map((item) => (
          <li key={`${item.targetType}:${item.targetId}`} className="space-y-1.5 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span>
                {item.priceDate
                  ? t(item.targetType === 'asset' ? 'quality.stale_asset' : 'quality.stale_portfolio', {
                      name: item.name,
                      date: formatDate(item.priceDate),
                      days: item.daysStale ?? 0,
                    })
                  : `${item.name} · ${t('quality.never_valued')}`}
              </span>
              {item.targetType === 'portfolio' && (
                <Link
                  to={`/portfolios/${item.targetId}`}
                  className="shrink-0 text-xs text-[var(--color-accent)]"
                >
                  {t('quality.go_record_price')}
                </Link>
              )}
            </div>
            {/* 组合级只知道「整体过期」，具体哪个标的没更新才是用户要处理的 */}
            {item.instruments.length > 0 && (
              <ul className="space-y-0.5 border-l-2 border-[var(--color-border-subtle)] pl-2 text-xs">
                {item.instruments.map((holding) => (
                  <li key={holding.instrumentId} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {holding.symbol}
                      {holding.name ? ` · ${holding.name}` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--color-content-muted)]">
                      {holding.priceDate
                        ? `${formatDate(holding.priceDate)} · ${t('quality.stale_days', {
                            days: holding.daysStale ?? 0,
                          })}`
                        : t('quality.no_price_yet')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {item.missingSymbols.length > 0 && (
              <p className="text-xs text-[var(--color-content-muted)]">
                {item.missingSymbols.join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (metricKey === 'rate_lag') {
    const data = rateLag.data;
    if (!data || data.items.length === 0) return empty;

    return (
      <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
        {data.items.map((item) => (
          <li key={`${item.from}-${item.to}`} className="p-3 text-sm">
            {t('quality.rate_pair', {
              from: item.from,
              to: item.to,
              status: item.latestDate
                ? t('quality.rate_days', { days: item.daysLag ?? 0 })
                : t('quality.rate_missing'),
            })}
          </li>
        ))}
      </ul>
    );
  }

  return empty;
}
