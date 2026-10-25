import { api } from './client';

export type AssetClass = 'stock' | 'etf' | 'fund' | 'bond' | 'cash' | 'other';
export type TradeKind = 'buy' | 'sell' | 'dividend' | 'interest' | 'fee' | 'tax';
export type CashflowKind = 'deposit' | 'withdraw';
export type PortfolioStatus = 'active' | 'archived';
export type AllocationDimension = 'asset_class' | 'instrument' | 'currency';
export type PerformanceReason =
  | 'insufficient_data'
  | 'missing_valuation'
  | 'zero_start_value'
  | 'no_cashflow_sign_change'
  | 'not_converged';

export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  note: string | null;
  createdAt: string;
  latestPrice: { price: string; priceDate: string } | null;
}

export interface InstrumentPrice {
  id: string;
  /** DECIMAL(20,8) 定长字符串，展示用 formatPrice（8 位），不要用 formatNumber */
  price: string;
  priceDate: string;
  source: 'manual' | 'imported' | 'provider';
  note: string | null;
}

export interface PortfolioListItem {
  id: string;
  name: string;
  currency: string;
  accountId: string;
  accountName: string;
  status: PortfolioStatus;
  note: string | null;
  version: number;
  marketValue: string | null;
  cash: string | null;
  portfolioValue: string | null;
  totalPnl: string | null;
  priceDate: string | null;
  stale: boolean;
  isComplete: boolean;
}

export interface PortfolioDetail {
  portfolio: {
    id: string;
    name: string;
    currency: string;
    accountId: string;
    accountName: string;
    costBasisMethod: string;
    status: PortfolioStatus;
    version: number;
    note: string | null;
  };
  cash: string;
  marketValue: string;
  portfolioValue: string;
  totalCost: string;
  unrealizedPnl: string | null;
  realizedPnl: string;
  dividends: string;
  interest: string;
  totalPnl: string;
  priceDate: string | null;
  stale: boolean;
  isComplete: boolean;
  missingPrices: Array<{ instrumentId: string; symbol: string; name: string }>;
  positionCount: number;
}

export interface Holding {
  instrumentId: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: string;
  averageCost: string | null;
  totalCost: string;
  price: string | null;
  priceDate: string | null;
  stale: boolean;
  marketValue: string;
  unrealizedPnl: string | null;
  unrealizedRatio: string | null;
  weight: string | null;
  realizedPnl: string;
}

export interface HoldingsResponse {
  portfolio: {
    id: string;
    name: string;
    currency: string;
    accountId: string;
    costBasisMethod: string;
    status: PortfolioStatus;
    version: number;
    note: string | null;
  };
  holdings: Holding[];
  totals: {
    marketValue: string;
    cash: string;
    portfolioValue: string;
    totalCost: string;
    totalPnl: string;
  };
  isComplete: boolean;
  missingPrices: Array<{ instrumentId: string; symbol: string; name: string }>;
  valuationDate: string | null;
  stale: boolean;
}

export interface PortfolioTrade {
  id: string;
  portfolioId: string;
  portfolioName: string;
  instrumentId: string | null;
  symbol: string | null;
  instrumentName: string | null;
  kind: TradeKind;
  tradeDate: string;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  tax: string;
  transactionId: string | null;
  note: string | null;
  voided: boolean;
  version: number;
}

export interface Cashflow {
  id: string;
  kind: CashflowKind;
  flowDate: string;
  amount: string;
  transactionId: string | null;
  note: string | null;
}

export interface RealizedGain {
  tradeId: string;
  instrumentId: string | null;
  symbol: string;
  name: string;
  tradeDate: string;
  quantity: string;
  sellPrice: string | null;
  averageCost: string | null;
  proceeds: string;
  cost: string;
  fee: string;
  tax: string;
  realizedPnl: string;
  realizedRatio: string | null;
}

export interface ReturnsResponse {
  twr: {
    value: string | null;
    reason: PerformanceReason | null;
    segments: Array<{
      from: string;
      to: string;
      startValue: string;
      endValue: string;
      netFlow: string;
      return: string | null;
    }>;
  };
  xirr: {
    value: string | null;
    reason: PerformanceReason | null;
    cashflows: Array<{ date: string; amount: string; kind: 'deposit' | 'withdraw' | 'terminal' }>;
  };
  period: { from: string; to: string };
  isComplete: boolean;
  missingValuations: string[];
}

export interface PerformanceResponse {
  points: Array<{
    date: string;
    value: string;
    index: string | null;
    complete: boolean;
    /** 该点市值来自重算，还是被手工估值快照接管 */
    valuationSource: 'computed' | 'manual_snapshot';
    snapshotDate: string | null;
  }>;
  granularity: 'day' | 'week' | 'month';
  downgraded: boolean;
  period: { from: string; to: string };
  isComplete: boolean;
  missingValuations: string[];
}

export interface PortfolioValuationRecord {
  id: string;
  valuationDate: string;
  marketValue: string;
  source: 'computed' | 'manual';
  note: string | null;
}

export interface AllocationItem {
  key: string;
  label: string;
  value: string;
  weight: string | null;
}

export interface AllocationResponse {
  assetClass: { dimension: string; items: AllocationItem[]; total: string };
  instrument: { dimension: string; items: AllocationItem[]; total: string };
  currency: { dimension: string; items: AllocationItem[]; total: string };
}

export interface TargetItem {
  key: string;
  targetWeight: string;
}

export interface TargetsResponse {
  items: Array<{ dimension: AllocationDimension; targets: TargetItem[] }>;
}

export interface DriftItem {
  key: string;
  label: string;
  targetWeight: string;
  currentWeight: string;
  drift: string;
  action: 'buy' | 'sell' | 'none';
}

export interface DriftResponse {
  dimension: AllocationDimension;
  items: DriftItem[];
  threshold: string;
}

export interface RebalanceResponse {
  dimension: AllocationDimension;
  totalValue: string;
  suggestions: Array<{
    key: string;
    label: string;
    action: 'buy' | 'sell' | 'none';
    amount: string;
    quantity: string | null;
    price: string | null;
  }>;
  note: string | null;
}

export interface RiskSummary {
  positionCount: number;
  maxWeight: string | null;
  maxWeightLabel: string | null;
  topThreeWeight: string | null;
  concentrationWarning: boolean;
  concentrationKeys: string[];
  byAssetClass: Array<{ key: string; weight: string | null }>;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}

export const portfoliosApi = {
  list: (status?: 'active' | 'archived' | 'all') =>
    api.get<{ items: PortfolioListItem[] }>(`/api/portfolios${query({ status })}`),

  detail: (id: string) => api.get<PortfolioDetail>(`/api/portfolios/${id}`),

  create: (body: { accountId: string; name: string; note?: string | null }) =>
    api.post<{ id: string }>('/api/portfolios', body),

  update: (
    id: string,
    body: { version: number; name?: string; note?: string | null },
  ) => api.patch<{ id: string }>(`/api/portfolios/${id}`, body),

  archive: (id: string) => api.post<{ archived: boolean }>(`/api/portfolios/${id}/archive`, {}),

  holdings: (id: string) => api.get<HoldingsResponse>(`/api/portfolios/${id}/holdings`),

  summary: (id: string) =>
    api.get<{
      marketValue: string;
      cash: string;
      portfolioValue: string;
      totalCost: string;
      unrealizedPnl: string | null;
      realizedPnl: string;
      dividends: string;
      interest: string;
      totalPnl: string;
      positionCount: number;
      priceDate: string | null;
      stale: boolean;
      isComplete: boolean;
      missingPrices: Array<{ instrumentId: string; symbol: string; name: string }>;
    }>(`/api/portfolios/${id}/summary`),

  realizedGains: (id: string, params: { from?: string; to?: string } = {}) =>
    api.get<{
      items: RealizedGain[];
      totals: { proceeds: string; cost: string; realizedPnl: string; fee: string; tax: string };
      period: { from: string | null; to: string | null };
    }>(`/api/portfolios/${id}/realized-gains${query(params)}`),

  income: (id: string) =>
    api.get<{ dividends: string; interest: string; total: string }>(`/api/portfolios/${id}/income`),

  cashflows: (id: string) =>
    api.get<{ items: Cashflow[] }>(`/api/portfolios/${id}/cashflows`),

  addCashflow: (
    id: string,
    body: { kind: CashflowKind; flowDate: string; amount: string; note?: string | null },
  ) => api.post<{ id: string }>(`/api/portfolios/${id}/cashflows`, body),

  removeCashflow: (id: string, cashflowId: string) =>
    api.delete<{ deleted: boolean }>(`/api/portfolios/${id}/cashflows/${cashflowId}`),

  returns: (id: string, params: { from?: string; to?: string } = {}) =>
    api.get<ReturnsResponse>(`/api/portfolios/${id}/returns${query(params)}`),

  performance: (id: string, params: { from?: string; to?: string } = {}) =>
    api.get<PerformanceResponse>(`/api/portfolios/${id}/performance${query(params)}`),

  valuations: (id: string) =>
    api.get<{ items: PortfolioValuationRecord[] }>(`/api/portfolios/${id}/valuations`),

  addValuation: (
    id: string,
    body: { valuationDate: string; marketValue: string; note?: string | null; overwrite?: boolean },
  ) => api.post<PortfolioValuationRecord>(`/api/portfolios/${id}/valuations`, body),

  removeValuation: (id: string, valuationId: string) =>
    api.delete<{ deleted: boolean }>(`/api/portfolios/${id}/valuations/${valuationId}`),

  allocation: (id: string) => api.get<AllocationResponse>(`/api/portfolios/${id}/allocation`),

  targets: (id: string) => api.get<TargetsResponse>(`/api/portfolios/${id}/targets`),

  saveTargets: (
    id: string,
    body: { dimension: AllocationDimension; targets: TargetItem[] },
  ) => api.put<TargetsResponse>(`/api/portfolios/${id}/targets`, body),

  drift: (id: string, dimension: AllocationDimension) =>
    api.get<DriftResponse>(`/api/portfolios/${id}/drift${query({ dimension })}`),

  rebalancePreview: (
    id: string,
    body: { dimension?: AllocationDimension; amount?: string },
  ) => api.post<RebalanceResponse>(`/api/portfolios/${id}/rebalance-preview`, body),

  riskSummary: (id: string) => api.get<RiskSummary>(`/api/portfolios/${id}/risk-summary`),
};

export const instrumentsApi = {
  list: (params: { assetClass?: AssetClass; q?: string } = {}) =>
    api.get<{ items: Instrument[] }>(`/api/instruments${query(params)}`),

  detail: (id: string) => api.get<Instrument>(`/api/instruments/${id}`),

  create: (body: {
    symbol: string;
    name: string;
    assetClass: AssetClass;
    currency: string;
    note?: string | null;
  }) => api.post<Instrument>('/api/instruments', body),

  update: (
    id: string,
    body: { name?: string; assetClass?: AssetClass; currency?: string; note?: string | null },
  ) => api.patch<Instrument>(`/api/instruments/${id}`, body),

  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/instruments/${id}`),

  prices: (id: string, params: { from?: string; to?: string } = {}) =>
    api.get<{ items: InstrumentPrice[] }>(`/api/instruments/${id}/prices${query(params)}`),

  addPrice: (id: string, body: { priceDate: string; price: string; note?: string | null }) =>
    api.post<{ id: string; created: boolean }>(`/api/instruments/${id}/prices`, body),

  removePrice: (id: string, priceId: string) =>
    api.delete<{ deleted: boolean }>(`/api/instruments/${id}/prices/${priceId}`),
};

export const tradesApi = {
  list: (
    params: {
      portfolioId?: string;
      instrumentId?: string;
      kind?: TradeKind;
      from?: string;
      to?: string;
      includeVoided?: boolean;
    } = {},
  ) =>
    api.get<{ items: PortfolioTrade[]; timezone: string }>(
      `/api/portfolio-trades${query({
        ...params,
        includeVoided: params.includeVoided === undefined ? undefined : String(params.includeVoided),
      })}`,
    ),

  create: (body: {
    portfolioId: string;
    instrumentId?: string | null;
    kind: TradeKind;
    tradeDate: string;
    quantity?: string | null;
    price?: string | null;
    amount?: string;
    fee?: string;
    tax?: string;
    categoryId?: string | null;
    note?: string | null;
  }) => api.post<{ id: string }>('/api/portfolio-trades', body),

  update: (
    id: string,
    body: {
      version: number;
      tradeDate?: string;
      quantity?: string;
      price?: string;
      amount?: string;
      fee?: string;
      tax?: string;
      note?: string | null;
    },
  ) => api.patch<{ id: string }>(`/api/portfolio-trades/${id}`, body),

  remove: (id: string) => api.delete<{ voided: boolean }>(`/api/portfolio-trades/${id}`),
};
