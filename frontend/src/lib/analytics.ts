import { api } from './client';

export interface Coverage {
  categorizedAmount: string;
  uncategorizedAmount: string;
  uncategorizedCount: number;
  coverageRatio: string | null;
  missingRates: Array<{ currency: string; date: string }>;
  isComplete: boolean;
  excludedCount: number;
}

export interface AnalyticsBasis {
  timezone: string;
  baseCurrency: string;
  period: { from: string; to: string; days: number };
  excludes: string[];
  rateDateMode: string;
  [key: string]: unknown;
}

export interface IncomeExpenseResponse {
  income: string;
  expense: string;
  net: string;
  savingsRate: string | null;
  investableSurplus: string;
  transactionCounts: { income: number; expense: number };
  coverage: Coverage;
  period: { from: string; to: string; days: number };
  basis: AnalyticsBasis;
}

export interface CategoryItem {
  categoryId: string;
  name: string;
  amount: string;
  ratio: string | null;
  count: number;
  previousAmount: string | null;
  changeRatio: string | null;
}

export interface CategoryAnalyticsResponse {
  kind: 'income' | 'expense';
  level: 1 | 2;
  items: CategoryItem[];
  total: string;
  coverage: Coverage;
  period: { from: string; to: string; days: number };
  basis: AnalyticsBasis;
}

export interface AccountAnalyticsItem {
  accountId: string;
  name: string;
  type: string;
  currency: string;
  income: string;
  expense: string;
  net: string;
  transferIn: string;
  transferOut: string;
  incomeBase: string;
  expenseBase: string;
}

export interface AccountAnalyticsResponse {
  items: AccountAnalyticsItem[];
  totals: { incomeBase: string; expenseBase: string };
  coverage: Coverage;
  period: { from: string; to: string; days: number };
  basis: AnalyticsBasis;
}

export interface UncategorizedResponse {
  count: number;
  amount: string;
  oldestOccurredAt: string | null;
  byAccount: Array<{ accountId: string; name: string; count: number; amount: string }>;
  items: Array<{
    transactionId: string;
    occurredAt: string;
    description: string;
    merchant: string | null;
    amount: string;
    currency: string;
    accountName: string;
  }>;
  truncated: boolean;
  period: { from: string; to: string; days: number };
}

export interface MerchantResponse {
  items: Array<{
    merchant: string;
    amount: string;
    count: number;
    ratio: string | null;
    lastOccurredAt: string;
    topCategoryName: string | null;
  }>;
  unattributed: { amount: string; count: number };
  total: string;
  coverage: Coverage;
  period: { from: string; to: string; days: number };
  basis: AnalyticsBasis;
}

export interface TrendResponse {
  points: Array<{
    period: string;
    income: string;
    expense: string;
    net: string;
    isComplete: boolean;
  }>;
  granularity: 'day' | 'week' | 'month';
  downgraded: boolean;
  totals: { income: string; expense: string; net: string };
  coverage: Coverage;
  period: { from: string; to: string; days: number };
  basis: AnalyticsBasis;
}

export interface PeriodComparisonResponse {
  current: {
    period: { from: string; to: string; days: number };
    summary: {
      income: string;
      expense: string;
      net: string;
      savingsRate: string | null;
      investableSurplus: string;
      transactionCounts: { income: number; expense: number };
    };
  };
  previous: {
    period: { from: string; to: string; days: number };
    summary: PeriodComparisonResponse['current']['summary'];
  } | null;
  changes: Record<string, string | null>;
  yoy: {
    period: { from: string; to: string; days: number };
    summary: PeriodComparisonResponse['current']['summary'];
    changes: Record<string, string | null>;
  } | null;
  basis: AnalyticsBasis;
}

export interface LargeExpenseResponse {
  threshold: string;
  thresholdSource: 'p95' | 'median_multiple' | 'parameter';
  items: Array<{
    transactionId: string;
    occurredAt: string;
    description: string;
    merchant: string | null;
    categoryName: string | null;
    uncategorized: boolean;
    amount: string;
    multipleOfMedian: string | null;
  }>;
  median: string | null;
  expenseCount: number;
  coverage: Coverage;
  period: { from: string; to: string; days: number };
  basis: AnalyticsBasis;
}

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringResponse {
  items: Array<{
    key: string;
    label: string;
    accountId: string;
    accountName: string;
    frequency: RecurringFrequency;
    amount: string;
    amountVariation: string;
    occurrences: number;
    lastOccurredAt: string;
    nextExpectedDate: string;
    confidence: string;
    recentSamples: Array<{
      transactionId: string;
      occurredAt: string;
      amount: string;
      description: string;
    }>;
  }>;
  lookbackMonths: number;
  lookback: { from: string; to: string };
  note?: string;
}

export interface FixedVariableResponse {
  fixed: {
    amount: string;
    ratio: string | null;
    items: Array<{ key: string; label: string; amount: string; frequency: RecurringFrequency }>;
  };
  variable: { amount: string; ratio: string | null };
  total: string;
  recurringKeys: string[];
  coverage: Coverage;
  period: { from: string; to: string; days: number };
  basis: AnalyticsBasis;
  note?: string;
}

function query(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}

export interface AnalyticsRange {
  from: string;
  to: string;
}

export const analyticsApi = {
  incomeExpense: (range: AnalyticsRange) =>
    api.get<IncomeExpenseResponse>(`/api/analytics/income-expense${query(range)}`),

  categories: (range: AnalyticsRange & { kind?: 'income' | 'expense'; level?: 1 | 2; previous?: boolean }) =>
    api.get<CategoryAnalyticsResponse>(`/api/analytics/categories${query(range)}`),

  accounts: (range: AnalyticsRange) =>
    api.get<AccountAnalyticsResponse>(`/api/analytics/accounts${query(range)}`),

  uncategorized: (range: AnalyticsRange) =>
    api.get<UncategorizedResponse>(`/api/analytics/uncategorized${query(range)}`),

  merchants: (range: AnalyticsRange & { limit?: number }) =>
    api.get<MerchantResponse>(`/api/analytics/merchants${query(range)}`),

  cashflowTrend: (range: AnalyticsRange & { granularity?: 'day' | 'week' | 'month' }) =>
    api.get<TrendResponse>(`/api/analytics/cashflow-trend${query(range)}`),

  periodComparison: (range: AnalyticsRange & { mode?: 'month' | 'year' | 'custom' }) =>
    api.get<PeriodComparisonResponse>(`/api/analytics/period-comparison${query(range)}`),

  largeExpenses: (range: AnalyticsRange & { threshold?: string; limit?: number }) =>
    api.get<LargeExpenseResponse>(`/api/analytics/large-expenses${query(range)}`),

  recurring: (params: { lookbackMonths?: number; frequency?: RecurringFrequency } = {}) =>
    api.get<RecurringResponse>(`/api/analytics/recurring${query(params)}`),

  fixedVariable: (range: AnalyticsRange) =>
    api.get<FixedVariableResponse>(`/api/analytics/fixed-variable${query(range)}`),
};
