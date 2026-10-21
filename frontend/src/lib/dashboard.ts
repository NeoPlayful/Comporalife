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
  basis: OverviewBasis;
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
    from: string;
    to: string;
    isComplete: boolean;
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
};

export interface ExchangeRateRecord {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  rateDate: string;
  source: string;
}

export const exchangeRatesApi = {
  list: () => api.get<{ exchangeRates: ExchangeRateRecord[] }>('/api/exchange-rates/manual'),
  create: (body: { baseCurrency: string; quoteCurrency: string; rate: string; rateDate: string }) =>
    api.post<{ exchangeRate: ExchangeRateRecord }>('/api/exchange-rates/manual', body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/exchange-rates/manual/${id}`),
};
