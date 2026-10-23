import { formatNumber } from '@/lib/format';
import type { Assumptions, SimulationResult } from '@/lib/monte-carlo';
import { AlertTriangle, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  result: SimulationResult;
  assumptions: Assumptions;
  currency: string;
  /** 样本量低于该值时提示分位数波动较大 */
  smallSampleThreshold?: number;
}

export default function AssumptionNotice({
  result,
  assumptions,
  currency,
  smallSampleThreshold = 2000,
}: Props) {
  const { t } = useTranslation('monte-carlo');

  const sampleSizeKey = assumptions.pathCount < smallSampleThreshold ? 'notice.small_sample' : null;

  const disclaimerKeys = [
    'notice.disclaimer_model',
    'notice.disclaimer_not_promise',
    'notice.disclaimer_costs',
    'notice.disclaimer_sampling',
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-content-muted)]">
        <span className="rounded bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono">
          {t('notice.model_version', { version: assumptions.modelVersion })}
        </span>
        <span className="rounded bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono">
          {t('notice.seed', { seed: assumptions.seed })}
        </span>
        <span className="rounded bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono">
          {t('notice.paths', { count: assumptions.pathCount })}
        </span>
        <span className="rounded bg-[var(--color-surface-raised)] px-2 py-0.5 font-mono">
          {t('notice.standard_error', {
            value: formatNumber(result.standardError, { maximumFractionDigits: 0 }),
            currency,
          })}
        </span>
        <span className="rounded bg-[var(--color-surface-raised)] px-2 py-0.5">
          {t(`rebalance.${assumptions.rebalance}`)}
        </span>
      </div>

      {sampleSizeKey && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {t(sampleSizeKey, { count: assumptions.pathCount })}
        </p>
      )}

      <details className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-content-muted)]">
          <Info className="size-3.5" aria-hidden />
          {t('notice.assumptions_title')}
        </summary>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
          <Row label={t('notice.field.years')} value={String(assumptions.years)} />
          <Row label={t('notice.field.initial')} value={`${formatNumber(assumptions.initialValue, { maximumFractionDigits: 0 })} ${currency}`} />
          <Row label={t('notice.field.contribution')} value={describeContribution(assumptions, currency)} />
          <Row label={t('notice.field.withdrawal')} value={describeWithdrawal(assumptions, currency)} />
          <Row label={t('notice.field.inflation')} value={`${(Number(assumptions.inflationRate) * 100).toFixed(2)}%`} />
          <Row label={t('notice.field.fee')} value={`${(Number(assumptions.feeRate) * 100).toFixed(2)}%`} />
        </dl>

        <ul className="mt-3 space-y-1 border-t border-[var(--color-border-subtle)] pt-2 text-[11px] text-[var(--color-content-muted)]">
          {assumptions.assets.map((asset) => (
            <li key={asset.key} className="flex flex-wrap gap-x-3">
              <span className="font-medium text-[var(--color-content)]">{asset.label}</span>
              <span>{t('notice.field.weight')} {(Number(asset.weight) * 100).toFixed(1)}%</span>
              <span>{t('notice.field.return')} {(Number(asset.expectedAnnualReturn) * 100).toFixed(1)}%</span>
              <span>{t('notice.field.volatility')} {(Number(asset.annualVolatility) * 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>

        {assumptions.stressPreset && (
          <p className="mt-2 text-[11px] text-[var(--color-content-muted)]">
            {t('notice.stress_note', { preset: t(`stress.preset.${assumptions.stressPreset}.label`) })}
          </p>
        )}
      </details>

      <ul className="space-y-1 text-[11px] leading-relaxed text-[var(--color-content-muted)]">
        {disclaimerKeys.map((key) => (
          <li key={key}>· {t(key)}</li>
        ))}
        {result.deterministic && <li>· {t('notice.disclaimer_deterministic')}</li>}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[var(--color-content-muted)]">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function describeContribution(assumptions: Assumptions, currency: string): string {
  const { amount, frequency } = assumptions.contribution;
  if (frequency === 'none' || Number(amount) === 0) return '—';

  return `${formatNumber(amount, { maximumFractionDigits: 0 })} ${currency} / ${frequency}`;
}

function describeWithdrawal(assumptions: Assumptions, currency: string): string {
  const { amount, frequency, startYear } = assumptions.withdrawal;
  if (frequency === 'none' || Number(amount) === 0) return '—';

  return `${formatNumber(amount, { maximumFractionDigits: 0 })} ${currency} / ${frequency} @ Y${startYear}`;
}
