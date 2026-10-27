import { formatNumber } from '@/lib/format';
import type { GoalProjection } from '@/lib/goals';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Calculator, Shuffle } from 'lucide-react';

interface Props {
  projection: GoalProjection;
  currency: string;
}

/**
 * 预测与概率必须并列且分色：左卡是"按固定收益率推算"的点估计，
 * 右卡是"按随机模拟推算"的区间与概率。两者永不加权合并。
 */
export default function GoalProjectionCards({ projection, currency }: Props) {
  const { t } = useTranslation('goals');

  const money = (value: string | null) =>
    value === null ? '—' : `${formatNumber(value, { maximumFractionDigits: 2 })} ${currency}`;

  const reasons = projection.unavailableReasons;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <section className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <header className="mb-3 flex items-center gap-2">
          <Calculator className="size-4 text-[var(--color-accent)]" aria-hidden />
          <h3 className="text-sm font-semibold">{t('prediction.deterministic_title')}</h3>
        </header>

        {projection.deterministic === null ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            {reasons.includes('no_expected_return')
              ? t('prediction.no_expected_return')
              : t('prediction.deterministic_unavailable')}
          </p>
        ) : (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--color-content-muted)]">{t('prediction.eta')}</dt>
                <dd className="tabular-nums">
                  {projection.deterministic.etaMonths === null
                    ? t('prediction.beyond_horizon')
                    : t('prediction.eta_value', {
                        months: projection.deterministic.etaMonths,
                        date: projection.deterministic.etaDate ?? '',
                      })}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--color-content-muted)]">{t('prediction.required_monthly')}</dt>
                <dd className="tabular-nums">{money(projection.deterministic.requiredMonthly)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--color-content-muted)]">{t('prediction.projected_value')}</dt>
                <dd className="tabular-nums">{money(projection.deterministic.projectedValue)}</dd>
              </div>
            </dl>

            {!projection.deterministic.feasible && (
              <p className="mt-3 rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-xs text-[var(--color-negative)]">
                {t('prediction.infeasible')}
              </p>
            )}

            <p className="mt-3 text-xs text-[var(--color-content-muted)]">
              {t('prediction.basis', {
                rate: (Number(projection.deterministic.basis.expectedAnnualReturn) * 100).toFixed(2),
                engine: projection.deterministic.basis.engine,
              })}
            </p>
          </>
        )}
      </section>

      <section className="rounded-xl border border-[var(--color-border-subtle)] p-4">
        <header className="mb-3 flex items-center gap-2">
          <Shuffle className="size-4 text-[var(--color-warning)]" aria-hidden />
          <h3 className="text-sm font-semibold">{t('prediction.probabilistic_title')}</h3>
        </header>

        {projection.probabilistic === null ? (
          <>
            <p className="text-sm text-[var(--color-content-muted)]">{t('prediction.no_matching_run')}</p>
            {projection.matchedExpected && (
              <p className="mt-2 text-xs text-[var(--color-content-muted)]">
                {t('prediction.matched_expected', {
                  amount: formatNumber(projection.matchedExpected.targetAmount, { maximumFractionDigits: 0 }),
                  years: projection.matchedExpected.years,
                  currency: projection.matchedExpected.currency,
                })}
              </p>
            )}
            <Link
              to="/monte-carlo"
              className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
            >
              {t('prediction.go_create_run')}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          </>
        ) : (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--color-content-muted)]">{t('prediction.probability')}</dt>
                <dd className="tabular-nums">
                  {(Number(projection.probabilistic.probability) * 100).toFixed(1)}%
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--color-content-muted)]">{t('prediction.range')}</dt>
                <dd className="tabular-nums">
                  {money(projection.probabilistic.p10)} – {money(projection.probabilistic.p90)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--color-content-muted)]">{t('prediction.median')}</dt>
                <dd className="tabular-nums">{money(projection.probabilistic.p50)}</dd>
              </div>
            </dl>

            <p className="mt-3 text-xs text-[var(--color-content-muted)]">
              {t('prediction.run_basis', {
                paths: projection.probabilistic.pathCount,
                seed: projection.probabilistic.seed,
              })}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
