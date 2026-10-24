import { api } from './client';

export type LiabilityKind = 'mortgage' | 'consumer_loan' | 'auto_loan' | 'credit_line' | 'other';
export type LiabilityStatus = 'active' | 'archived';

export interface LiabilitySnapshot {
  id: string;
  snapshotDate: string;
  balance: string;
  note: string | null;
  createdAt: string;
}

export interface Liability {
  id: string;
  name: string;
  kind: LiabilityKind;
  currency: string;
  /** 原始本金与利率仅作参考，不参与任何计算 */
  originalAmount: string | null;
  startDate: string | null;
  interestRate: string | null;
  note: string | null;
  status: LiabilityStatus;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  snapshotCount: number;
  latestSnapshot: { id: string; snapshotDate: string; balance: string } | null;
  stale: boolean;
}

export interface LiabilityDetail extends Omit<Liability, 'snapshotCount'> {
  updatedAt: string;
  snapshots: LiabilitySnapshot[];
}

export interface LiabilitySummary {
  total: string;
  baseCurrency: string;
  byKind: Array<{ kind: LiabilityKind; amount: string }>;
  byCurrency: Array<{ currency: string; amount: string }>;
  unpriced: Array<{ id: string; name: string; reason: string }>;
  missingRate: Array<{ id: string; name: string; currency: string }>;
  basis: { asOf: string; baseCurrency: string };
}

export interface LiabilityInput {
  name: string;
  kind: LiabilityKind;
  currency: string;
  originalAmount?: string | null;
  startDate?: string | null;
  interestRate?: string | null;
  note?: string | null;
}

export const liabilitiesApi = {
  list: (params: { status?: 'active' | 'archived' | 'all'; kind?: LiabilityKind } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.kind) query.set('kind', params.kind);
    const suffix = query.toString();
    return api.get<{ liabilities: Liability[] }>(`/api/liabilities${suffix ? `?${suffix}` : ''}`);
  },
  summary: () => api.get<LiabilitySummary>('/api/liabilities/summary'),
  detail: (id: string) => api.get<{ liability: LiabilityDetail }>(`/api/liabilities/${id}`),
  create: (input: LiabilityInput) => api.post<{ liability: Liability }>('/api/liabilities', input),
  update: (id: string, input: Partial<LiabilityInput> & { version: number }) =>
    api.patch<{ liability: Liability }>(`/api/liabilities/${id}`, input),
  archive: (id: string) => api.delete<{ archived: boolean }>(`/api/liabilities/${id}`),
  snapshots: (id: string) =>
    api.get<{ snapshots: LiabilitySnapshot[] }>(`/api/liabilities/${id}/balance-snapshots`),
  addSnapshot: (
    id: string,
    input: { snapshotDate: string; balance: string; note?: string | null; overwrite?: boolean },
  ) => api.post<{ snapshot: LiabilitySnapshot }>(`/api/liabilities/${id}/balance-snapshots`, input),
  removeSnapshot: (id: string, snapshotId: string) =>
    api.delete<{ deleted: boolean }>(`/api/liabilities/${id}/balance-snapshots/${snapshotId}`),
};
