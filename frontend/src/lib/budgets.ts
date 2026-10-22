import { api } from './client';
import type { Coverage } from './analytics';

export type BudgetPeriodType = 'monthly' | 'yearly';
export type BudgetStatus = 'active' | 'archived';
export type BudgetLevel = 'ok' | 'warning' | 'exceeded' | 'unknown';

export interface BudgetSummaryRecord {
  id: string;
  periodType: BudgetPeriodType;
  year: number;
  month: number;
  totalAmount: string | null;
  rollover: boolean;
  status: BudgetStatus;
  note: string | null;
  version: number;
  itemCount: number;
}

export interface BudgetItemProgress {
  itemId: string;
  categoryId: string;
  categoryName: string;
  amount: string;
  carryIn: string;
  available: string;
  spent: string;
  remaining: string;
  usageRatio: string | null;
  level: BudgetLevel;
  childCategoryIds: string[];
}

export interface BudgetTotals {
  amount: string;
  carryIn: string;
  available: string;
  spent: string;
  remaining: string;
  usageRatio: string | null;
  level: BudgetLevel;
  carryOut: string;
  carryoverTruncated: boolean;
}

export interface BudgetProgressResponse {
  budget: {
    id: string;
    periodType: BudgetPeriodType;
    year: number;
    month: number;
    totalAmount: string | null;
    rollover: boolean;
    status: BudgetStatus;
    version: number;
    note: string | null;
  };
  period: { from: string; to: string; timezone: string };
  total: BudgetTotals;
  items: BudgetItemProgress[];
  uncategorizedSpent: string;
  coverage: Coverage;
  basis: {
    timezone: string;
    baseCurrency: string;
    rolloverChain?: number;
    [key: string]: unknown;
  };
}

export interface BudgetAlert {
  budgetId: string;
  periodType: BudgetPeriodType;
  scope: 'total' | 'category';
  categoryId?: string;
  categoryName?: string;
  level: 'warning' | 'exceeded';
  spent: string;
  available: string;
  usageRatio: string | null;
}

export interface BudgetInput {
  periodType: BudgetPeriodType;
  year: number;
  month: number;
  totalAmount?: string | null;
  rollover?: boolean;
  note?: string | null;
  items?: Array<{ categoryId: string; amount: string }>;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}

export const budgetsApi = {
  list: (params: { year?: number; month?: number; periodType?: BudgetPeriodType; status?: BudgetStatus } = {}) =>
    api.get<{ budgets: BudgetSummaryRecord[] }>(`/api/budgets${query(params)}`),

  summary: (params: { periodType: BudgetPeriodType; year: number; month: number }) =>
    api.get<BudgetProgressResponse>(`/api/budgets/summary${query(params)}`),

  alerts: () => api.get<{ alerts: BudgetAlert[] }>('/api/budgets/alerts'),

  detail: (id: string) => api.get<BudgetProgressResponse>(`/api/budgets/${id}`),

  progress: (id: string) => api.get<BudgetProgressResponse>(`/api/budgets/${id}/progress`),

  create: (body: BudgetInput) => api.post<BudgetProgressResponse>('/api/budgets', body),

  update: (
    id: string,
    body: {
      version: number;
      totalAmount?: string | null;
      rollover?: boolean;
      note?: string | null;
      items?: Array<{ categoryId: string; amount: string }>;
    },
  ) => api.patch<BudgetProgressResponse>(`/api/budgets/${id}`, body),

  remove: (id: string) => api.delete<{ id: string }>(`/api/budgets/${id}`),

  copy: (id: string, body: { year?: number; month?: number } = {}) =>
    api.post<BudgetProgressResponse>(`/api/budgets/${id}/copy`, body),
};
