import { formatNumber } from '@/lib/format';
import type { FinancialIndependence } from '@/lib/goals';
import { useTranslation } from 'react-i18next';

interface Props {
  data: FinancialIndependence;
  currency: string;
  onRateChange: (rate: string) => void;
  onScaleChange: (annualExpense: string | undefined) => void;
}

export default function FinancialIndependencePanel({ data, currency, onRateChange }: Props) {
  const { t } = useTranslation('goals');

  const money = (value: string | null) =>
    value === null ? '—' : `${formatNumber(value, { maximumFractionDigits: 2 })} ${currency}`;

  const percent = (value: string | null) =>
    value === null ? '—' : `${(Number(value) * 100).toFixed(1)}%`;

  const months = (value: string | null) => (value === null ? '—' : `${Number(value).toFixed(1)}`);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t('fi.annual_expense')} value={money(data.annualExpense)} />
        <Metric label={t('fi.target_assets')} value={money(data.targetAssets)} />
        <Metric label={t('fi.progress')} value={percent(data.progress)} />
        <Metric label={t('fi.coverage_months')} value={months(data.coverageMonths)} />
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-[var(--color-border-subtle)] p-4">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('fi.withdrawal_rate')}</span>
          <input
            type="range"
            min={2}
            max={10}
            step={0.5}
            value={Number(data.withdrawalRate) * 100}
            onChange={(event) => onRateChange((Number(event.target.value) / 100).toFixed(6))}
            className="w-full"
          />
          <span className="mt-1 block text-xs tabular-nums">{percent(data.withdrawalRate)}</span>
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('fi.safety_margin')}</span>
          <span
            className={`tabular-nums ${
              data.safetyMargin !== null && Number(data.safetyMargin) < 0
                ? 'text-[var(--color-negative)]'
                : 'text-[var(--color-positive)]'
            }`}
          >
            {percent(data.safetyMargin)}
          </span>
        </div>
      </div>

      {data.sensitivity && (
        <div className="overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
          <div className="border-b border-[var(--color-border-subtle)] px-4 py-2 text-sm font-medium">
            {t('fi.sensitivity_title')}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--color-content-muted)]">
                <th className="px-3 py-2 text-left font-normal">{t('fi.rate_column')}</th>
                {data.sensitivity.expenseScale.map((scale) => (
                  <th key={scale} className="px-3 py-2 text-right font-normal">
                    {t('fi.expense_scale', { percent: (Number(scale) * 100).toFixed(0) })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.sensitivity.cells.map((row, rowIndex) => (
                <tr key={data.sensitivity!.withdrawalRates[rowIndex]} className="border-t border-[var(--color-border-subtle)]">
                  <td className="px-3 py-2 tabular-nums">
                    {percent(data.sensitivity!.withdrawalRates[rowIndex] ?? null)}
                  </td>
                  {row.map((cell, columnIndex) => (
                    <td key={columnIndex} className="px-3 py-2 text-right tabular-nums">
                      <div>{money(cell.targetAssets)}</div>
                      <div className="text-xs text-[var(--color-content-muted)]">{percent(cell.progress)}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.unavailableReasons.length > 0 && (
        <ul className="rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-content-muted)]">
          {data.unavailableReasons.map((reason) => (
            <li key={reason}>{t(`fi.reasons.${reason}`, { defaultValue: reason })}</li>
          ))}
        </ul>
      )}

      <ul className="space-y-1 text-xs text-[var(--color-content-muted)]">
        {data.disclaimers.map((key) => (
          <li key={key}>{t(`fi.disclaimers.${key}`, { defaultValue: key })}</li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] p-3">
      <p className="text-xs text-[var(--color-content-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
