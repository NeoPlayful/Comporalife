import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import FinancialIndependencePanel from '@/components/goals/FinancialIndependencePanel';
import GoalForm from '@/components/goals/GoalForm';
import GoalHistoryChart from '@/components/goals/GoalHistoryChart';
import GoalProgressRing from '@/components/goals/GoalProgressRing';
import GoalProjectionCards from '@/components/goals/GoalProjectionCards';
import { translateError } from '@/lib/error-message';
import { formatDate, formatNumber } from '@/lib/format';
import {
  financialIndependenceApi,
  goalsApi,
  type GoalInput,
  type GoalListItem,
  type GoalStatus,
} from '@/lib/goals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Tab = 'goals' | 'fi';

const STATUS_FILTERS: Array<GoalStatus | 'all'> = ['all', 'active', 'achieved', 'archived'];

export default function GoalsPage() {
  const { t } = useTranslation('goals');
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('goals');
  const [statusFilter, setStatusFilter] = useState<GoalStatus | 'all'>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState<string | undefined>(undefined);

  const listQuery = useQuery({
    queryKey: ['goals', statusFilter],
    queryFn: () => goalsApi.list(statusFilter === 'all' ? {} : { status: statusFilter }),
    retry: false,
  });

  const summaryQuery = useQuery({ queryKey: ['goals', 'summary'], queryFn: () => goalsApi.summary() });

  // 进入页面时自动挂到第一个目标，避免右侧永远空白
  useEffect(() => {
    if (selectedId || creating || !listQuery.data) return;
    const first = listQuery.data.goals[0];
    if (first) setSelectedId(first.id);
  }, [creating, listQuery.data, selectedId]);

  const detailQuery = useQuery({
    queryKey: ['goals', 'detail', selectedId],
    queryFn: () => goalsApi.detail(selectedId!),
    enabled: Boolean(selectedId) && !creating,
  });

  const historyQuery = useQuery({
    queryKey: ['goals', 'history', selectedId],
    queryFn: () => goalsApi.history(selectedId!),
    enabled: Boolean(selectedId) && !creating,
  });

  const projectionQuery = useQuery({
    queryKey: ['goals', 'projection', selectedId],
    queryFn: () => goalsApi.projection(selectedId!, { includeProbabilistic: true }),
    enabled: Boolean(selectedId) && !creating,
    retry: false,
  });

  const fiQuery = useQuery({
    queryKey: ['fi', rate],
    queryFn: () =>
      rate ? financialIndependenceApi.calculate({ withdrawalRate: rate }) : financialIndependenceApi.overview(),
    enabled: tab === 'fi',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals'] });
    void queryClient.invalidateQueries({ queryKey: ['fi'] });
  };

  const createMutation = useMutation({
    mutationFn: (body: GoalInput) => goalsApi.create(body),
    onSuccess: (result) => {
      setCreating(false);
      setError(null);
      setSelectedId(result.id);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const updateMutation = useMutation({
    mutationFn: (body: GoalInput) => goalsApi.update(selectedId!, body),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => goalsApi.update(id, { status: 'archived' }),
    onSuccess: () => invalidate(),
    onError: (err) => setError(translateError(err, t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => goalsApi.remove(id),
    onSuccess: () => {
      setSelectedId(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const currency = summaryQuery.data?.currency ?? detailQuery.data?.goal.currency ?? 'CNY';
  const money = (value: string | null | undefined) =>
    value == null ? '—' : `${formatNumber(value, { maximumFractionDigits: 2 })} ${currency}`;

  const detail = detailQuery.data;
  const projection = projectionQuery.data;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
        </div>

        <div className="flex gap-1 rounded-lg border border-[var(--color-border-subtle)] p-1 text-sm">
          <button
            type="button"
            onClick={() => setTab('goals')}
            className={`rounded-md px-3 py-1.5 ${tab === 'goals' ? 'bg-[var(--color-accent)] text-white' : ''}`}
          >
            {t('tabs.goals')}
          </button>
          <button
            type="button"
            onClick={() => setTab('fi')}
            className={`rounded-md px-3 py-1.5 ${tab === 'fi' ? 'bg-[var(--color-accent)] text-white' : ''}`}
          >
            {t('tabs.fi')}
          </button>
        </div>
      </header>

      {tab === 'fi' ? (
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">{t('fi.title')}</h2>
          <p className="mb-4 text-xs text-[var(--color-content-muted)]">{t('fi.subtitle')}</p>

          {fiQuery.isLoading && <LoadingState />}
          {fiQuery.isError && (
            <ErrorState message={translateError(fiQuery.error, t)} onRetry={() => void fiQuery.refetch()} />
          )}
          {fiQuery.data && (
            <FinancialIndependencePanel
              data={fiQuery.data}
              currency={currency}
              onRateChange={(next) => setRate(next)}
              onScaleChange={() => undefined}
            />
          )}
        </section>
      ) : (
        <>
          <SummaryCards
            data={summaryQuery.data}
            currency={currency}
            labels={{
              target: t('summary.total_target'),
              current: t('summary.total_current'),
              gap: t('summary.total_gap'),
              required: t('summary.required_monthly'),
              surplus: t('summary.investable_surplus'),
              shortfall: t('summary.shortfall'),
              noSurplus: t('summary.no_surplus'),
            }}
          />

          <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
            <aside className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {STATUS_FILTERS.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      statusFilter === status
                        ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                        : 'border-[var(--color-border-subtle)] text-[var(--color-content-muted)]'
                    }`}
                  >
                    {t(`status.${status}`)}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setEditing(false);
                  setSelectedId(null);
                  setError(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
              >
                <Plus className="size-4" aria-hidden />
                {t('actions.create')}
              </button>

              {listQuery.isLoading && <LoadingState />}
              {listQuery.isError && (
                <ErrorState message={translateError(listQuery.error, t)} onRetry={() => void listQuery.refetch()} />
              )}

              {listQuery.data?.goals.length === 0 && !creating && (
                <EmptyState title={t('empty.title')} description={t('empty.description')} />
              )}

              <ul className="space-y-2">
                {(listQuery.data?.goals ?? []).map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    active={goal.id === selectedId}
                    currency={currency}
                    onSelect={() => {
                      setSelectedId(goal.id);
                      setCreating(false);
                      setEditing(false);
                      setError(null);
                    }}
                  />
                ))}
              </ul>
            </aside>

            <section className="space-y-4">
              {creating && (
                <div>
                  <h2 className="mb-2 text-sm font-semibold">{t('actions.create')}</h2>
                  <GoalForm
                    onSubmit={(body) => createMutation.mutate(body)}
                    onCancel={() => {
                      setCreating(false);
                      setError(null);
                    }}
                    submitting={createMutation.isPending}
                    error={error}
                  />
                </div>
              )}

              {!creating && !detail && <EmptyState title={t('detail.empty')} />}

              {!creating && detail && (
                <>
                  <div className="card space-y-4 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <GoalProgressRing
                          progress={detail.progress.progress === null ? null : Number(detail.progress.progress)}
                          size={72}
                        />
                        <div>
                          <h2 className="text-lg font-semibold">{detail.goal.name}</h2>
                          <p className="text-xs text-[var(--color-content-muted)]">
                            {t(`enums:goal_type.${detail.goal.type}`, { defaultValue: detail.goal.type })}
                            {' · '}
                            {t(`status.${detail.goal.status}`)}
                          </p>

                          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                            <dt className="text-[var(--color-content-muted)]">{t('detail.current')}</dt>
                            <dd className="tabular-nums">{money(detail.progress.currentAmount)}</dd>
                            <dt className="text-[var(--color-content-muted)]">{t('detail.target')}</dt>
                            <dd className="tabular-nums">{money(detail.progress.targetAmount)}</dd>
                            <dt className="text-[var(--color-content-muted)]">{t('detail.gap')}</dt>
                            <dd className="tabular-nums">{money(detail.progress.gap)}</dd>
                          </dl>

                          {detail.progress.targetAmount !== detail.progress.originalTargetAmount && (
                            <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                              {t('detail.inflation_note', {
                                original: formatNumber(detail.progress.originalTargetAmount, {
                                  maximumFractionDigits: 2,
                                }),
                                currency,
                              })}
                            </p>
                          )}

                          {!detail.progress.funding.available && (
                            <p className="mt-2 rounded-lg bg-[var(--color-negative)]/10 px-2 py-1 text-xs text-[var(--color-negative)]">
                              {t('detail.funding_unavailable', {
                                reason: t(`funding_reason.${detail.progress.funding.unavailableReason}`, {
                                  defaultValue: detail.progress.funding.unavailableReason ?? '',
                                }),
                              })}
                            </p>
                          )}

                          {detail.progress.achievedAt && (
                            <p className="mt-1 text-xs text-[var(--color-positive)]">
                              {t('detail.achieved_at', { date: formatDate(detail.progress.achievedAt) })}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing((value) => !value);
                            setError(null);
                          }}
                          className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          {t('actions.edit')}
                        </button>
                        {detail.goal.status !== 'archived' && (
                          <button
                            type="button"
                            onClick={() => archiveMutation.mutate(detail.goal.id)}
                            className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs"
                          >
                            <Archive className="size-3.5" aria-hidden />
                            {t('actions.archive')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(t('actions.delete_confirm'))) deleteMutation.mutate(detail.goal.id);
                          }}
                          className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--color-negative)]"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          {t('actions.delete')}
                        </button>
                      </div>
                    </div>

                    {editing && (
                      <GoalForm
                        initial={{ ...detail.goal, targetAmount: detail.progress.originalTargetAmount }}
                        onSubmit={(body) => updateMutation.mutate(body)}
                        onCancel={() => {
                          setEditing(false);
                          setError(null);
                        }}
                        submitting={updateMutation.isPending}
                        error={error}
                      />
                    )}
                  </div>

                  <div className="card p-4">
                    <h3 className="mb-2 text-sm font-semibold">{t('detail.history')}</h3>
                    {historyQuery.isLoading && <LoadingState />}
                    {historyQuery.data && (
                      <>
                        <GoalHistoryChart
                          points={historyQuery.data.points}
                          currency={currency}
                          targetAmount={detail.progress.targetAmount}
                        />
                        <p className="mt-2 text-xs text-[var(--color-content-muted)]">{t('detail.granularity_note')}</p>
                      </>
                    )}
                  </div>

                  <div className="card p-4">
                    <h3 className="mb-3 text-sm font-semibold">{t('detail.prediction')}</h3>
                    {projectionQuery.isLoading && <LoadingState />}
                    {projectionQuery.isError && (
                      <ErrorState
                        message={translateError(projectionQuery.error, t)}
                        onRetry={() => void projectionQuery.refetch()}
                      />
                    )}
                    {projection && <GoalProjectionCards projection={projection} currency={currency} />}
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  active,
  currency,
  onSelect,
}: {
  goal: GoalListItem;
  active: boolean;
  currency: string;
  onSelect: () => void;
}) {
  const { t } = useTranslation('goals');

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
          active
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
            : 'border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        <GoalProgressRing progress={goal.progress === null ? null : Number(goal.progress)} size={44} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{goal.name}</p>
          <p className="truncate text-xs text-[var(--color-content-muted)]">
            {goal.currentAmount
              ? `${formatNumber(goal.currentAmount, { maximumFractionDigits: 0 })} / ${formatNumber(
                  goal.targetAmount,
                  { maximumFractionDigits: 0 },
                )} ${currency}`
              : t('card.funding_unavailable')}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
            goal.status === 'achieved'
              ? 'bg-[var(--color-positive)]/15 text-[var(--color-positive)]'
              : goal.status === 'archived'
                ? 'bg-[var(--color-border-subtle)] text-[var(--color-content-muted)]'
                : 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
          }`}
        >
          {t(`status.${goal.status}`)}
        </span>
      </button>
    </li>
  );
}

function SummaryCards({
  data,
  currency,
  labels,
}: {
  data?: {
    totalTarget: string;
    totalCurrent: string;
    totalGap: string;
    requiredMonthlyTotal: string;
    investableSurplus: string | null;
    shortfall: string | null;
  };
  currency: string;
  labels: Record<string, string>;
}) {
  const money = (value: string | null | undefined) =>
    value == null ? '—' : `${formatNumber(value, { maximumFractionDigits: 2 })} ${currency}`;

  const shortfallPositive = data?.shortfall ? Number(data.shortfall) > 0 : false;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card label={labels.target!} value={money(data?.totalTarget)} />
      <Card label={labels.current!} value={money(data?.totalCurrent)} />
      <Card label={labels.gap!} value={money(data?.totalGap)} />
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-3">
        <p className="text-xs text-[var(--color-content-muted)]">{labels.required}</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{money(data?.requiredMonthlyTotal)}</p>
        <p className="mt-1 text-xs text-[var(--color-content-muted)]">
          {data?.investableSurplus === null
            ? labels.noSurplus
            : `${labels.surplus} ${money(data?.investableSurplus)}`}
        </p>
        {data?.shortfall !== null && data?.shortfall !== undefined && (
          <p
            className={`mt-0.5 text-xs tabular-nums ${
              shortfallPositive ? 'text-[var(--color-negative)]' : 'text-[var(--color-positive)]'
            }`}
          >
            {labels.shortfall} {money(data.shortfall)}
          </p>
        )}
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)] p-3">
      <p className="text-xs text-[var(--color-content-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
