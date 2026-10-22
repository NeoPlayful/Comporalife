import { translateError } from '@/lib/error-message';
import { formatNumber } from '@/lib/format';
import {
  DEFAULT_PARAMS,
  simulationsApi,
  type CompoundParams,
  type Comparison,
  type Scenario,
} from '@/lib/simulations';
import CompoundChart from '@/components/charts/CompoundChart';
import LoadingState from '@/components/ui/LoadingState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Info, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const FREQUENCY_KEYS: CompoundParams['contributionFrequency'][] = ['none', 'monthly', 'annual'];

export default function CompoundPage() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [params, setParams] = useState<CompoundParams>(DEFAULT_PARAMS);
  const [debounced, setDebounced] = useState<CompoundParams>(DEFAULT_PARAMS);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  // 参数变更后防抖 300ms 再计算，避免每次按键都打接口
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(params), 300);
    return () => clearTimeout(timer);
  }, [params]);

  const scenariosQuery = useQuery({
    queryKey: ['scenarios'],
    queryFn: simulationsApi.list,
  });

  const calculateQuery = useQuery({
    queryKey: ['compound-calc', debounced],
    queryFn: () => simulationsApi.calculate(debounced),
    enabled:
      Number(debounced.principal) > 0 || Number(debounced.contributionAmount) > 0,
    retry: false,
  });

  const compareQuery = useQuery({
    queryKey: ['compound-compare', compareIds],
    queryFn: () => simulationsApi.compare({ scenarioIds: compareIds }),
    enabled: compareIds.length >= 2,
  });

  const saveMutation = useMutation({
    mutationFn: () => simulationsApi.save({ ...params, name: saveName.trim() }),
    onSuccess: () => {
      setSaveOpen(false);
      setSaveName('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => simulationsApi.remove(id),
    onSuccess: () => {
      setCompareIds((ids) => ids.filter((id) => id !== ''));
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => simulationsApi.duplicate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scenarios'] }),
  });

  const result = calculateQuery.data?.result;
  const scenarios = scenariosQuery.data?.scenarios ?? [];

  const chartSeries = useMemo(() => {
    if (compareIds.length >= 2 && compareQuery.data) {
      return compareQuery.data.comparisons.map((item: Comparison) => ({
        label: item.label,
        points: item.yearSeries.map((point) => ({
          year: point.year,
          totalContributed: item.totalContributed,
          nominalValue: point.nominalValue,
        })),
      }));
    }

    if (!result) return [];

    return [
      {
        label: t('compound:chart.current_params'),
        points: result.yearlySchedule.map((row) => ({
          year: row.year,
          totalContributed: row.totalContributed,
          nominalValue: row.nominalValue,
        })),
      },
    ];
  }, [compareIds.length, compareQuery.data, result, t]);

  const compareMode = compareIds.length >= 2;
  const displayResult = compareMode ? null : result;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('compound:title')}</h1>
          <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
            {t('compound:disclaimer')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSaveOpen((open) => !open)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
        >
          <Save className="size-4" />
          {t('compound:save_scenario')}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      {saveOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (saveName.trim()) saveMutation.mutate();
          }}
          className="card flex flex-wrap gap-2 p-3"
        >
          <input
            autoFocus
            maxLength={60}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={t('compound:scenario_name_placeholder')}
            className="input max-w-xs"
          />
          <button
            type="submit"
            disabled={!saveName.trim() || saveMutation.isPending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {t('compound:save')}
          </button>
          <button
            type="button"
            onClick={() => setSaveOpen(false)}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('compound:cancel')}
          </button>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="card h-fit space-y-3 p-4">
          <h2 className="text-sm font-medium">{t('compound:params.title')}</h2>

          <NumberField
            label={t('compound:params.principal')}
            value={params.principal}
            onChange={(value) => setParams({ ...params, principal: value })}
          />

          <div className="grid grid-cols-[1fr_110px] gap-2">
            <NumberField
              label={t('compound:params.contribution')}
              value={params.contributionAmount}
              onChange={(value) => setParams({ ...params, contributionAmount: value })}
            />
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--color-content-muted)]">
                {t('compound:params.frequency')}
              </span>
              <select
                value={params.contributionFrequency}
                onChange={(e) =>
                  setParams({
                    ...params,
                    contributionFrequency: e.target.value as CompoundParams['contributionFrequency'],
                  })
                }
                className="input"
              >
                {FREQUENCY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {t(`enums:contribution_frequency.${key}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {params.contributionFrequency !== 'none' && (
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--color-content-muted)]">
                {t('compound:params.timing')}
              </span>
              <select
                value={params.contributionTiming}
                onChange={(e) =>
                  setParams({
                    ...params,
                    contributionTiming: e.target.value as CompoundParams['contributionTiming'],
                  })
                }
                className="input"
              >
                <option value="end">{t('compound:params.timing_end')}</option>
                <option value="begin">{t('compound:params.timing_begin')}</option>
              </select>
            </label>
          )}

          <PercentField
            label={t('compound:params.annual_return')}
            value={params.annualReturnRate}
            onChange={(value) => setParams({ ...params, annualReturnRate: value })}
          />

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">
              {t('compound:params.years')}
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={params.years}
              onChange={(e) =>
                setParams({ ...params, years: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })
              }
              className="input"
            />
          </label>

          <PercentField
            label={t('compound:params.inflation')}
            value={params.inflationRate}
            onChange={(value) => setParams({ ...params, inflationRate: value })}
          />

          <PercentField
            label={t('compound:params.fee')}
            value={params.feeRate}
            onChange={(value) => setParams({ ...params, feeRate: value })}
          />
        </section>

        <div className="space-y-4">
          {calculateQuery.isLoading && <LoadingState label={t('compound:calculating')} />}

          {calculateQuery.isError && (
            <p className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
              {translateError(calculateQuery.error, t)}
            </p>
          )}

          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium">
                {compareMode ? t('compound:chart.comparison') : t('compound:chart.growth')}
              </h2>
              {compareMode && (
                <button
                  type="button"
                  onClick={() => setCompareIds([])}
                  className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-accent)]"
                >
                  {t('compound:chart.exit_comparison')}
                </button>
              )}
            </div>

            <CompoundChart series={chartSeries} />

            {!compareMode && (
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--color-content-muted)]">
                <span>{t('compound:chart.legend_principal')}</span>
                <span>{t('compound:chart.legend_interest')}</span>
              </div>
            )}
          </section>

          {displayResult && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ResultCard
                  label={t('compound:results.final_nominal')}
                  value={displayResult.finalNominalValue}
                  highlight
                />
                <ResultCard
                  label={t('compound:results.total_contributed')}
                  value={displayResult.totalContributed}
                />
                <ResultCard
                  label={t('compound:results.total_gain')}
                  value={displayResult.totalGain}
                  tone="positive"
                />
                <ResultCard
                  label={t('compound:results.final_real')}
                  value={displayResult.finalRealValue}
                />
              </div>

              <section className="card overflow-hidden">
                <h2 className="border-b border-[var(--color-border-subtle)] px-4 py-3 text-sm font-medium">
                  {t('compound:schedule.title')}
                </h2>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--color-surface-raised)] text-left text-xs text-[var(--color-content-muted)]">
                      <tr>
                        <th className="px-4 py-2">{t('compound:schedule.year')}</th>
                        <th className="px-4 py-2 text-right">
                          {t('compound:schedule.contributed_this_year')}
                        </th>
                        <th className="px-4 py-2 text-right">
                          {t('compound:schedule.total_contributed')}
                        </th>
                        <th className="px-4 py-2 text-right">
                          {t('compound:schedule.nominal_value')}
                        </th>
                        <th className="px-4 py-2 text-right">
                          {t('compound:schedule.real_value')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {displayResult.yearlySchedule.map((row) => (
                        <tr key={row.year}>
                          <td className="px-4 py-1.5 text-[var(--color-content-muted)]">{row.year}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums">
                            {formatNumber(row.contributedThisYear, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-[var(--color-content-muted)]">
                            {formatNumber(row.totalContributed, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums">
                            {formatNumber(row.nominalValue, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-[var(--color-content-muted)]">
                            {formatNumber(row.realValue, { maximumFractionDigits: 0 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card p-4">
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Info className="size-4 text-[var(--color-content-muted)]" />
                  {t('compound:assumptions.title')}
                </h2>
                <dl className="grid gap-1.5 text-xs text-[var(--color-content-muted)] sm:grid-cols-2">
                  {Object.entries(displayResult.assumptions)
                    .filter(([key]) => key !== 'modelVersion')
                    .map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <dt className="shrink-0">
                          {t(`compound:assumptions.labels.${key}`, { defaultValue: key })}
                          {t('compound:label_separator')}
                        </dt>
                        <dd className="break-all">
                          {key === 'disclaimer' ? t('compound:disclaimer') : String(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
                <p className="mt-2 text-xs text-[var(--color-content-muted)]">
                  {t('compound:assumptions.model_version', {
                    version: displayResult.modelVersion,
                  })}
                </p>
              </section>
            </>
          )}
        </div>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">
            {t('compound:saved.title', { count: scenarios.length })}
          </h2>
          <p className="text-xs text-[var(--color-content-muted)]">{t('compound:saved.hint')}</p>
        </div>

        {scenarios.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-content-muted)]">
            {t('compound:saved.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {scenarios.map((scenario: Scenario) => {
              const checked = compareIds.includes(scenario.id);
              return (
                <li key={scenario.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && compareIds.length >= 4}
                    onChange={() =>
                      setCompareIds((ids) =>
                        checked ? ids.filter((id) => id !== scenario.id) : [...ids, scenario.id],
                      )
                    }
                    className="size-4 rounded border-[var(--color-border-subtle)]"
                    aria-label={t('compound:saved.compare_aria', { name: scenario.name })}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setParams({
                        principal: scenario.principal,
                        contributionAmount: scenario.contributionAmount,
                        contributionFrequency: scenario.contributionFrequency,
                        contributionTiming: scenario.contributionTiming,
                        annualReturnRate: scenario.annualReturnRate,
                        years: scenario.years,
                        inflationRate: scenario.inflationRate,
                        feeRate: scenario.feeRate,
                      })
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm">{scenario.name}</p>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {t('compound:saved.summary', {
                        principal: formatNumber(scenario.principal),
                        rate: (Number(scenario.annualReturnRate) * 100).toFixed(1),
                        years: scenario.years,
                      })}
                      {scenario.contributionFrequency !== 'none' &&
                        ` · ${t(`enums:contribution_frequency.${scenario.contributionFrequency}`)}`}
                    </p>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => duplicateMutation.mutate(scenario.id)}
                      className="grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
                      aria-label={t('compound:saved.copy_aria', { name: scenario.name })}
                      title={t('compound:saved.copy')}
                    >
                      <Copy className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(scenario.id)}
                      className="grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 hover:text-[var(--color-negative)] dark:hover:bg-white/5"
                      aria-label={t('compound:saved.delete_aria', { name: scenario.name })}
                      title={t('compound:saved.delete')}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[var(--color-content-muted)]">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
        className="input"
      />
    </label>
  );
}

/** 以百分比展示，内部仍以小数传给后端，避免两套精度 */
function PercentField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('compound');
  const percent = Number(value) * 100;

  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[var(--color-content-muted)]">
        {label}
        {t('params.percent_suffix')}
      </span>
      <input
        type="number"
        step="0.1"
        value={Number.isFinite(percent) ? Number(percent.toFixed(4)) : ''}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Number.isFinite(next) ? String(next / 100) : '0');
        }}
        className="input"
      />
    </label>
  );
}

function ResultCard({
  label,
  value,
  tone,
  highlight,
}: {
  label: string;
  value: string;
  tone?: 'positive';
  highlight?: boolean;
}) {
  return (
    <div className={`card p-3 ${highlight ? 'ring-1 ring-[var(--color-accent)]/40' : ''}`}>
      <p className="text-xs text-[var(--color-content-muted)]">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === 'positive' ? 'text-[var(--color-positive)]' : ''
        }`}
      >
        {formatNumber(value, { maximumFractionDigits: 0 })}
      </p>
    </div>
  );
}
