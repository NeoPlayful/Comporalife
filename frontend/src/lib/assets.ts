import { api } from './client';

export type AssetKind = 'property' | 'vehicle' | 'collectible' | 'other';
export type AssetStatus = 'active' | 'archived';
export type ValuationBasis = 'manual' | 'appraised' | 'market';

export interface AssetValuation {
  id: string;
  valuationDate: string;
  value: string;
  basis: ValuationBasis;
  note: string | null;
  createdAt: string;
}

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  currency: string;
  /** 购置价仅作参考，不参与净资产 */
  purchaseDate: string | null;
  purchasePrice: string | null;
  note: string | null;
  status: AssetStatus;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  valuationCount: number;
  latestValuation: { id: string; valuationDate: string; value: string; basis: ValuationBasis } | null;
  stale: boolean;
}

export interface AssetDetail extends Omit<Asset, 'valuationCount'> {
  updatedAt: string;
  valuations: AssetValuation[];
}

export interface AssetSummary {
  total: string;
  baseCurrency: string;
  byKind: Array<{ kind: AssetKind; amount: string }>;
  byCurrency: Array<{ currency: string; amount: string }>;
  unpriced: Array<{ id: string; name: string; reason: string }>;
  missingRate: Array<{ id: string; name: string; currency: string }>;
  basis: { asOf: string; baseCurrency: string };
}

export interface AssetInput {
  name: string;
  kind: AssetKind;
  currency: string;
  purchaseDate?: string | null;
  purchasePrice?: string | null;
  note?: string | null;
}

export const assetsApi = {
  list: (params: { status?: 'active' | 'archived' | 'all'; kind?: AssetKind } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.kind) query.set('kind', params.kind);
    const suffix = query.toString();
    return api.get<{ assets: Asset[] }>(`/api/assets${suffix ? `?${suffix}` : ''}`);
  },
  summary: () => api.get<AssetSummary>('/api/assets/summary'),
  detail: (id: string) => api.get<{ asset: AssetDetail }>(`/api/assets/${id}`),
  create: (input: AssetInput) => api.post<{ asset: Asset }>('/api/assets', input),
  update: (id: string, input: Partial<AssetInput> & { version: number }) =>
    api.patch<{ asset: Asset }>(`/api/assets/${id}`, input),
  archive: (id: string) => api.delete<{ archived: boolean }>(`/api/assets/${id}`),
  valuations: (id: string) => api.get<{ valuations: AssetValuation[] }>(`/api/assets/${id}/valuations`),
  addValuation: (
    id: string,
    input: { valuationDate: string; value: string; basis?: ValuationBasis; note?: string | null; overwrite?: boolean },
  ) => api.post<{ valuation: AssetValuation }>(`/api/assets/${id}/valuations`, input),
  removeValuation: (id: string, valuationId: string) =>
    api.delete<{ deleted: boolean }>(`/api/assets/${id}/valuations/${valuationId}`),
};
