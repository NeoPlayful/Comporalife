import { api } from './client';

export type TransactionType = 'income' | 'expense' | 'transfer' | 'adjustment';

export interface TransactionEntry {
  accountId: string | null;
  accountName: string | null;
  amount: string;
  currency: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  occurredAt: string;
  description: string;
  merchant: string | null;
  note: string | null;
  status: 'posted' | 'voided';
  version: number;
  voidedAt: string | null;
  source: 'manual' | 'import';
  importBatchId: string | null;
  category: { id: string; name: string; kind: string } | null;
  tags: Array<{ id: string; name: string }>;
  amount: string;
  currency: string;
  account: { name: string; type: string } | null;
  entries: TransactionEntry[];
}

export interface TransactionListParams {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  type?: TransactionType;
  status?: 'posted' | 'voided' | 'all';
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: '收入',
  expense: '支出',
  transfer: '转账',
  adjustment: '调整',
};

export const transactionsApi = {
  list: (params: TransactionListParams = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString() ? `?${query}` : '';
    return api.get<{
      transactions: Transaction[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/api/transactions${suffix}`);
  },

  detail: (id: string) => api.get<{ transaction: Transaction }>(`/api/transactions/${id}`),

  create: (body: {
    type: 'income' | 'expense' | 'adjustment';
    accountId: string;
    categoryId?: string | null;
    amount: string;
    occurredAt: string;
    description: string;
    merchant?: string;
    note?: string;
    tagIds?: string[];
  }) => api.post<{ transaction: Transaction }>('/api/transactions', body),

  update: (id: string, body: Record<string, unknown>) =>
    api.patch<{ transaction: Transaction }>(`/api/transactions/${id}`, body),

  void: (id: string) => api.delete<{ voided: boolean }>(`/api/transactions/${id}`),

  entries: (id: string) =>
    api.get<{
      entries: Array<{
        id: string;
        accountId: string | null;
        accountName: string | null;
        amount: string;
        currency: string;
        description: string;
      }>;
      balanced: boolean;
    }>(`/api/transactions/${id}/entries`),

  bulkCategorize: (transactionIds: string[], categoryId: string | null) =>
    api.post<{ updated: number }>('/api/transactions/bulk-categorize', { transactionIds, categoryId }),

  bulkUpdate: (body: { transactionIds: string[]; note?: string | null; addTagIds?: string[] }) =>
    api.post<{ updated: number }>('/api/transactions/bulk-update', body),
};

export const transfersApi = {
  create: (body: {
    fromAccountId: string;
    toAccountId: string;
    amount: string;
    occurredAt: string;
    description?: string;
    note?: string;
  }) => api.post<{ transaction: Transaction }>('/api/transfers', body),

  list: () => api.get<{ transfers: Transaction[] }>('/api/transfers'),

  void: (id: string) => api.delete<{ voided: boolean }>(`/api/transfers/${id}`),
};
