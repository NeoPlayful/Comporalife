import { formatNumber } from '@/lib/format';
import type { PortfolioDetail, ReturnsResponse } from '@/lib/portfolios';
import { useTranslation } from 'react-i18next';

function pct(value: string | null): string {
  if (value === null) return '—';
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export default function PortfolioSummaryCards({
  detail,
  returns,
}: {
  detail: PortfolioDetail;
  returns?: ReturnsResponse;
}) {
  const { t } = useTranslation('portfolios');
  const currency = detail.portfolio.currency;

  const cards = [
    {
      label: t('summary.portfolio_value'),
      value: `${formatNumber(detail.portfolioValue)} ${currency}`,
      sub: `${t('summary.market_value')} ${formatNumber(detail.marketValue)} · ${t('summary.cash')} ${formatNumber(detail.cash)}`,
    },
    {
      label: t('summary.total_pnl'),
      value: `${formatNumber(detail.totalPnl)} ${currency}`,
      sub: `${t('summary.unrealized')} ${detail.unrealizedPnl === null ? '—' : formatNumber(detail.unrealizedPnl)} · ${t('summary.realized')} ${formatNumber(detail.realizedPnl)}`,
      emphasis: Number(detail.totalPnl),
    },
    {
      label: t('summary.twr'),
      value: returns ? pct(returns.twr.value) : '—',
      sub: returns?.twr.reason
        ? t('performance.reason', { reason: t(`../enums:performance_reason.${returns.twr.reason}`) })
        : t('performance.twr_hint'),
    },
    {
      label: t('summary.xirr'),
      value: returns ? pct(returns.xirr.value) : '—',
      sub: returns?.xirr.reason
        ? t('performance.reason', { reason: t(`../enums:performance_reason.${returns.xirr.reason}`) })
        : t('performance.xirr_hint'),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="card space-y-1">
          <p className="text-xs text-[var(--color-content-muted)]">{card.label}</p>
          <p
            className={`text-xl font-semibold tabular-nums ${
              card.emphasis === undefined
                ? ''
                : card.emphasis >= 0
                  ? 'text-[var(--color-positive,#4ea87c)]'
                  : 'text-[var(--color-negative)]'
            }`}
          >
            {card.value}
          </p>
          <p className="text-xs text-[var(--color-content-muted)]">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
