import CategoryPieChart from '@/components/analytics/CategoryPieChart';
import CoverageNotice from '@/components/analytics/CoverageNotice';
import MerchantBarChart from '@/components/analytics/MerchantBarChart';
import TrendComparisonChart from '@/components/analytics/TrendComparisonChart';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { analyticsApi } from '@/lib/analytics';
import { useEnumLabels } from '@/lib/enum-labels';
import { formatDate, formatNumber } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { endOfMonth, endOfQuarter, endOfYear, format, startOfMonth, startOfQuarter, startOfYear, subMonths } from 'date-fns';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type RangePreset = 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom';
type TabKey = 'categories' | 'merchants' | 'trend' | 'recurring' | 'large' | 'accounts';

interface Range {
  from: string;
  to: string;
}

const day = (date: Date) => format(date, 'yyyy-MM-dd');

function presetRange(preset: Exclude<RangePreset, 'custom'>, now: Date): Range {
  switch (preset) {
    case 'last_month': {
      const last = subMonths(now, 1);
      return { from: day(startOfMonth(last)), to: day(endOfMonth(last)) };
    }
    case 'this_quarter':
      return { from: day(startOfQuarter(now)), to: day(endOfQuarter(now)) };
    case 'this_year':
      return { from: day(startOfYear(now)), to: day(endOfYear(now)) };
    default:
      return { from: day(startOfMonth(now)), to: day(endOfMonth(now)) };
  }
}

function formatPercent(value: string | null): string {
  if (value === null) return '—';
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function changeLabel(value: string | null | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (value === null || value === undefined) return t('metrics.change_na');
  const numeric = Number(value);
  if (Math.abs(numeric) < 0.00005) return t('metrics.change_flat');
  return numeric > 0
    ? t('metrics.change_up', { value: (numeric * 100).toFixed(1) })
    : t('metrics.change_down', { value: Math.abs(numeric * 100).toFixed(1) });
}

export default function AnalyticsPage() {
  const { t } = useTranslation('analytics');
  const { accountType } = useEnumLabels();
  const now = useMemo(() => new Date(), []);

  const [preset, setPreset] = useState<RangePreset>('this_month');
  const [range, setRange] = useState<Range>(() => presetRange('this_month', now));
  const [draft, setDraft] = useState<Range>(range);
  const [level, setLevel] = useState<1 | 2>(1);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [tab, setTab] = useState<TabKey>('categories');

  const summaryQuery = useQuery({
    queryKey: ['analytics', 'summary', range],
    queryFn: () => analyticsApi.incomeExpense(range),
  });

  const comparisonQuery = useQuery({
    queryKey: ['analytics', 'comparison', range],
    queryFn: () => analyticsApi.periodComparison({ ...range, mode: 'custom' }),
  });

  const categoriesQuery = useQuery({
    queryKey: ['analytics', 'categories', range, level, kind],
    queryFn: () => analyticsApi.categories({ ...range, level, kind, previous: true }),
    enabled: tab === 'categories',
  });

  const merchantsQuery = useQuery({
    queryKey: ['analytics', 'merchants', range],
    queryFn: () => analyticsApi.merchants({ ...range, limit: 20 }),
    enabled: tab === 'merchants',
  });

  const trendQuery = useQuery({
    queryKey: ['analytics', 'trend', range],
    queryFn: () => analyticsApi.cashflowTrend(range),
    enabled: tab === 'trend',
  });

  const recurringQuery = useQuery({
    queryKey: ['analytics', 'recurring'],
    queryFn: () => analyticsApi.recurring({ lookbackMonths: 12 }),
    enabled: tab === 'recurring',
  });

  const fixedVariableQuery = useQuery({
    queryKey: ['analytics', 'fixed-variable', range],
    queryFn: () => analyticsApi.fixedVariable(range),
    enabled: tab === 'recurring',
  });

  const largeQuery = useQuery({
    queryKey: ['analytics', 'large', range],
    queryFn: () => analyticsApi.largeExpenses({ ...range, limit: 50 }),
    enabled: tab === 'large',
  });

  const accountsQuery = useQuery({
    queryKey: ['analytics', 'accounts', range],
    queryFn: () => analyticsApi.accounts(range),
    enabled: tab === 'accounts',
  });

  function applyPreset(next: RangePreset) {
    setPreset(next);
    if (next === 'custom') return;
    const nextRange = presetRange(next, now);
    setRange(nextRange);
    setDraft(nextRange);
  }

  if (summaryQuery.isLoading) return <LoadingState />;

  if (summaryQuery.isError) {
    return <ErrorState message={t('load_failed')} onRetry={() => summaryQuery.refetch()} />;
  }

  const summary = summaryQuery.data!;
  const currency = summary.basis.baseCurrency;
  const comparison = comparisonQuery.data;

  const isEmpty =
    Number(summary.income) === 0 && Number(summary.expense) === 0 && summary.transactionCounts.income === 0;

  const metricCards = [
    { key: 'income', value: summary.income, tone: 'positive' as const, change: comparison?.changes.income },
    { key: 'expense', value: summary.expense, tone: 'negative' as const, change: comparison?.changes.expense },
    { key: 'net', value: summary.net, tone: 'neutral' as const, change: comparison?.changes.net },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('description')}</p>
        </div>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['this_month', 'last_month', 'this_quarter', 'this_year', 'custom'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => applyPreset(item)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                preset === item
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-black/5 text-[var(--color-content-muted)] hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10'
              }`}
            >
              {t(`range.${item}`)}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label={t('range.from')}
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1 text-sm"
              />
              <span className="text-sm text-[var(--color-content-muted)]">—</span>
              <input
                type="date"
                aria-label={t('range.to')}
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => setRange(draft)}
                className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white"
              >
                {t('range.apply')}
              </button>
            </div>
          )}
        </div>
      </section>

      {isEmpty ? (
        <div className="card">
          <EmptyState title={t('empty_title')} description={t('empty_description')} />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metricCards.map((card) => (
              <div key={card.key} className="card">
                <p className="text-xs text-[var(--color-content-muted)]">{t(`metrics.${card.key}`)}</p>
                <p
                  className={`mt-1 text-xl font-semibold tabular-nums ${
                    card.tone === 'positive'
                      ? 'text-[var(--color-positive)]'
                      : card.tone === 'negative'
                        ? 'text-[var(--color-negative)]'
                        : ''
                  }`}
                >
                  {formatNumber(card.value)} {currency}
                </p>
                <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                  {changeLabel(card.change, t)}
                </p>
              </div>
            ))}
            <div className="card">
              <p className="text-xs text-[var(--color-content-muted)]">{t('metrics.savings_rate')}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {summary.savingsRate === null ? '—' : `${(Number(summary.savingsRate) * 100).toFixed(1)}%`}
              </p>
              <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                {summary.savingsRate === null
                  ? t('metrics.savings_rate_na')
                  : t('metrics.investable', {})}
              </p>
            </div>
          </div>

          <CoverageNotice coverage={summary.coverage} />

          <div className="flex flex-wrap gap-2 border-b border-[var(--color-border-subtle)]">
            {(['categories', 'merchants', 'trend', 'recurring', 'large', 'accounts'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                  tab === item
                    ? 'border-[var(--color-accent)] text-[var(--color-content)]'
                    : 'border-transparent text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
                }`}
              >
                {t(`tabs.${item}`)}
              </button>
            ))}
          </div>

          {tab === 'categories' && (
            <section className="card space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-base font-medium">{t('categories.title')}</h2>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label={t('categories.kind_expense')}
                    value={kind}
                    onChange={(event) => setKind(event.target.value as 'expense' | 'income')}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1 text-sm"
                  >
                    <option value="expense">{t('categories.kind_expense')}</option>
                    <option value="income">{t('categories.kind_income')}</option>
                  </select>
                  <select
                    aria-label={t('categories.level')}
                    value={level}
                    onChange={(event) => setLevel(Number(event.target.value) === 2 ? 2 : 1)}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1 text-sm"
                  >
                    <option value={1}>{t('categories.level_1')}</option>
                    <option value={2}>{t('categories.level_2')}</option>
                  </select>
                </div>
              </div>

              {categoriesQuery.isLoading ? (
                <LoadingState />
              ) : categoriesQuery.isError ? (
                <ErrorState message={t('load_failed')} onRetry={() => categoriesQuery.refetch()} />
              ) : categoriesQuery.data!.items.length === 0 ? (
                <EmptyState title={t('categories.empty')} />
              ) : (
                <>
                  <CategoryPieChart items={categoriesQuery.data!.items} currency={currency} />
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-[var(--color-content-muted)]">
                        <tr>
                          <th className="py-2 pr-3 font-medium">{t('categories.name')}</th>
                          <th className="py-2 pr-3 text-right font-medium">{t('categories.amount')}</th>
                          <th className="py-2 pr-3 text-right font-medium">{t('categories.ratio')}</th>
                          <th className="py-2 pr-3 text-right font-medium">{t('categories.count')}</th>
                          <th className="py-2 pr-3 text-right font-medium">{t('categories.change')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categoriesQuery.data!.items.map((item) => (
                          <tr key={item.categoryId} className="border-t border-[var(--color-border-subtle)]">
                            <td className="py-2 pr-3">{item.name}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {formatNumber(item.amount)} {currency}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{formatPercent(item.ratio)}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{item.count}</td>
                            <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-content-muted)]">
                              {item.changeRatio === null
                                ? '—'
                                : `${Number(item.changeRatio) >= 0 ? '+' : ''}${(Number(item.changeRatio) * 100).toFixed(1)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-[var(--color-border-subtle)] font-medium">
                          <td className="py-2 pr-3">{t('categories.total')}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatNumber(categoriesQuery.data!.total)} {currency}
                          </td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'merchants' && (
            <section className="card space-y-3">
              <h2 className="text-base font-medium">{t('merchants.title')}</h2>
              {merchantsQuery.isLoading ? (
                <LoadingState />
              ) : merchantsQuery.isError ? (
                <ErrorState message={t('load_failed')} onRetry={() => merchantsQuery.refetch()} />
              ) : (
                <>
                  <MerchantBarChart items={merchantsQuery.data!.items} currency={currency} />
                  {merchantsQuery.data!.unattributed.count > 0 && (
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {t('merchants.unattributed', {
                        amount: formatNumber(merchantsQuery.data!.unattributed.amount),
                        count: merchantsQuery.data!.unattributed.count,
                      })}
                      {' · '}
                      {t('merchants.unattributed_hint')}
                    </p>
                  )}
                  {merchantsQuery.data!.items.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs text-[var(--color-content-muted)]">
                          <tr>
                            <th className="py-2 pr-3 font-medium">{t('merchants.name')}</th>
                            <th className="py-2 pr-3 text-right font-medium">{t('merchants.amount')}</th>
                            <th className="py-2 pr-3 text-right font-medium">{t('merchants.count')}</th>
                            <th className="py-2 pr-3 font-medium">{t('merchants.top_category')}</th>
                            <th className="py-2 pr-3 font-medium">{t('merchants.last')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {merchantsQuery.data!.items.map((item) => (
                            <tr key={item.merchant} className="border-t border-[var(--color-border-subtle)]">
                              <td className="py-2 pr-3">{item.merchant}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {formatNumber(item.amount)} {currency}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">{item.count}</td>
                              <td className="py-2 pr-3 text-[var(--color-content-muted)]">
                                {item.topCategoryName ?? '—'}
                              </td>
                              <td className="py-2 pr-3 text-[var(--color-content-muted)]">
                                {formatDate(item.lastOccurredAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {tab === 'trend' && (
            <section className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-medium">{t('trend.title')}</h2>
                {trendQuery.data && (
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {t(`trend.${trendQuery.data.granularity}`)}
                    {trendQuery.data.downgraded &&
                      ` · ${t('trend.downgraded', { granularity: t(`trend.${trendQuery.data.granularity}`) })}`}
                  </p>
                )}
              </div>
              {trendQuery.isLoading ? (
                <LoadingState />
              ) : trendQuery.isError ? (
                <ErrorState message={t('load_failed')} onRetry={() => trendQuery.refetch()} />
              ) : (
                <TrendComparisonChart points={trendQuery.data!.points} currency={currency} />
              )}
            </section>
          )}

          {tab === 'recurring' && (
            <section className="card space-y-4">
              <h2 className="text-base font-medium">{t('recurring.title')}</h2>
              {recurringQuery.isLoading || fixedVariableQuery.isLoading ? (
                <LoadingState />
              ) : recurringQuery.isError || fixedVariableQuery.isError ? (
                <ErrorState message={t('load_failed')} onRetry={() => recurringQuery.refetch()} />
              ) : (
                <>
                  {fixedVariableQuery.data && fixedVariableQuery.data.total !== '0.000000' && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t('recurring.fixed_variable')}</p>
                      <div className="flex h-3 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                        <div
                          className="bg-[#5b8def]"
                          style={{ width: `${Math.min(Number(fixedVariableQuery.data.fixed.ratio ?? 0) * 100, 100)}%` }}
                        />
                        <div
                          className="bg-[#4ea87c]"
                          style={{ width: `${Math.min(Number(fixedVariableQuery.data.variable.ratio ?? 0) * 100, 100)}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap gap-4 text-xs text-[var(--color-content-muted)]">
                        <span>
                          {t('recurring.fixed')}：{formatNumber(fixedVariableQuery.data.fixed.amount)} {currency}
                          （{formatPercent(fixedVariableQuery.data.fixed.ratio)}）
                        </span>
                        <span>
                          {t('recurring.variable')}：{formatNumber(fixedVariableQuery.data.variable.amount)} {currency}
                          （{formatPercent(fixedVariableQuery.data.variable.ratio)}）
                        </span>
                      </div>
                    </div>
                  )}

                  {recurringQuery.data!.items.length === 0 ? (
                    <EmptyState
                      title={t('recurring.empty')}
                      description={t('recurring.empty_hint')}
                    />
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {recurringQuery.data!.items.map((item) => (
                        <div
                          key={item.key}
                          className="rounded-lg border border-[var(--color-border-subtle)] p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 truncate font-medium">{item.label}</p>
                            <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs text-[var(--color-content-muted)] dark:bg-white/10">
                              {t(`recurring.${item.frequency}`)}
                            </span>
                          </div>
                          <p className="mt-1 text-lg font-semibold tabular-nums">
                            {formatNumber(item.amount)} {currency}
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                            {t('recurring.occurrences', { count: item.occurrences })} ·{' '}
                            {t('recurring.next')}：{formatDate(item.nextExpectedDate)}
                          </p>
                          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                            {t('recurring.account')}：{item.accountName} ·{' '}
                            {t('recurring.confidence', { value: (Number(item.confidence) * 100).toFixed(0) })}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {tab === 'large' && (
            <section className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-medium">{t('large.title')}</h2>
                {largeQuery.data && (
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {t('large.threshold')}：{formatNumber(largeQuery.data.threshold)} {currency}
                    {' · '}
                    {t(`large.threshold_${largeQuery.data.thresholdSource === 'median_multiple' ? 'median' : largeQuery.data.thresholdSource}`)}
                  </p>
                )}
              </div>
              {largeQuery.isLoading ? (
                <LoadingState />
              ) : largeQuery.isError ? (
                <ErrorState message={t('load_failed')} onRetry={() => largeQuery.refetch()} />
              ) : largeQuery.data!.items.length === 0 ? (
                <EmptyState title={t('large.empty')} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-[var(--color-content-muted)]">
                      <tr>
                        <th className="py-2 pr-3 font-medium">{t('large.date')}</th>
                        <th className="py-2 pr-3 font-medium">{t('large.description')}</th>
                        <th className="py-2 pr-3 font-medium">{t('large.merchant')}</th>
                        <th className="py-2 pr-3 font-medium">{t('large.category')}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t('large.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {largeQuery.data!.items.map((item) => (
                        <tr key={item.transactionId} className="border-t border-[var(--color-border-subtle)]">
                          <td className="py-2 pr-3 text-[var(--color-content-muted)]">
                            {formatDate(item.occurredAt)}
                          </td>
                          <td className="py-2 pr-3">{item.description}</td>
                          <td className="py-2 pr-3 text-[var(--color-content-muted)]">{item.merchant ?? '—'}</td>
                          <td className="py-2 pr-3 text-[var(--color-content-muted)]">
                            {item.categoryName ?? t('large.uncategorized')}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatNumber(item.amount)} {currency}
                            {item.multipleOfMedian && (
                              <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                                {t('large.times_median', { value: item.multipleOfMedian })}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === 'accounts' && (
            <section className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-medium">{t('accounts.title')}</h2>
                <p className="text-xs text-[var(--color-content-muted)]">{t('accounts.transfer_note')}</p>
              </div>
              {accountsQuery.isLoading ? (
                <LoadingState />
              ) : accountsQuery.isError ? (
                <ErrorState message={t('load_failed')} onRetry={() => accountsQuery.refetch()} />
              ) : accountsQuery.data!.items.length === 0 ? (
                <EmptyState title={t('accounts.empty')} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-[var(--color-content-muted)]">
                      <tr>
                        <th className="py-2 pr-3 font-medium">{t('accounts.name')}</th>
                        <th className="py-2 pr-3 font-medium">{t('accounts.type')}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t('accounts.income')}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t('accounts.expense')}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t('accounts.net')}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t('accounts.transfer_in')}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t('accounts.transfer_out')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accountsQuery.data!.items.map((item) => (
                        <tr key={item.accountId} className="border-t border-[var(--color-border-subtle)]">
                          <td className="py-2 pr-3">{item.name}</td>
                          <td className="py-2 pr-3 text-[var(--color-content-muted)]">
                            {accountType(item.type)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatNumber(item.income)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatNumber(item.expense)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(item.net)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-content-muted)]">
                            {formatNumber(item.transferIn)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-content-muted)]">
                            {formatNumber(item.transferOut)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <p className="text-xs text-[var(--color-content-muted)]">
            {t('basis.title')}：{t('basis.period', { from: summary.period.from, to: summary.period.to })} ·{' '}
            {t('basis.currency', { currency })} · {t('basis.excludes')} · {t('basis.rate_mode')} ·{' '}
            {summary.coverage.isComplete ? t('basis.complete') : t('basis.incomplete')}
          </p>
        </>
      )}
    </div>
  );
}
