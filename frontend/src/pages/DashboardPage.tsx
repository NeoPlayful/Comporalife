import { ACCOUNT_TYPE_LABELS, type AccountType } from '@/api/accounts';
import '@/components/charts/echarts';
import ReactECharts from 'echarts-for-react';
import { dashboardApi } from '@/api/dashboard';
import CashflowChart from '@/components/charts/CashflowChart';
import NetWorthChart from '@/components/charts/NetWorthChart';
import MoneyDisplay from '@/components/finance/MoneyDisplay';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { TRANSACTION_TYPE_LABELS } from '@/api/transactions';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import '@/components/charts/echarts';

export default function DashboardPage() {
  const overviewQuery = useQuery({ queryKey: ['dashboard', 'overview'], queryFn: dashboardApi.overview });
  const cashflowQuery = useQuery({ queryKey: ['dashboard', 'cashflow'], queryFn: () => dashboardApi.cashflow() });
  const trendQuery = useQuery({ queryKey: ['dashboard', 'trend'], queryFn: () => dashboardApi.netWorthTrend() });
  const balancesQuery = useQuery({ queryKey: ['dashboard', 'balances'], queryFn: dashboardApi.accountBalances });
  const allocationQuery = useQuery({ queryKey: ['dashboard', 'allocation'], queryFn: dashboardApi.assetAllocation });
  const recentQuery = useQuery({ queryKey: ['dashboard', 'recent'], queryFn: () => dashboardApi.recentTransactions() });
  const qualityQuery = useQuery({ queryKey: ['dashboard', 'quality'], queryFn: dashboardApi.dataQuality });

  if (overviewQuery.isLoading) return <LoadingState />;
  if (overviewQuery.isError) {
    return <ErrorState message="Dashboard 加载失败" onRetry={() => overviewQuery.refetch()} />;
  }

  const overview = overviewQuery.data!;
  const accounts = balancesQuery.data?.accounts ?? [];

  if (accounts.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">财务总览</h1>
        <div className="card">
          <EmptyState
            title="欢迎使用 Comporalife"
            description="先创建一个账户，然后记录你的第一笔收入或支出。"
            action={
              <Link
                to="/accounts"
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                创建账户
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
    (quality?.archivedWithNonZeroBalance.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">财务总览</h1>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="净资产"
          value={overview.netWorth}
          currency={overview.baseCurrency}
          hint={`资产 ${Number(overview.totalAssets).toLocaleString('zh-CN')} · 负债 ${Number(overview.totalLiabilities).toLocaleString('zh-CN')}`}
        />
        <MetricCard label="本月收入" value={overview.monthIncome} currency={overview.baseCurrency} tone="positive" />
        <MetricCard label="本月支出" value={overview.monthExpense} currency={overview.baseCurrency} tone="negative" />
        <MetricCard
          label="本月结余"
          value={overview.monthNet}
          currency={overview.baseCurrency}
          hint={
            overview.savingsRate === null
              ? '储蓄率：收入为 0 时不可计算'
              : `储蓄率 ${(Number(overview.savingsRate) * 100).toFixed(1)}%`
          }
        />
      </div>

      {overview.basis.missingRates.length > 0 && (
        <div className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-4" />
            缺少汇率，以下币种未计入净资产
          </p>
          <p className="mt-1">
            {overview.basis.missingRates.join('、')} · 请在
            <Link to="/settings" className="mx-1 underline">
              设置
            </Link>
            中补录汇率
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-medium">净资产趋势</h2>
          {trendQuery.data ? (
            <NetWorthChart data={trendQuery.data} />
          ) : (
            <div className="h-[240px]">
              {trendQuery.isLoading ? <LoadingState label="加载趋势…" /> : <ErrorState message="趋势加载失败" />}
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            {trendQuery.data?.basis.note} · 基准币种 {overview.baseCurrency}
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-medium">月度现金流</h2>
          {cashflowQuery.data ? (
            <CashflowChart points={cashflowQuery.data.points} currency={overview.baseCurrency} />
          ) : (
            <div className="h-[260px]">
              {cashflowQuery.isLoading ? <LoadingState label="加载现金流…" /> : <ErrorState message="现金流加载失败" />}
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            {cashflowQuery.data?.basis.note} · 时区 {cashflowQuery.data?.basis.timezone}
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-medium">资产配置</h2>
          {allocationQuery.data ? (
            <AllocationChart data={allocationQuery.data} />
          ) : (
            <div className="h-[220px]">
              {allocationQuery.isLoading ? <LoadingState label="加载配置…" /> : null}
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">{allocationQuery.data?.basis.note}</p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-medium">账户余额</h2>
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between py-2">
                <Link to={`/accounts/${account.id}`} className="min-w-0 text-sm hover:underline">
                  <span className="truncate">{account.name}</span>
                  <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                    {ACCOUNT_TYPE_LABELS[account.type as AccountType] ?? account.type}
                    {account.isLiability && ' · 负债'}
                  </span>
                </Link>
                <MoneyDisplay amount={account.balance} currency={account.currency} className="text-sm" />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            截至 {new Date(balancesQuery.data?.asOf ?? Date.now()).toLocaleString('zh-CN')} · 期初 + 已入账分录
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">最近流水</h2>
            <Link to="/transactions" className="text-xs text-[var(--color-accent)]">
              查看全部
            </Link>
          </div>
          {recentQuery.data?.transactions.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-content-muted)]">暂无流水</p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {recentQuery.data?.transactions.map((tx) => (
                <li key={tx.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{tx.description}</p>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {tx.occurredAt.slice(0, 10)} ·{' '}
                      {TRANSACTION_TYPE_LABELS[tx.type as keyof typeof TRANSACTION_TYPE_LABELS] ?? tx.type}
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
          <h2 className="mb-3 text-sm font-medium">数据质量</h2>
          {!quality ? (
            <LoadingState label="检查数据…" />
          ) : !hasQualityIssue ? (
            <p className="py-6 text-center text-sm text-[var(--color-positive)]">数据完整，未发现异常</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {quality.uncategorizedTransactions > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>
                    {quality.uncategorizedTransactions} 笔流水未分类，
                    <Link to="/transactions" className="text-[var(--color-accent)]">
                      去分类
                    </Link>
                  </span>
                </li>
              )}
              {quality.missingRateCurrencies.length > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>
                    缺少 {quality.missingRateCurrencies.join('、')} 汇率，
                    <Link to="/settings" className="text-[var(--color-accent)]">
                      补录汇率
                    </Link>
                  </span>
                </li>
              )}
              {quality.reconciliationDifferences.length > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>{quality.reconciliationDifferences.length} 个账户对账存在差异</span>
                </li>
              )}
              {quality.archivedWithNonZeroBalance.length > 0 && (
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-negative)]" />
                  <span>已归档但仍有余额：{quality.archivedWithNonZeroBalance.join('、')}</span>
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
  const items = data.byType.filter((item) => Number(item.amount) !== 0);

  if (items.length === 0) {
    return <EmptyState title="暂无可分配的资产" />;
  }

  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(30,32,38,0.95)',
      borderWidth: 0,
      textStyle: { color: '#e8e9ed', fontSize: 12 },
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}<br/>${params.value.toLocaleString('zh-CN')} ${data.baseCurrency} (${params.percent}%)`,
    },
    legend: {
      bottom: 0,
      textStyle: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
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
          name: ACCOUNT_TYPE_LABELS[item.type as AccountType] ?? item.type,
          value: Number(item.amount),
        })),
        color: ['#5b8def', '#4ea87c', '#c76a5e', '#b58ce0', '#d9a55b', '#5aa9c7'],
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 220 }} notMerge lazyUpdate />;
}
