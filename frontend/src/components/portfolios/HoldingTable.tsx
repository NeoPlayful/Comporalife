import { formatDate, formatNumber } from '@/lib/format';
import type { Holding } from '@/lib/portfolios';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import EmptyState from '../ui/EmptyState';

function pct(value: string | null): string {
  if (value === null) return '—';
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export default function HoldingTable({
  holdings,
  currency,
}: {
  holdings: Holding[];
  currency: string;
}) {
  const { t } = useTranslation('portfolios');

  if (holdings.length === 0) {
    return <EmptyState title={t('holdings.empty')} description={t('holdings.empty_hint')} />;
  }

  const hasMissing = holdings.some((holding) => holding.price === null);

  return (
    <div className="space-y-3">
      {hasMissing && (
        <p className="rounded-lg bg-[var(--color-warning,#d3a35a)]/10 px-3 py-2 text-sm">
          {t('holdings.no_price_hint')}
        </p>
      )}

      {/* 窄屏用卡片，宽屏用表格，避免横向滚动 */}
      <div className="space-y-2 sm:hidden">
        {holdings.map((holding) => (
          <div
            key={holding.instrumentId}
            className="rounded-lg border border-[var(--color-border-subtle)] p-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-medium">{holding.symbol}</p>
              <p className="tabular-nums">{formatNumber(holding.marketValue)} {currency}</p>
            </div>
            <p className="text-xs text-[var(--color-content-muted)]">{holding.name}</p>
            <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
              <dt className="text-[var(--color-content-muted)]">{t('holdings.quantity')}</dt>
              <dd className="text-right tabular-nums">{Number(holding.quantity)}</dd>
              <dt className="text-[var(--color-content-muted)]">{t('holdings.average_cost')}</dt>
              <dd className="text-right tabular-nums">
                {holding.averageCost === null ? '—' : formatNumber(holding.averageCost)}
              </dd>
              <dt className="text-[var(--color-content-muted)]">{t('holdings.unrealized')}</dt>
              <dd className="text-right tabular-nums">
                {holding.unrealizedPnl === null ? '—' : formatNumber(holding.unrealizedPnl)}
              </dd>
            </dl>
            {holding.price === null ? (
              <p className="mt-2 text-xs text-[var(--color-warning,#d3a35a)]">
                {t('holdings.missing_price')}
              </p>
            ) : (
              <p className="mt-2 text-xs text-[var(--color-content-muted)]">
                {formatNumber(holding.price)} · {formatDate(holding.priceDate)}
                {holding.stale && ` · ${t('holdings.stale')}`}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
              <th className="pb-2 font-normal">{t('holdings.instrument')}</th>
              <th className="pb-2 text-right font-normal">{t('holdings.quantity')}</th>
              <th className="pb-2 text-right font-normal">{t('holdings.average_cost')}</th>
              <th className="pb-2 text-right font-normal">{t('holdings.price')}</th>
              <th className="pb-2 text-right font-normal">{t('holdings.market_value')}</th>
              <th className="pb-2 text-right font-normal">{t('holdings.unrealized')}</th>
              <th className="pb-2 text-right font-normal">{t('holdings.weight')}</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => (
              <tr key={holding.instrumentId} className="border-b border-[var(--color-border-subtle)]/50">
                <td className="py-2">
                  <p className="font-medium">{holding.symbol}</p>
                  <p className="text-xs text-[var(--color-content-muted)]">{holding.name}</p>
                </td>
                <td className="py-2 text-right tabular-nums">{Number(holding.quantity)}</td>
                <td className="py-2 text-right tabular-nums">
                  {holding.averageCost === null ? '—' : formatNumber(holding.averageCost)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {holding.price === null ? (
                    <span className="text-[var(--color-warning,#d3a35a)]">
                      {t('holdings.missing_price')}
                    </span>
                  ) : (
                    <>
                      <p>{formatNumber(holding.price)}</p>
                      <p className="text-xs text-[var(--color-content-muted)]">
                        {formatDate(holding.priceDate)}
                        {holding.stale && ` · ${t('holdings.stale')}`}
                      </p>
                    </>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{formatNumber(holding.marketValue)}</td>
                <td className="py-2 text-right tabular-nums">
                  {holding.unrealizedPnl === null ? (
                    '—'
                  ) : (
                    <>
                      <p>{formatNumber(holding.unrealizedPnl)}</p>
                      <p className="text-xs text-[var(--color-content-muted)]">
                        {pct(holding.unrealizedRatio)}
                      </p>
                    </>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">{pct(holding.weight)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-[var(--color-content-muted)]">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('basis.note')}
      </p>
    </div>
  );
}
