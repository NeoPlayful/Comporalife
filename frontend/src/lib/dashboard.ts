import { api } from './client';

export interface OverviewBasis {
  asOf: string;
  period: { from: string; to: string };
  timezone: string;
  baseCurrency: string;
  missingRates: string[];
  excludedAccounts: Array<{ id: string; name: string; currency: string; reason: string }>;
  isComplete: boolean;
}

export interface DashboardOverview {
  netWorth: string;
  totalAssets: string;
  totalLiabilities: string;
  baseCurrency: string;
  monthIncome: string;
  monthExpense: string;
  monthNet: string;
  savingsRate: string | null;
  /** 六项分项：三者之和等于 totalAssets，供界面分栏展示并自证不重复计数 */
  breakdown?: {
    accountAssets: string;
    securitiesValue: string;
    otherAssets: string;
    accountLiabilities: string;
    otherLiabilities: string;
  };
  unpricedAssets?: Array<{ id: string; name: string; reason: string }>;
  unpricedLiabilities?: Array<{ id: string; name: string; reason: string }>;
  basis: OverviewBasis;
}

export interface BudgetAlertItem {
  budgetId: string;
  periodType: string;
  scope: 'total' | 'category';
  categoryId?: string;
  categoryName?: string;
  level: 'warning' | 'exceeded';
  spent: string;
  available: string;
  usageRatio: string | null;
}

export interface BudgetAlertsResponse {
  alerts: BudgetAlertItem[];
  counts: { total: number; exceeded: number; warning: number };
}

export interface GoalProgressItem {
  id: string;
  name: string;
  currency: string;
  targetAmount: string;
  progress: string | null;
  isAchieved: boolean;
  targetDate: string | null;
  monthsRemaining: number | null;
}

export interface GoalProgressResponse {
  goals: GoalProgressItem[];
  counts: { active: number; achieved: number };
}

export interface CashflowPoint {
  period: string;
  income: string;
  expense: string;
  net: string;
  isComplete: boolean;
}

export interface CashflowResponse {
  points: CashflowPoint[];
  totalIncome: string;
  totalExpense: string;
  totalNet: string;
  transferTotal: string;
  savingsRate: string | null;
  basis: {
    timezone: string;
    baseCurrency: string;
    from: string;
    to: string;
    isComplete: boolean;
    /** 因缺汇率被排除的币种对；非空时收支金额偏低 */
    missingRates: string[];
    note: string;
  };
}

export interface NetWorthTrend {
  series: Array<{ period: string; netWorth: string }>;
  granularity: 'day' | 'month';
  baseCurrency: string;
  /** 区间早于首个汇率时，用的是最早可得的汇率折算 */
  rateFallback?: boolean;
  basis: { from: string; to: string; timezone?: string; note: string };
}

export interface AccountBalance {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: string;
  isLiability: boolean;
}

export interface AssetAllocation {
  byType: Array<{ type: string; amount: string; ratio: string | null }>;
  byCurrency: Array<{ currency: string; amount: string }>;
  total: string;
  baseCurrency: string;
  basis: { asOf: string; note: string };
}

export interface RecentTransaction {
  id: string;
  type: string;
  occurredAt: string;
  description: string;
  category: { id: string; name: string; kind: string } | null;
  amount: string;
  currency: string;
}

export interface QualityFlagItem {
  targetType: 'portfolio' | 'asset';
  targetId: string;
  name: string;
  priceDate: string | null;
  daysStale: number | null;
  missingSymbols: string[];
}

export interface DataQuality {
  uncategorizedTransactions: number;
  missingRateCurrencies: string[];
  reconciliationDifferences: Array<{ accountId: string; difference: string; reconciledAt: string }>;
  archivedWithNonZeroBalance: string[];
  /** 有价格日期但已超过过期阈值 */
  staleValuations: QualityFlagItem[];
  /** 从未录价，或组合内存在无价标的 */
  unpricedInvestments: QualityFlagItem[];
  baseCurrency: string;
}

export const dashboardApi = {
  overview: () => api.get<DashboardOverview>('/api/dashboard/overview'),
  cashflow: (from?: string, to?: string) => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const suffix = query.toString() ? `?${query}` : '';
    return api.get<CashflowResponse>(`/api/dashboard/cashflow${suffix}`);
  },
  netWorthTrend: (from?: string, to?: string) => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const suffix = query.toString() ? `?${query}` : '';
    return api.get<NetWorthTrend>(`/api/dashboard/net-worth-trend${suffix}`);
  },
  accountBalances: () => api.get<{ accounts: AccountBalance[]; asOf: string; baseCurrency: string }>(
    '/api/dashboard/account-balances',
  ),
  assetAllocation: () => api.get<AssetAllocation>('/api/dashboard/asset-allocation'),
  recentTransactions: (limit = 10) =>
    api.get<{ transactions: RecentTransaction[] }>(`/api/dashboard/recent-transactions?limit=${limit}`),
  dataQuality: () => api.get<DataQuality>('/api/dashboard/data-quality'),
  budgetAlerts: () => api.get<BudgetAlertsResponse>('/api/dashboard/budget-alerts'),
  goalProgress: () => api.get<GoalProgressResponse>('/api/dashboard/goal-progress'),
};

export type WatchlistState = 'fresh' | 'stale' | 'missing';

export interface WatchlistEntry {
  from: string;
  to: string;
  /** 缺失时为 null */
  rate: string | null;
  rateDate: string | null;
  source: 'manual' | 'provider' | null;
  state: WatchlistState;
  daysLag: number | null;
  /** 是否来自自己账户/资产/负债的币种需求 */
  required: boolean;
}

export interface WatchlistCandidate {
  from: string;
  to: string;
  required: boolean;
}

export interface WatchlistView {
  baseCurrency: string;
  /** false 表示跟随默认集合，true 表示用户增删过 */
  custom: boolean;
  limit: number;
  entries: WatchlistEntry[];
  candidates: WatchlistCandidate[];
}

/**
 * 汇率只读 + 自选。
 *
 * 汇率由后台统一维护，用户能改的只有「列表里显示哪些币种对」。
 * 可添加的候选由服务端决定：只给出当前真能折算的币种对，以及自己确实需要的币种对。
 */
export const exchangeRatesApi = {
  watchlist: () => api.get<WatchlistView>('/api/exchange-rates/watchlist'),
  addPair: (body: { from: string; to: string }) =>
    api.post<WatchlistView>('/api/exchange-rates/watchlist', body),
  removePair: (body: { from: string; to: string }) =>
    api.delete<WatchlistView>('/api/exchange-rates/watchlist', { body }),
  resetWatchlist: () => api.post<WatchlistView>('/api/exchange-rates/watchlist/reset'),
};
