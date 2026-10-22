import { api } from './client';

export type AccountType = 'cash' | 'bank' | 'credit_card' | 'brokerage' | 'loan' | 'other';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  openingBalance: string;
  openingBalanceDate: string;
  status: 'active' | 'archived';
  note: string | null;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  balance: string;
  entryCount?: number;
}

export interface BalanceInfo {
  accountId: string;
  currency: string;
  balance: string;
  openingBalance: string;
  openingBalanceDate: string;
  entryCount: number;
  asOf: string | null;
  basis: string;
}

export interface BalanceHistory {
  accountId: string;
  currency: string;
  granularity: 'day' | 'month';
  series: Array<{ period: string; balance: string }>;
  basis: string;
}

export interface Reconciliation {
  id: string;
  statementBalance: string;
  computedBalance: string;
  difference: string;
  reconciledAt: string;
  note: string | null;
}

export interface AccountTransaction {
  id: string;
  type: string;
  occurredAt: string;
  description: string;
  merchant: string | null;
  status: string;
  category: { id: string; name: string; kind: string } | null;
  amount: string;
  currency: string;
}

export const LIABILITY_TYPES: AccountType[] = ['credit_card', 'loan'];

export const accountsApi = {
  list: (params?: { status?: 'active' | 'archived' | 'all'; type?: AccountType }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.type) query.set('type', params.type);
    const suffix = query.toString() ? `?${query}` : '';
    return api.get<{ accounts: Account[] }>(`/api/accounts${suffix}`);
  },

  create: (body: {
    name: string;
    type: AccountType;
    institution?: string;
    currency: string;
    openingBalance: string;
    openingBalanceDate: string;
    note?: string;
  }) => api.post<{ account: Account }>('/api/accounts', body),

  detail: (id: string) => api.get<{ account: Account }>(`/api/accounts/${id}`),

  update: (id: string, body: Record<string, unknown>) =>
    api.patch<{ account: Account; warning?: string }>(`/api/accounts/${id}`, body),

  archive: (id: string) => api.post<{ archived: boolean }>(`/api/accounts/${id}/archive`),

  unarchive: (id: string) => api.post<{ archived: boolean }>(`/api/accounts/${id}/unarchive`),

  remove: (id: string) => api.delete<{ archived: boolean }>(`/api/accounts/${id}`),

  balance: (id: string) => api.get<BalanceInfo>(`/api/accounts/${id}/balance`),

  balanceHistory: (id: string, from: string, to: string) =>
    api.get<BalanceHistory>(`/api/accounts/${id}/balance-history?from=${from}&to=${to}`),

  transactions: (id: string, page = 1, pageSize = 20) =>
    api.get<{ transactions: AccountTransaction[]; pagination: { total: number; totalPages: number } }>(
      `/api/accounts/${id}/transactions?page=${page}&pageSize=${pageSize}`,
    ),

  reconcile: (id: string, body: { statementBalance: string; reconciledAt: string; note?: string }) =>
    api.post<{ reconciliation: Reconciliation; suggestion: string | null }>(
      `/api/accounts/${id}/reconcile`,
      body,
    ),

  reconciliations: (id: string) =>
    api.get<{ reconciliations: Reconciliation[] }>(`/api/accounts/${id}/reconciliations`),
};
