import { formatNumber } from '@/lib/format';
import type { SimulationResult } from '@/lib/monte-carlo';
import { useTranslation } from 'react-i18next';

interface Props {
  result: SimulationResult;
  currency: string;
}

function percent(value: string | null): string {
  if (value === null) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function money(value: string, currency: string): string {
  return `${formatNumber(value, { maximumFractionDigits: 0 })} ${currency}`;
}

export default function MetricCards({ result, currency }: Props) {
  const { t } = useTranslation('monte-carlo');

  const cards = [
    {
      key: 'median',
      label: t('metric.median'),
      value: money(result.terminal.nominal.p50, currency),
      hint: t('metric.median_hint'),
      title: t('metric.median_precise', { value: result.terminal.nominal.p50 }),
    },
    {
      key: 'range',
      label: t('metric.range'),
      value: `${formatNumber(result.terminal.nominal.p10, { notation: 'compact', maximumFractionDigits: 1 })} – ${formatNumber(
        result.terminal.nominal.p90,
        { notation: 'compact', maximumFractionDigits: 1 },
      )}`,
      hint: t('metric.range_hint'),
      title: `P10 ${result.terminal.nominal.p10} / P90 ${result.terminal.nominal.p90}`,
    },
    {
      key: 'loss',
      label: t('metric.loss'),
      value: percent(result.probabilities.loss),
      hint: t('metric.loss_hint'),
      title: t('metric.loss_precise', { value: result.probabilities.loss }),
    },
    {
      key: 'realLoss',
      label: t('metric.real_loss'),
      value: percent(result.probabilities.realLoss),
      hint: t('metric.real_loss_hint'),
      title: t('metric.real_loss_precise', { value: result.probabilities.realLoss }),
    },
    {
      key: 'target',
      label: t('metric.target'),
      value: percent(result.probabilities.target),
      hint: result.probabilities.target === null ? t('metric.target_unset') : t('metric.target_hint'),
      title:
        result.probabilities.target === null
          ? t('metric.target_unset')
          : t('metric.target_precise', { value: result.probabilities.target }),
    },
    {
      key: 'drawdown',
      label: t('metric.drawdown'),
      value: percent(result.drawdown.p90),
      hint: t('metric.drawdown_hint'),
      title: t('metric.drawdown_precise', { value: result.drawdown.p90 }),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {cards.map((card) => (
        <div key={card.key} className="card p-3" title={card.title}>
          <p className="text-xs text-[var(--color-content-muted)]">{card.label}</p>
          <p className="mt-1 truncate text-lg font-semibold tabular-nums">{card.value}</p>
          <p className="mt-0.5 text-[11px] leading-tight text-[var(--color-content-muted)]">{card.hint}</p>
        </div>
      ))}
    </div>
  );
}
