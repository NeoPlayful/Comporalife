import { translateError } from '@/lib/error-message';
import { simulationsApi, type CompoundParams, type SolveResult } from '@/lib/simulations';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 目标反推：给定目标金额，二分求所需定期投入或所需年限。
 * 不可达时后端返回 422，这里直接展示原因，不做本地兜底猜测。
 */
export default function SolvePanel({
  params,
  renderAmountField,
}: {
  params: CompoundParams;
  renderAmountField: (props: { label: string; value: string; onChange: (value: string) => void }) => React.ReactNode;
}) {
  const { t } = useTranslation('compound');
  const [targetAmount, setTargetAmount] = useState('');
  const [solveFor, setSolveFor] = useState<'contribution' | 'years'>('contribution');
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const solve = useMutation({
    mutationFn: () =>
      simulationsApi.solve({
        ...params,
        // 按年限反推时必须给出每次投入金额；按投入反推时金额由求解得出
        ...(solveFor === 'years' ? { contributionAmount: params.contributionAmount } : {}),
        targetAmount,
        solveFor,
      }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (err) => {
      setResult(null);
      setError(translateError(err, t));
    },
  });

  return (
    <details className="rounded-lg border border-[var(--color-border-subtle)] p-3">
      <summary className="cursor-pointer text-sm text-[var(--color-content-muted)]">
        {t('solve.title')}
      </summary>

      <div className="mt-3 space-y-3">
        {renderAmountField({
          label: t('solve.target'),
          value: targetAmount,
          onChange: setTargetAmount,
        })}

        <label className="block text-sm">
          {t('solve.solve_for')}
          <select
            className="input mt-1"
            value={solveFor}
            onChange={(event) => setSolveFor(event.target.value as 'contribution' | 'years')}
          >
            <option value="contribution">{t('solve.for_contribution')}</option>
            <option value="years">{t('solve.for_years')}</option>
          </select>
        </label>

        <button
          type="button"
          className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm disabled:opacity-60"
          disabled={!targetAmount || solve.isPending}
          onClick={() => solve.mutate()}
        >
          {solve.isPending ? t('solve.solving') : t('solve.action')}
        </button>

        {error && <p className="text-xs text-[var(--color-negative)]">{error}</p>}

        {result && (
          <div className="space-y-1 text-xs">
            {result.solveFor === 'contribution' ? (
              <p>
                {t('solve.required_contribution', {
                  value: Number(result.requiredContribution).toFixed(2),
                  years: result.years,
                })}
              </p>
            ) : (
              <p>
                {t('solve.required_years', {
                  years: result.requiredYears,
                  value: Number(result.contributionAmount).toFixed(2),
                })}
              </p>
            )}
            <p className="text-[var(--color-content-muted)]">
              {t('solve.actual', {
                value: Number(result.actualValue).toFixed(2),
                diff: Number(result.difference).toFixed(2),
              })}
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
