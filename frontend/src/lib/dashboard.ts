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

export interface ExchangeRateRecord {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  /** DECIMAL(20,10) 定长字符串，展示用 formatRate */
  rate: string;
  rateDate: string;
  /** manual = 后台人工录入；provider = 外部汇率源自动写入 */
  source: 'manual' | 'provider';
}

export interface RatePairRequestRecord {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface ExchangeRatePage {
  exchangeRates: ExchangeRateRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

/**
 * 汇率只读：汇率由后台统一维护，用户不能写入。
 * 对缺失币种对只能提交申请，由管理员决定是否纳入维护。
 */
export const exchangeRatesApi = {
  list: (params: { page?: number; pageSize?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    const suffix = query.toString() ? `?${query}` : '';
    return api.get<ExchangeRatePage>(`/api/exchange-rates/manual${suffix}`);
  },
  pairRequests: () =>
    api.get<{ requests: RatePairRequestRecord[]; pagination: ExchangeRatePage['pagination'] }>(
      '/api/exchange-rates/pair-requests',
    ),
  createPairRequest: (body: { baseCurrency: string; quoteCurrency: string; reason?: string }) =>
    api.post<{ request: RatePairRequestRecord }>('/api/exchange-rates/pair-requests', body),
  removePairRequest: (id: string) =>
    api.delete<{ deleted: boolean }>(`/api/exchange-rates/pair-requests/${id}`),
};
