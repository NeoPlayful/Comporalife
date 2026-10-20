import { ApiError } from '@/api/client';
import {
  DEFAULT_PARAMS,
  simulationsApi,
  type CompoundParams,
  type Comparison,
  type Scenario,
} from '@/api/simulations';
import CompoundChart from '@/components/charts/CompoundChart';
import LoadingState from '@/components/ui/LoadingState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Info, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const PACKAGE_LABELS: Record<CompoundParams['contributionFrequency'], string> = {
  none: '不追加',
  monthly: '每月',
  annual: '每年',
};

export default function CompoundPage() {
  const queryClient = useQueryClient();
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
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => simulationsApi.remove(id),
    onSuccess: () => {
      setCompareIds((ids) => ids.filter((id) => id !== ''));
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '删除失败'),
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
        label: '当前参数',
        points: result.yearlySchedule.map((row) => ({
          year: row.year,
          totalContributed: row.totalContributed,
          nominalValue: row.nominalValue,
        })),
      },
    ];
  }, [compareIds.length, compareQuery.data, result]);

  const compareMode = compareIds.length >= 2;
  const displayResult = compareMode ? null : result;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">复利与定投模拟</h1>
          <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
            固定收益率仅为数学假设，不代表实际投资收益
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSaveOpen((open) => !open)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
        >
          <Save className="size-4" />
          保存方案
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
            placeholder="方案名称，例如「基准 7%」"
            className="input max-w-xs"
          />
          <button
            type="submit"
            disabled={!saveName.trim() || saveMutation.isPending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => setSaveOpen(false)}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            取消
          </button>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="card h-fit space-y-3 p-4">
          <h2 className="text-sm font-medium">参数</h2>

          <NumberField
            label="初始本金"
            value={params.principal}
            onChange={(value) => setParams({ ...params, principal: value })}
          />

          <div className="grid grid-cols-[1fr_110px] gap-2">
            <NumberField
              label="定期投入"
              value={params.contributionAmount}
              onChange={(value) => setParams({ ...params, contributionAmount: value })}
            />
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--color-content-muted)]">频率</span>
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
                {(Object.keys(PACKAGE_LABELS) as Array<CompoundParams['contributionFrequency']>).map(
                  (key) => (
                    <option key={key} value={key}>
                      {PACKAGE_LABELS[key]}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          {params.contributionFrequency !== 'none' && (
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--color-content-muted)]">投入时点</span>
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
                <option value="end">期末投入</option>
                <option value="begin">期初投入</option>
              </select>
            </label>
          )}

          <PercentField
            label="年化收益率"
            value={params.annualReturnRate}
            onChange={(value) => setParams({ ...params, annualReturnRate: value })}
          />

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">投资期限（年）</span>
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
            label="通胀率"
            value={params.inflationRate}
            onChange={(value) => setParams({ ...params, inflationRate: value })}
          />

          <PercentField
            label="年费用率"
            value={params.feeRate}
            onChange={(value) => setParams({ ...params, feeRate: value })}
          />
        </section>

        <div className="space-y-4">
          {calculateQuery.isLoading && <LoadingState label="计算中…" />}

          {calculateQuery.isError && (
            <p className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
              {calculateQuery.error instanceof ApiError
                ? calculateQuery.error.message
                : '参数不合法，请检查输入'}
            </p>
          )}

          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium">
                {compareMode ? '方案对比' : '资金增长曲线'}
              </h2>
              {compareMode && (
                <button
                  type="button"
                  onClick={() => setCompareIds([])}
                  className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-accent)]"
                >
                  退出对比
                </button>
              )}
            </div>

            <CompoundChart series={chartSeries} />

            {!compareMode && (
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--color-content-muted)]">
                <span>蓝：累计本金</span>
                <span>绿：复利收益</span>
              </div>
            )}
          </section>

          {displayResult && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ResultCard label="期末名义价值" value={displayResult.finalNominalValue} highlight />
                <ResultCard label="累计投入本金" value={displayResult.totalContributed} />
                <ResultCard label="累计收益" value={displayResult.totalGain} tone="positive" />
                <ResultCard label="通胀调整后价值" value={displayResult.finalRealValue} />
              </div>

              <section className="card overflow-hidden">
                <h2 className="border-b border-[var(--color-border-subtle)] px-4 py-3 text-sm font-medium">
                  年度明细
                </h2>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-[var(--color-surface-raised)] text-left text-xs text-[var(--color-content-muted)]">
                      <tr>
                        <th className="px-4 py-2">年</th>
                        <th className="px-4 py-2 text-right">当年投入</th>
                        <th className="px-4 py-2 text-right">累计投入</th>
                        <th className="px-4 py-2 text-right">名义价值</th>
                        <th className="px-4 py-2 text-right">实际价值</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-border-subtle)]">
                      {displayResult.yearlySchedule.map((row) => (
                        <tr key={row.year}>
                          <td className="px-4 py-1.5 text-[var(--color-content-muted)]">{row.year}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums">
                            {Number(row.contributedThisYear).toLocaleString('zh-CN', {
                              maximumFractionDigits: 0,
                            })}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-[var(--color-content-muted)]">
                            {Number(row.totalContributed).toLocaleString('zh-CN', {
                              maximumFractionDigits: 0,
                            })}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums">
                            {Number(row.nominalValue).toLocaleString('zh-CN', {
                              maximumFractionDigits: 0,
                            })}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-[var(--color-content-muted)]">
                            {Number(row.realValue).toLocaleString('zh-CN', {
                              maximumFractionDigits: 0,
                            })}
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
                  计算假设
                </h2>
                <dl className="grid gap-1.5 text-xs text-[var(--color-content-muted)] sm:grid-cols-2">
                  {Object.entries(displayResult.assumptions)
                    .filter(([key]) => key !== 'modelVersion')
                    .map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <dt className="shrink-0">{ASSUMPTION_LABELS[key] ?? key}：</dt>
                        <dd className="break-all">{String(value)}</dd>
                      </div>
                    ))}
                </dl>
                <p className="mt-2 text-xs text-[var(--color-content-muted)]">
                  模型版本 {displayResult.modelVersion} · 结果可复现
                </p>
              </section>
            </>
          )}
        </div>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">已保存方案（{scenarios.length}）</h2>
          <p className="text-xs text-[var(--color-content-muted)]">
            勾选 2-4 个方案可进入对比视图
          </p>
        </div>

        {scenarios.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-content-muted)]">
            还没有保存的方案。调整参数后点击「保存方案」即可保留。
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
                    aria-label={`对比 ${scenario.name}`}
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
                      本金 {Number(scenario.principal).toLocaleString('zh-CN')} ·{' '}
                      {(Number(scenario.annualReturnRate) * 100).toFixed(1)}% · {scenario.years} 年
                      {scenario.contributionFrequency !== 'none' &&
                        ` · ${PACKAGE_LABELS[scenario.contributionFrequency]}`}
                    </p>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => duplicateMutation.mutate(scenario.id)}
                      className="grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
                      aria-label={`复制 ${scenario.name}`}
                      title="复制"
                    >
                      <Copy className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(scenario.id)}
                      className="grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 hover:text-[var(--color-negative)] dark:hover:bg-white/5"
                      aria-label={`删除 ${scenario.name}`}
                      title="删除"
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
  const percent = Number(value) * 100;

  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[var(--color-content-muted)]">{label}（%）</span>
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
        {Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
      </p>
    </div>
  );
}

const ASSUMPTION_LABELS: Record<string, string> = {
  monthlyRateBasis: '利率换算',
  monthlyFeeBasis: '费用换算',
  iterationOrder: '迭代顺序',
  contributionTiming: '投入时点',
  annualContributionMonth: '年付规则',
  annualReturnRate: '年化收益率',
  inflationRate: '通胀率',
  feeRate: '费用率',
  disclaimer: '声明',
};
