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
  basis: { from: string; to: string; note: string };
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

export interface DataQuality {
  uncategorizedTransactions: number;
  missingRateCurrencies: string[];
  reconciliationDifferences: Array<{ accountId: string; difference: string; reconciledAt: string }>;
  archivedWithNonZeroBalance: string[];
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

export interface ExchangeRateRecord {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  rateDate: string;
  source: string;
}

export interface ExchangeRatePage {
  exchangeRates: ExchangeRateRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export const exchangeRatesApi = {
  list: (params: { page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    const suffix = query.toString() ? `?${query}` : '';
    return api.get<ExchangeRatePage>(`/api/exchange-rates/manual${suffix}`);
  },
  // 同一币种对同一天走 upsert，因此编辑与新增是同一个接口
  create: (body: { baseCurrency: string; quoteCurrency: string; rate: string; rateDate: string }) =>
    api.post<{ exchangeRate: ExchangeRateRecord }>('/api/exchange-rates/manual', body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/exchange-rates/manual/${id}`),
};
