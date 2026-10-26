import AssetMatrixEditor from '@/components/monte-carlo/AssetMatrixEditor';
import AssumptionNotice from '@/components/monte-carlo/AssumptionNotice';
import CorrelationEditor from '@/components/monte-carlo/CorrelationEditor';
import FanChart from '@/components/monte-carlo/FanChart';
import MetricCards from '@/components/monte-carlo/MetricCards';
import TerminalHistogram from '@/components/monte-carlo/TerminalHistogram';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { translateError } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import {
  monteCarloApi,
  type RunDetail,
  type RunStatus,
  type RunSummary,
  type Scenario,
  type ScenarioBody,
  type StressPreset,
  type StressPresetKey,
} from '@/lib/monte-carlo';
import { portfoliosApi } from '@/lib/portfolios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Tab = 'params' | 'assets' | 'correlation' | 'runs' | 'result';

/** 新建方案时的默认参数，与后端默认值保持一致 */
function defaultBody(): ScenarioBody {
  return {
    name: '',
    currency: 'CNY',
    years: 20,
    pathCount: 5000,
    rebalance: 'annual',
    assets: [
      {
        key: 'equity',
        label: '股票',
        weight: '0.600000',
        expectedAnnualReturn: '0.070000',
        annualVolatility: '0.150000',
      },
      {
        key: 'bond',
        label: '债券',
        weight: '0.400000',
        expectedAnnualReturn: '0.030000',
        annualVolatility: '0.050000',
      },
    ],
    correlation: [
      [1, 0.2],
      [0.2, 1],
    ],
    settings: {
      initialValue: '100000',
      contribution: { amount: '3000', frequency: 'monthly', timing: 'end' },
      withdrawal: { amount: '0', frequency: 'none', startYear: 1 },
      inflationRate: '0.025',
      feeRate: '0',
      targetAmount: null,
    },
  };
}

export default function MonteCarloPage() {
  const { t } = useTranslation('monte-carlo');
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('params');
  const [draft, setDraft] = useState<ScenarioBody | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stressPreset, setStressPreset] = useState<StressPresetKey | ''>('');

  const listQuery = useQuery({
    queryKey: ['monte-carlo'],
    queryFn: () => monteCarloApi.list(),
  });

  const presetsQuery = useQuery({
    queryKey: ['monte-carlo', 'presets'],
    queryFn: () => monteCarloApi.presets(),
  });

  const portfoliosQuery = useQuery({
    queryKey: ['portfolios', 'active'],
    queryFn: () => portfoliosApi.list('active'),
  });

  const scenarioQuery = useQuery({
    queryKey: ['monte-carlo', 'scenario', selectedId],
    queryFn: () => monteCarloApi.get(selectedId!),
    enabled: Boolean(selectedId),
  });

  const runsQuery = useQuery({
    queryKey: ['monte-carlo', 'runs', selectedId],
    queryFn: () => monteCarloApi.listRuns(selectedId!),
    enabled: Boolean(selectedId),
    // 运行列表里只要还有未结束的项就持续刷新，否则状态徽标会一直停在「运行中」
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const active = items.some((item) => item.status === 'queued' || item.status === 'running');
      return active ? 1500 : false;
    },
  });

  // 选中方案后把服务端参数复制成草稿，编辑不改动已保存版本
  useEffect(() => {
    if (!scenarioQuery.data) return;
    setDraft(toBody(scenarioQuery.data));
  }, [scenarioQuery.data]);

  const runQuery = useQuery({
    queryKey: ['monte-carlo', 'run', selectedId, activeRunId],
    queryFn: () => monteCarloApi.getRun(selectedId!, activeRunId!),
    enabled: Boolean(selectedId && activeRunId),
    // 没有数据时也要轮询，否则首次请求返回后永远等不到下一次刷新
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      if (status && ['succeeded', 'failed', 'cancelled'].includes(status)) return false;
      return typeof document !== 'undefined' && document.hidden ? 5000 : 1000;
    },
  });

  const resultQuery = useQuery({
    queryKey: ['monte-carlo', 'result', selectedId, activeRunId],
    queryFn: () => monteCarloApi.getResult(selectedId!, activeRunId!),
    enabled: Boolean(
      selectedId && activeRunId && runQuery.data?.run.status === 'succeeded',
    ),
  });

  const items = listQuery.data?.items ?? [];

  // 首次进入自动选中第一个方案，避免右侧一直是空的
  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0]!.id);
  }, [items, selectedId]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('no draft');
      return creating || !selectedId
        ? monteCarloApi.create(draft)
        : monteCarloApi.update(selectedId, draft);
    },
    onSuccess: (scenario) => {
      setCreating(false);
      setError(null);
      setSelectedId(scenario.id);
      void queryClient.invalidateQueries({ queryKey: ['monte-carlo'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => monteCarloApi.remove(id),
    onSuccess: () => {
      setSelectedId(null);
      setDraft(null);
      setActiveRunId(null);
      void queryClient.invalidateQueries({ queryKey: ['monte-carlo'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => monteCarloApi.duplicate(id, name),
    onSuccess: (scenario) => {
      setSelectedId(scenario.id);
      void queryClient.invalidateQueries({ queryKey: ['monte-carlo'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const runMutation = useMutation({
    mutationFn: () =>
      monteCarloApi.createRun(selectedId!, {
        ...(stressPreset ? { stressPreset } : {}),
      }),
    onSuccess: (run) => {
      setActiveRunId(run.id);
      setTab('runs');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['monte-carlo', 'runs', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['monte-carlo'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => monteCarloApi.cancelRun(selectedId!, activeRunId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monte-carlo', 'run', selectedId, activeRunId] });
      void queryClient.invalidateQueries({ queryKey: ['monte-carlo', 'runs', selectedId] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const applySuggestion = async (portfolioId: string) => {
    try {
      const suggestion = await monteCarloApi.suggestions(portfolioId);
      const base = draft ?? defaultBody();

      setDraft({
        ...base,
        currency: suggestion.portfolio.currency,
        assets: suggestion.assets.map((asset) => ({
          key: asset.key,
          label: asset.label,
          weight: asset.weight,
          expectedAnnualReturn: asset.expectedAnnualReturn ?? '0.070000',
          annualVolatility: asset.annualVolatility ?? '0.150000',
        })),
        // 相关性不由系统猜测，保留单位矩阵作为起点
        correlation: Array.from({ length: suggestion.assets.length }, (_, i) =>
          Array.from({ length: suggestion.assets.length }, (_, j) => (i === j ? 1 : 0)),
        ),
      });
      setTab('assets');
      setError(null);
    } catch (err) {
      setError(translateError(err, t));
    }
  };

  const run = runQuery.data?.run ?? null;

  // 进入页面或切换方案时若没有选中运行，自动挂到最近一次成功运行上，
  // 否则结果 Tab 对着一个空 runId 永远只显示「还没有可查看的结果」
  useEffect(() => {
    if (activeRunId || creating || !selectedId) return;

    const latest = runsQuery.data?.items.find((item) => item.status === 'succeeded')
      ?? runsQuery.data?.items[0];

    if (latest) setActiveRunId(latest.id);
  }, [activeRunId, creating, selectedId, runsQuery.data]);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'params', label: t('tab.params') },
    { key: 'assets', label: t('tab.assets') },
    { key: 'correlation', label: t('tab.correlation') },
    { key: 'runs', label: t('tab.runs') },
    { key: 'result', label: t('tab.result') },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('description')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-auto text-sm"
            aria-label={t('suggestion.pick_portfolio')}
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) void applySuggestion(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="">{t('suggestion.pick_portfolio')}</option>
            {(portfoliosQuery.data?.items ?? []).map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </select>

          {/*
            「新建方案」刻意不弹窗：它切换的是本页的参数编辑模式，参数面板同时是
            保存后驱动图表重算的工作区，遮住它就等于遮住用户正在操作的对象。
          */}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
              setDraft(defaultBody());
              setActiveRunId(null);
              setTab('params');
              setError(null);
            }}
          >
            <Plus className="size-4" aria-hidden />
            {t('list.create')}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-sm text-rose-300" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="card h-fit p-2">
          {listQuery.isLoading ? (
            <LoadingState />
          ) : items.length === 0 ? (
            <p className="p-3 text-sm text-[var(--color-content-muted)]">{t('list.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setCreating(false);
                      setActiveRunId(item.latestRun?.id ?? null);
                      setTab('params');
                      setError(null);
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                      selectedId === item.id
                        ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                        : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{item.name}</span>
                      {item.latestRun && <StatusBadge status={item.latestRun.status} />}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--color-content-muted)]">
                      {t('list.meta', { years: item.years, paths: item.pathCount })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="min-w-0 space-y-4">
          {!draft ? (
            <div className="card">
              <EmptyState
                title={t('empty.title')}
                description={t('empty.description')}
                action={
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
                    onClick={() => {
                      setCreating(true);
                      setDraft(defaultBody());
                    }}
                  >
                    {t('list.create')}
                  </button>
                }
              />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {creating ? (
                  <input
                    className="input max-w-64"
                    placeholder={t('form.name')}
                    value={draft.name ?? ''}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                ) : (
                  <h2 className="text-base font-medium">{scenarioQuery.data?.name}</h2>
                )}

                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  disabled={saveMutation.isPending || (creating && !(draft.name ?? '').trim())}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? t('form.saving') : t('form.save')}
                </button>

                {!creating && selectedId && (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                      onClick={() => {
                        const name = window.prompt(t('list.duplicate_prompt'), t('list.duplicate_default'));
                        if (name?.trim()) duplicateMutation.mutate({ id: selectedId, name: name.trim() });
                      }}
                    >
                      <Copy className="size-4" aria-hidden />
                      {t('list.duplicate')}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-rose-400 hover:bg-rose-500/10"
                      onClick={() => {
                        if (window.confirm(t('list.delete_confirm'))) deleteMutation.mutate(selectedId);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      {t('list.delete')}
                    </button>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-1 border-b border-[var(--color-border-subtle)] pb-2">
                {tabs.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setTab(item.key)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      tab === item.key
                        ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                        : 'text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {tab === 'params' && (
                <ParamsTab draft={draft} onChange={setDraft} presets={presetsQuery.data?.presets ?? []} />
              )}

              {tab === 'assets' && (
                <div className="card p-4">
                  <AssetMatrixEditor
                    assets={draft.assets}
                    onChange={(assets) => setDraft({ ...draft, assets })}
                  />
                </div>
              )}

              {tab === 'correlation' && (
                <div className="card p-4">
                  <CorrelationEditor
                    assets={draft.assets}
                    correlation={draft.correlation}
                    onChange={(correlation) => setDraft({ ...draft, correlation })}
                  />
                </div>
              )}

              {tab === 'runs' && (
                <RunsTab
                  runs={runsQuery.data?.items ?? []}
                  run={run}
                  running={runMutation.isPending || cancelMutation.isPending}
                  presets={presetsQuery.data?.presets ?? []}
                  stressPreset={stressPreset}
                  onStressPresetChange={setStressPreset}
                  onRun={() => {
                    if (!selectedId) return;
                    if (creating) {
                      setError(t('run.save_first'));
                      return;
                    }
                    runMutation.mutate();
                  }}
                  onCancel={() => cancelMutation.mutate()}
                  onSelectRun={setActiveRunId}
                  activeRunId={activeRunId}
                  canRun={Boolean(selectedId) && !creating}
                />
              )}

              {tab === 'result' && (
                <ResultTab
                  isLoading={resultQuery.isLoading || runQuery.isLoading}
                  isError={resultQuery.isError}
                  run={run}
                  data={resultQuery.data}
                  currency={draft.currency ?? 'CNY'}
                  scenarioId={selectedId ?? ''}
                  runId={activeRunId ?? ''}
                  onRetry={() => {
                    void resultQuery.refetch();
                    void runQuery.refetch();
                  }}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function toBody(scenario: Scenario): ScenarioBody {
  return {
    name: scenario.name,
    currency: scenario.currency,
    years: scenario.years,
    pathCount: scenario.pathCount,
    rebalance: scenario.rebalance,
    assets: scenario.assets.map((asset) => ({
      key: asset.key,
      label: asset.label,
      weight: String(asset.weight),
      expectedAnnualReturn: String(asset.expectedAnnualReturn),
      annualVolatility: String(asset.annualVolatility),
    })),
    correlation: scenario.correlation,
    settings: {
      initialValue: String(scenario.settings.initialValue),
      contribution: {
        amount: String(scenario.settings.contribution.amount),
        frequency: scenario.settings.contribution.frequency,
        timing: scenario.settings.contribution.timing,
      },
      withdrawal: {
        amount: String(scenario.settings.withdrawal.amount),
        frequency: scenario.settings.withdrawal.frequency,
        startYear: scenario.settings.withdrawal.startYear,
      },
      inflationRate: String(scenario.settings.inflationRate),
      feeRate: String(scenario.settings.feeRate),
      targetAmount: scenario.settings.targetAmount === null ? null : String(scenario.settings.targetAmount),
    },
    note: scenario.note,
  };
}

function StatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation('monte-carlo');
  const tone: Record<RunStatus, string> = {
    queued: 'bg-slate-500/15 text-slate-300',
    running: 'bg-sky-500/15 text-sky-300',
    succeeded: 'bg-emerald-500/15 text-emerald-300',
    failed: 'bg-rose-500/15 text-rose-300',
    cancelled: 'bg-amber-500/15 text-amber-300',
  };

  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${tone[status]}`}>
      {t(`status.${status}`)}
    </span>
  );
}

function ParamsTab({
  draft,
  onChange,
  presets,
}: {
  draft: ScenarioBody;
  onChange: (draft: ScenarioBody) => void;
  presets: StressPreset[];
}) {
  const { t } = useTranslation('monte-carlo');

  const update = (patch: Partial<ScenarioBody>) => onChange({ ...draft, ...patch });
  const updateSettings = (patch: Partial<ScenarioBody['settings']>) =>
    onChange({ ...draft, settings: { ...draft.settings, ...patch } });

  return (
    <div className="card space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('form.years')}>
          <input
            type="number"
            min={1}
            max={50}
            className="input font-mono"
            value={draft.years}
            onChange={(event) => update({ years: Number(event.target.value) || 1 })}
          />
        </Field>

        <Field label={t('form.path_count')}>
          <input
            type="number"
            min={100}
            max={20000}
            step={100}
            className="input font-mono"
            value={draft.pathCount}
            onChange={(event) => update({ pathCount: Number(event.target.value) || 100 })}
          />
        </Field>

        <Field label={t('form.rebalance')}>
          <select
            className="input"
            value={draft.rebalance}
            onChange={(event) => update({ rebalance: event.target.value as ScenarioBody['rebalance'] })}
          >
            {(['none', 'monthly', 'quarterly', 'annual'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`rebalance.${value}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('form.initial')}>
          <input
            className="input font-mono"
            value={draft.settings.initialValue}
            onChange={(event) => updateSettings({ initialValue: event.target.value })}
          />
        </Field>

        <Field label={t('form.contribution')}>
          <input
            className="input font-mono"
            value={draft.settings.contribution.amount}
            onChange={(event) =>
              updateSettings({
                contribution: { ...draft.settings.contribution, amount: event.target.value },
              })
            }
          />
        </Field>

        <Field label={t('form.contribution_frequency')}>
          <select
            className="input"
            value={draft.settings.contribution.frequency}
            onChange={(event) =>
              updateSettings({
                contribution: {
                  ...draft.settings.contribution,
                  frequency: event.target.value as ScenarioBody['settings']['contribution']['frequency'],
                },
              })
            }
          >
            {(['none', 'monthly', 'annual'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`frequency.${value}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('form.timing')}>
          <select
            className="input"
            value={draft.settings.contribution.timing}
            onChange={(event) =>
              updateSettings({
                contribution: {
                  ...draft.settings.contribution,
                  timing: event.target.value as 'begin' | 'end',
                },
              })
            }
          >
            <option value="end">{t('timing.end')}</option>
            <option value="begin">{t('timing.begin')}</option>
          </select>
        </Field>

        <Field label={t('form.withdrawal')}>
          <input
            className="input font-mono"
            value={draft.settings.withdrawal.amount}
            onChange={(event) =>
              updateSettings({
                withdrawal: { ...draft.settings.withdrawal, amount: event.target.value },
              })
            }
          />
        </Field>

        <Field label={t('form.withdrawal_frequency')}>
          <select
            className="input"
            value={draft.settings.withdrawal.frequency}
            onChange={(event) =>
              updateSettings({
                withdrawal: {
                  ...draft.settings.withdrawal,
                  frequency: event.target.value as ScenarioBody['settings']['withdrawal']['frequency'],
                },
              })
            }
          >
            {(['none', 'monthly', 'annual'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`frequency.${value}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('form.withdrawal_start')}>
          <input
            type="number"
            min={1}
            max={draft.years}
            className="input font-mono"
            value={draft.settings.withdrawal.startYear}
            onChange={(event) =>
              updateSettings({
                withdrawal: {
                  ...draft.settings.withdrawal,
                  startYear: Number(event.target.value) || 1,
                },
              })
            }
          />
        </Field>

        <Field label={t('form.inflation')}>
          <input
            className="input font-mono"
            value={draft.settings.inflationRate}
            onChange={(event) => updateSettings({ inflationRate: event.target.value })}
          />
        </Field>

        <Field label={t('form.fee')}>
          <input
            className="input font-mono"
            value={draft.settings.feeRate}
            onChange={(event) => updateSettings({ feeRate: event.target.value })}
          />
        </Field>

        <Field label={t('form.target')}>
          <input
            className="input font-mono"
            placeholder={t('form.target_placeholder')}
            value={draft.settings.targetAmount ?? ''}
            onChange={(event) =>
              updateSettings({ targetAmount: event.target.value.trim() || null })
            }
          />
        </Field>
      </div>

      <p className="text-[11px] text-[var(--color-content-muted)]">
        {t('form.ratio_hint')}
      </p>

      {presets.length > 0 && (
        <div className="border-t border-[var(--color-border-subtle)] pt-3">
          <p className="text-xs text-[var(--color-content-muted)]">{t('stress.hint')}</p>
          <ul className="mt-2 space-y-1 text-[11px] text-[var(--color-content-muted)]">
            {presets.map((preset) => (
              <li key={preset.key}>
                · <span className="text-[var(--color-content)]">{t(preset.labelKey)}</span>：{t(preset.descriptionKey)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--color-content-muted)]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function RunsTab({
  runs,
  run,
  running,
  presets,
  stressPreset,
  onStressPresetChange,
  onRun,
  onCancel,
  onSelectRun,
  activeRunId,
  canRun,
}: {
  runs: RunSummary[];
  run: RunDetail | null;
  running: boolean;
  presets: StressPreset[];
  stressPreset: StressPresetKey | '';
  onStressPresetChange: (value: StressPresetKey | '') => void;
  onRun: () => void;
  onCancel: () => void;
  onSelectRun: (runId: string) => void;
  activeRunId: string | null;
  canRun: boolean;
}) {
  const { t } = useTranslation('monte-carlo');

  const inProgress = run && (run.status === 'queued' || run.status === 'running');

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={!canRun || running}
          onClick={onRun}
        >
          <Play className="size-4" aria-hidden />
          {t('run.start')}
        </button>

        <select
          className="input w-auto text-sm"
          value={stressPreset}
          onChange={(event) => onStressPresetChange(event.target.value as StressPresetKey | '')}
        >
          <option value="">{t('stress.none')}</option>
          {presets.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {t(preset.labelKey)}
            </option>
          ))}
        </select>

        {inProgress && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
            disabled={running}
            onClick={onCancel}
          >
            <Ban className="size-4" aria-hidden />
            {t('run.cancel')}
          </button>
        )}
      </div>

      {run && inProgress && (
        <div className="card space-y-2 p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--color-content-muted)]">
              {run.status === 'queued'
                ? t('run.queued_position', { position: run.queuePosition + 1 })
                : t(`stage.${run.stage ?? 'preparing'}`)}
            </span>
            <span className="font-mono">{(Number(run.progress) * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border-subtle)]">
            <div
              className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
              style={{ width: `${Math.max(2, Number(run.progress) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {run?.status === 'failed' && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          {t('run.failed_hint', { code: run.failureCode ?? '' })}
          {run.failureMessage ? ` · ${run.failureMessage}` : ''}
        </p>
      )}

      {run?.status === 'cancelled' && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          {t('run.cancelled_hint')}
        </p>
      )}

      <div className="card overflow-hidden">
        {runs.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-content-muted)]">{t('run.empty')}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {runs.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectRun(item.id)}
                  className={`flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs hover:bg-black/5 dark:hover:bg-white/5 ${
                    activeRunId === item.id ? 'bg-[var(--color-accent)]/10' : ''
                  }`}
                >
                  <StatusBadge status={item.status} />
                  <span className="font-mono text-[var(--color-content-muted)]">
                    {formatDateTime(item.createdAt)}
                  </span>
                  {item.seed !== undefined && (
                    <span className="font-mono text-[var(--color-content-muted)]">
                      {t('run.seed', { seed: item.seed })}
                    </span>
                  )}
                  {item.pathCount !== undefined && (
                    <span className="font-mono text-[var(--color-content-muted)]">
                      {t('run.paths', { count: item.pathCount })}
                    </span>
                  )}
                  {item.years !== undefined && (
                    <span className="font-mono text-[var(--color-content-muted)]">
                      {t('run.years', { years: item.years })}
                    </span>
                  )}
                  {item.durationMs != null && (
                    <span className="ml-auto font-mono text-[var(--color-content-muted)]">
                      {t('run.duration', { ms: item.durationMs })}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResultTab({
  isLoading,
  isError,
  run,
  data,
  currency,
  scenarioId,
  runId,
  onRetry,
}: {
  isLoading: boolean;
  isError: boolean;
  run: RunDetail | null;
  data?: { result: import('@/lib/monte-carlo').SimulationResult; assumptions: import('@/lib/monte-carlo').Assumptions };
  currency: string;
  scenarioId: string;
  runId: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation('monte-carlo');
  const [showSamplePaths, setShowSamplePaths] = useState(false);

  if (isLoading) return <LoadingState />;

  if (isError || !data) {
    if (run && (run.status === 'queued' || run.status === 'running')) {
      return (
        <div className="card flex items-center gap-2 p-4 text-sm text-[var(--color-content-muted)]">
          <RefreshCw className="size-4 animate-spin" aria-hidden />
          {t('result.waiting')}
        </div>
      );
    }

    if (run && ['failed', 'cancelled'].includes(run.status)) {
      return (
        <div className="card p-4">
          <ErrorState
            message={`${t('result.unavailable')} · ${run.failureMessage ?? t('result.unavailable_hint')}`}
            onRetry={onRetry}
          />
        </div>
      );
    }

    return (
      <div className="card p-4">
        <EmptyState
          title={t('result.no_run')}
          description={t('result.no_run_hint')}
          action={
            <button
              type="button"
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
              onClick={onRetry}
            >
              {t('result.refresh')}
            </button>
          }
        />
      </div>
    );
  }

  const { result, assumptions } = data;

  return (
    <div className="space-y-4">
      <MetricCards result={result} currency={currency} />

      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('chart.fan_title')}</h3>
          <label className="flex items-center gap-1.5 text-xs text-[var(--color-content-muted)]">
            <input
              type="checkbox"
              checked={showSamplePaths}
              onChange={(event) => setShowSamplePaths(event.target.checked)}
            />
            {t('chart.show_samples')}
          </label>
        </div>
        <FanChartContainer
          scenarioId={scenarioId}
          runId={runId}
          result={result}
          currency={currency}
          showSamples={showSamplePaths}
        />
      </div>

      <div className="card p-4">
        <h3 className="mb-2 text-sm font-medium">{t('chart.histogram_title')}</h3>
        <TerminalHistogram histogram={result.histogram} currency={currency} />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-medium">{t('drawdown.title')}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            ['p50', result.drawdown.p50],
            ['p90', result.drawdown.p90],
            ['p99', result.drawdown.p99],
            ['mean', result.drawdown.mean],
          ] as const).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs text-[var(--color-content-muted)]">{t(`drawdown.${key}`)}</p>
              <p className="font-mono text-sm">{(Number(value) * 100).toFixed(1)}%</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-content-muted)]">{t('drawdown.note')}</p>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-medium">{t('notice.title')}</h3>
        <AssumptionNotice result={result} assumptions={assumptions} currency={currency} />
      </div>
    </div>
  );
}

function FanChartContainer({
  scenarioId,
  runId,
  result,
  currency,
  showSamples,
}: {
  scenarioId: string;
  runId: string;
  result: import('@/lib/monte-carlo').SimulationResult;
  currency: string;
  showSamples: boolean;
}) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // 样本路径由后端按索引再生成，前端不持有全量路径；只在勾选时请求
  const sampleQuery = useQuery({
    queryKey: ['monte-carlo', 'paths', scenarioId, runId],
    queryFn: () => monteCarloApi.getPaths(scenarioId, runId, { count: 10, resolution: 'yearly' }),
    enabled: showSamples,
  });

  const samplePaths = useMemo(() => {
    if (!showSamples) return [];
    return sampleQuery.data?.paths ?? [];
  }, [showSamples, sampleQuery.data]);

  return <FanChart bands={result.yearlyBands} currency={currency} samplePaths={samplePaths} compact={compact} />;
}
