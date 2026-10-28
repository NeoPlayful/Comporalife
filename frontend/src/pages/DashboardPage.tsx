import '@/components/charts/echarts';
import ReactECharts from 'echarts-for-react';
import { dashboardApi } from '@/lib/dashboard';
import CashflowChart from '@/components/charts/CashflowChart';
import NetWorthChart from '@/components/charts/NetWorthChart';
import MoneyDisplay from '@/components/finance/MoneyDisplay';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { useEnumLabels } from '@/lib/enum-labels';
import { useChartTheme } from '@/theme/chart-theme';
import { ASSET_PALETTE } from '@/theme/palette';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { subDays } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/** 趋势区间：天数即「含今天在内往前推几天」，30 天 = 今天与前 29 天 */
const TREND_RANGES = [30, 90, 180, 365] as const;
type TrendRange = (typeof TREND_RANGES)[number];

function trendWindowFor(days: TrendRange): { from: string; to: string } {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = subDays(today, days - 1).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * 首页只提示「哪些组合有问题」，但用户真正要操作的是单个组合。
 * 只有一个组合时直接跳进去；多个时退回列表，避免指向不明。
 */
function InvestmentLink({
  items,
  label,
}: {
  items: Array<{ targetType: 'portfolio' | 'asset'; targetId: string }>;
  label: string;
}) {
  const only = items.length === 1 ? items[0] : null;
  const to = only && only.targetType === 'portfolio' ? `/portfolios/${only.targetId}` : '/portfolios';

  return (
    <Link to={to} className="text-[var(--color-accent)]">
      {label}
    </Link>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { accountType, transactionType } = useEnumLabels();
  const [trendRange, setTrendRange] = useState<TrendRange>(30);
  // 日期只在切换区间时重算，不随每次渲染变化，查询键才稳定可缓存
  const [trendWindow, setTrendWindow] = useState(() => trendWindowFor(30));

  useEffect(() => {
    setTrendWindow(trendWindowFor(trendRange));
  }, [trendRange]);

  const overviewQuery = useQuery({ queryKey: ['dashboard', 'overview'], queryFn: dashboardApi.overview });
  const cashflowQuery = useQuery({ queryKey: ['dashboard', 'cashflow'], queryFn: () => dashboardApi.cashflow() });
  const trendQuery = useQuery({
    queryKey: ['dashboard', 'trend', trendWindow],
    queryFn: () => dashboardApi.netWorthTrend(trendWindow.from, trendWindow.to),
  });
  const balancesQuery = useQuery({ queryKey: ['dashboard', 'balances'], queryFn: dashboardApi.accountBalances });
  const allocationQuery = useQuery({ queryKey: ['dashboard', 'allocation'], queryFn: dashboardApi.assetAllocation });
  const recentQuery = useQuery({ queryKey: ['dashboard', 'recent'], queryFn: () => dashboardApi.recentTransactions() });
  const qualityQuery = useQuery({ queryKey: ['dashboard', 'quality'], queryFn: dashboardApi.dataQuality });
  const budgetAlertsQuery = useQuery({
    queryKey: ['dashboard', 'budget-alerts'],
    queryFn: () => dashboardApi.budgetAlerts(),
  });
  const goalQuery = useQuery({
    queryKey: ['dashboard', 'goal-progress'],
    queryFn: () => dashboardApi.goalProgress(),
  });

  if (overviewQuery.isLoading) return <LoadingState />;
  if (overviewQuery.isError) {
    return (
      <ErrorState message={t('dashboard:load_failed')} onRetry={() => overviewQuery.refetch()} />
    );
  }

  const overview = overviewQuery.data!;
  const accounts = balancesQuery.data?.accounts ?? [];

  if (accounts.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{t('dashboard:title')}</h1>
        <div className="card">
          <EmptyState
            title={t('dashboard:welcome_title')}
            description={t('dashboard:welcome_description')}
            action={
              <Link
                to="/accounts"
                className="rounded-lg btn-action px-4 py-2 text-sm font-medium"
              >
                {t('dashboard:create_account')}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const quality = qualityQuery.data;
  const hasQualityIssue =
    (quality?.uncategorizedTransactions ?? 0) > 0 ||
    (quality?.missingRateCurrencies.length ?? 0) > 0 ||
    (quality?.reconciliationDifferences.length ?? 0) > 0 ||
    (quality?.archivedWithNonZeroBalance.length ?? 0) > 0 ||
    (quality?.staleValuations.length ?? 0) > 0 ||
    (quality?.unpricedInvestments.length ?? 0) > 0;

  const listSeparator = t('common:list_separator');

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('dashboard:title')}</h1>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={t('dashboard:metrics.net_worth')}
          value={overview.netWorth}
          currency={overview.baseCurrency}
          hint={t('dashboard:metrics.assets_liabilities', {
            assets: formatNumber(overview.totalAssets),
            liabilities: formatNumber(overview.totalLiabilities),
          })}
        />
        <MetricCard
          label={t('dashboard:metrics.month_income')}
          value={overview.monthIncome}
          currency={overview.baseCurrency}
          tone="positive"
        />
        <MetricCard
          label={t('dashboard:metrics.month_expense')}
          value={overview.monthExpense}
          currency={overview.baseCurrency}
          tone="negative"
        />
        <MetricCard
          label={t('dashboard:metrics.month_net')}
          value={overview.monthNet}
          currency={overview.baseCurrency}
          hint={
            overview.savingsRate === null
              ? t('dashboard:metrics.savings_rate_na')
              : t('dashboard:metrics.savings_rate', {
                  rate: (Number(overview.savingsRate) * 100).toFixed(1),
                })
          }
        />
      </div>

      {/* 净值分项：让用户看清钱落在哪一栏，建成重复账户时能自己发现 */}
      {overview.breakdown && (
        <div className="card grid gap-3 p-4 text-xs sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <p className="text-[var(--color-content-muted)]">{t('dashboard:breakdown.account_assets')}</p>
            <MoneyDisplay amount={overview.breakdown.accountAssets} currency={overview.baseCurrency} className="text-sm" />
          </div>
          <div>
            <p className="text-[var(--color-content-muted)]">{t('dashboard:breakdown.securities')}</p>
            <MoneyDisplay amount={overview.breakdown.securitiesValue} currency={overview.baseCurrency} className="text-sm" />
          </div>
          <div>
            <p className="text-[var(--color-content-muted)]">{t('dashboard:breakdown.other_assets')}</p>
            <MoneyDisplay amount={overview.breakdown.otherAssets} currency={overview.baseCurrency} className="text-sm" />
          </div>
          <div>
            <p className="text-[var(--color-content-muted)]">{t('dashboard:breakdown.account_liabilities')}</p>
            <MoneyDisplay amount={overview.breakdown.accountLiabilities} currency={overview.baseCurrency} className="text-sm" />
          </div>
          <div>
            <p className="text-[var(--color-content-muted)]">{t('dashboard:breakdown.other_liabilities')}</p>
            <MoneyDisplay amount={overview.breakdown.otherLiabilities} currency={overview.baseCurrency} className="text-sm" />
          </div>
        </div>
      )}

      {(overview.unpricedAssets?.length ?? 0) > 0 && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t('dashboard:unpriced_assets', {
            names: overview.unpricedAssets!.map((item) => item.name).join(listSeparator),
          })}
          <Link to="/assets" className="mx-1 underline">
            {t('dashboard:go_assets')}
          </Link>
        </p>
      )}

      {(budgetAlertsQuery.data?.counts.total ?? 0) > 0 && (
        <Link to="/budgets" className="card flex items-center justify-between p-4 text-sm">
          <span>
            {t('dashboard:budget_alerts.summary', {
              exceeded: budgetAlertsQuery.data!.counts.exceeded,
              warning: budgetAlertsQuery.data!.counts.warning,
            })}
          </span>
          <span className="text-[var(--color-accent)]">{t('dashboard:budget_alerts.action')}</span>
        </Link>
      )}

      {(goalQuery.data?.counts.active ?? 0) > 0 && (
        <section className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">{t('dashboard:goal_progress.title')}</h2>
            <Link to="/goals" className="text-xs text-[var(--color-accent)]">
              {t('dashboard:goal_progress.action')}
            </Link>
          </div>
          <ul className="space-y-1.5 text-xs">
            {goalQuery.data!.goals.slice(0, 3).map((goal) => (
              <li key={goal.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{goal.name}</span>
                <span className="shrink-0 text-[var(--color-content-muted)]">
                  {goal.isAchieved
                    ? t('dashboard:goal_progress.achieved')
                    : t('dashboard:goal_progress.percent', {
                        value: goal.progress ? (Number(goal.progress) * 100).toFixed(1) : '—',
                      })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {overview.basis.missingRates.length > 0 && (
        <div className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-4" />
            {t('dashboard:missing_rates.title')}
          </p>
          <p className="mt-1">
            {t('dashboard:missing_rates.body', {
              currencies: overview.basis.missingRates.join(listSeparator),
            })}
            <Link to="/exchange-rates" className="mx-1 underline">
              {t('dashboard:missing_rates.settings_link')}
            </Link>
            {t('dashboard:missing_rates.body_suffix')}
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t('dashboard:sections.net_worth_trend')}</h2>
            <div className="flex items-center gap-1">
              {TREND_RANGES.map((days) => (
                <button
                  key={days}
                  type="button"
                  aria-pressed={trendRange === days}
                  onClick={() => setTrendRange(days)}
                  className={`rounded-md px-2 py-1 text-xs transition-colors ${
                    trendRange === days
                      ? 'btn-action'
                      : 'text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  {t('dashboard:sections.trend_range', { days })}
                </button>
              ))}
            </div>
          </div>
          {trendQuery.data ? (
            <NetWorthChart data={trendQuery.data} />
          ) : (
            <div className="h-[240px]">
              {trendQuery.isLoading ? (
                <LoadingState label={t('dashboard:sections.loading_trend')} />
              ) : (
                <ErrorState message={t('dashboard:sections.trend_failed')} />
              )}
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            {t('dashboard:sections.trend_basis', {
              note: trendQuery.data?.basis.note ?? '',
              currency: overview.baseCurrency,
            })}
            {trendQuery.data && (
              <>
                {' · '}
                {t(
                  trendQuery.data.granularity === 'day'
                    ? 'dashboard:sections.granularity_day'
                    : 'dashboard:sections.granularity_month',
                )}
              </>
            )}
          </p>
          {trendQuery.data?.rateFallback && (
            <p className="mt-1 text-xs text-[var(--color-content-muted)]">
              {t('dashboard:sections.trend_rate_fallback')}
            </p>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-medium">{t('dashboard:sections.cashflow')}</h2>
          {cashflowQuery.data ? (
            <CashflowChart points={cashflowQuery.data.points} currency={overview.baseCurrency} />
          ) : (
            <div className="h-[260px]">
              {cashflowQuery.isLoading ? (
                <LoadingState label={t('dashboard:sections.loading_cashflow')} />
              ) : (
                <ErrorState message={t('dashboard:sections.cashflow_failed')} />
              )}
            </div>
          )}
          {(cashflowQuery.data?.basis.missingRates.length ?? 0) > 0 && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--color-negative)]">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t('dashboard:sections.cashflow_missing_rate', {
                  currencies: cashflowQuery.data!.basis.missingRates.join(listSeparator),
                })}
                <Link to="/exchange-rates" className="text-[var(--color-accent)]">
                  {t('dashboard:sections.add_rates')}
                </Link>
              </span>
            </p>
          )}
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            {t('dashboard:sections.cashflow_basis', {
              note: cashflowQuery.data?.basis.note ?? '',
              timezone: cashflowQuery.data?.basis.timezone ?? '',
            })}
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-medium">{t('dashboard:sections.allocation')}</h2>
          {allocationQuery.data ? (
            <AllocationChart data={allocationQuery.data} />
          ) : (
            <div className="h-[220px]">
              {allocationQuery.isLoading ? (
                <LoadingState label={t('dashboard:sections.loading_allocation')} />
              ) : null}
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            {allocationQuery.data?.basis.note}
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-medium">{t('dashboard:sections.account_balances')}</h2>
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between py-2">
                <Link to={`/accounts/${account.id}`} className="min-w-0 text-sm hover:underline">
                  <span className="truncate">{account.name}</span>
                  <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                    {accountType(account.type)}
                    {account.isLiability && t('dashboard:sections.liability_suffix')}
                  </span>
                </Link>
                <MoneyDisplay amount={account.balance} currency={account.currency} className="text-sm" />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            {t('dashboard:sections.balances_as_of', {
              time: formatDateTime(balancesQuery.data?.asOf ?? Date.now()),
            })}
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">{t('dashboard:sections.recent')}</h2>
            <Link to="/transactions" className="text-xs text-[var(--color-accent)]">
              {t('dashboard:sections.view_all')}
            </Link>
          </div>
          {recentQuery.data?.transactions.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-content-muted)]">
              {t('dashboard:sections.recent_empty')}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {recentQuery.data?.transactions.map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{tx.description}</p>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {formatDate(tx.occurredAt)} · {transactionType(tx.type)}
                      {tx.category && ` · ${tx.category.name}`}
                    </p>
                  </div>
                  <MoneyDisplay amount={tx.amount} currency={tx.currency} colorize className="shrink-0 text-sm" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-medium">{t('dashboard:sections.quality')}</h2>
          {!quality ? (
            <LoadingState label={t('dashboard:sections.quality_loading')} />
          ) : !hasQualityIssue ? (
            <p className="py-6 text-center text-sm text-[var(--color-positive)]">
              {t('dashboard:sections.quality_ok')}
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {quality.unpricedInvestments.length > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>
                    {t('dashboard:sections.unpriced_investments', {
                      names: quality.unpricedInvestments
                        .map((item) => item.name)
                        .join(listSeparator),
                    })}
                    <InvestmentLink items={quality.unpricedInvestments} label={t('dashboard:sections.add_prices')} />
                  </span>
                </li>
              )}
              {quality.staleValuations.length > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>
                    {t('dashboard:sections.stale_valuations', {
                      names: quality.staleValuations.map((item) => item.name).join(listSeparator),
                    })}
                    <InvestmentLink items={quality.staleValuations} label={t('dashboard:sections.add_prices')} />
                  </span>
                </li>
              )}
              {quality.uncategorizedTransactions > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>
                    {t('dashboard:sections.uncategorized', {
                      count: quality.uncategorizedTransactions,
                    })}
                    <Link to="/transactions" className="text-[var(--color-accent)]">
                      {t('dashboard:sections.go_categorize')}
                    </Link>
                  </span>
                </li>
              )}
              {quality.missingRateCurrencies.length > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>
                    {t('dashboard:sections.missing_rate', {
                      currencies: quality.missingRateCurrencies.join(listSeparator),
                    })}
                    <Link to="/exchange-rates" className="text-[var(--color-accent)]">
                      {t('dashboard:sections.add_rates')}
                    </Link>
                  </span>
                </li>
              )}
              {quality.reconciliationDifferences.length > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>
                    {t('dashboard:sections.reconciliation_diff', {
                      count: quality.reconciliationDifferences.length,
                    })}
                  </span>
                </li>
              )}
              {quality.archivedWithNonZeroBalance.length > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>
                    {t('dashboard:sections.archived_with_balance', {
                      accounts: quality.archivedWithNonZeroBalance.join(listSeparator),
                    })}
                  </span>
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  currency,
  hint,
  tone,
}: {
  label: string;
  value: string;
  currency: string;
  hint?: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--color-content-muted)]">{label}</p>
      <MoneyDisplay
        amount={value}
        currency={currency}
        className={`mt-1 block text-xl font-semibold ${
          tone === 'positive'
            ? 'text-[var(--color-positive)]'
            : tone === 'negative'
              ? 'text-[var(--color-negative)]'
              : ''
        }`}
      />
      {hint && <p className="mt-1 text-xs text-[var(--color-content-muted)]">{hint}</p>}
    </div>
  );
}

function AllocationChart({ data }: { data: ReturnType<typeof dashboardApi.assetAllocation> extends Promise<infer T> ? T : never }) {
  const { t } = useTranslation('dashboard');
  const { accountType } = useEnumLabels();
  const chartTheme = useChartTheme();
  const items = data.byType.filter((item) => Number(item.amount) !== 0);

  if (items.length === 0) {
    return <EmptyState title={t('sections.allocation_empty')} />;
  }

  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: chartTheme.tooltipBg,
      borderWidth: 0,
      textStyle: { color: chartTheme.tooltipText, fontSize: 12 },
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}<br/>${formatNumber(params.value)} ${data.baseCurrency} (${params.percent}%)`,
    },
    legend: {
      bottom: 0,
      textStyle: { color: chartTheme.legend, fontSize: 11 },
      itemWidth: 8,
      itemHeight: 8,
    },
    series: [
      {
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderWidth: 0 },
        label: { show: false },
        data: items.map((item) => ({
          name: accountType(item.type),
          value: Number(item.amount),
        })),
        color: ASSET_PALETTE,
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 220 }} notMerge lazyUpdate />;
}
