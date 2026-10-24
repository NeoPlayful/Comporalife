import { api } from './client';

export type GoalType =
  | 'savings'
  | 'purchase'
  | 'education'
  | 'retirement'
  | 'emergency_fund'
  | 'financial_independence'
  | 'custom';

export type GoalFundingSource = 'net_worth' | 'account' | 'portfolio';
export type GoalStatus = 'active' | 'achieved' | 'archived';
export type ReportType =
  | 'net_worth'
  | 'cashflow'
  | 'analytics'
  | 'investment'
  | 'goals'
  | 'simulation';

export interface GoalFundingView {
  source: GoalFundingSource;
  accountId: string | null;
  portfolioId: string | null;
  available: boolean;
  unavailableReason: string | null;
}

export interface GoalProgress {
  asOf: string;
  currentAmount: string | null;
  targetAmount: string;
  originalTargetAmount: string;
  progress: string | null;
  gap: string | null;
  isAchieved: boolean;
  achievedAt: string | null;
  monthsRemaining: number | null;
  funding: GoalFundingView;
}

export interface GoalListItem extends GoalProgress {
  id: string;
  name: string;
  type: GoalType;
  currency: string;
  status: GoalStatus;
  priority: number;
  targetDate: string | null;
}

export interface GoalDetail {
  goal: {
    id: string;
    name: string;
    type: GoalType;
    currency: string;
    status: GoalStatus;
    priority: number;
    targetDate: string | null;
    startedAt: string;
    initialAmount: string;
    inflationAdjusted: boolean;
    inflationRate: string | null;
    expectedAnnualReturn: string | null;
    monthlyContribution: string | null;
    fundingSource: GoalFundingSource;
    accountId: string | null;
    portfolioId: string | null;
    note: string | null;
    achievedAt: string | null;
  };
  progress: GoalProgress;
}

export interface GoalSummaryData {
  activeCount: number;
  totalTarget: string;
  totalCurrent: string;
  totalGap: string;
  requiredMonthlyTotal: string;
  investableSurplus: string | null;
  shortfall: string | null;
  surplusBasis: { months: number; source: string; isComplete: boolean };
  currency: string;
  unavailableGoalIds: string[];
}

export interface GoalHistoryPoint {
  asOf: string;
  currentAmount: string;
  progress: string;
  isAchieved: boolean;
}

export interface GoalHistory {
  goalId: string;
  asOf: string;
  points: GoalHistoryPoint[];
  firstAchievedAt: string | null;
  truncated: boolean;
  granularity: 'month_end';
  note: string;
}

export interface GoalProjection {
  goalId: string;
  asOf: string;
  targetAmount: string;
  currentAmount: string | null;
  deterministic: {
    projectedValue: string;
    requiredMonthly: string | null;
    etaMonths: number | null;
    etaDate: string | null;
    timeline: Array<{ month: string; value: string }>;
    feasible: boolean;
    basis: {
      engine: string;
      expectedAnnualReturn: string;
      monthlyContribution: string;
      inflationRate: string;
      feeRate: string;
      contributionTiming: string;
    };
  } | null;
  probabilistic: {
    runId: string;
    seed: number;
    pathCount: number;
    probability: string;
    p10: string;
    p50: string;
    p90: string;
    assumptionsDigest: string;
    matchedOn: 'target_amount_and_years';
  } | null;
  matchedExpected: { targetAmount: string; years: number; currency: string } | null;
  unavailableReasons: string[];
}

export interface FinancialIndependence {
  annualExpense: string | null;
  expenseBasis: { months: number; from: string; to: string; isComplete: boolean } | null;
  withdrawalRate: string;
  targetAssets: string | null;
  investableAssets: string | null;
  progress: string | null;
  coverageMonths: string | null;
  safetyMargin: string | null;
  sensitivity: {
    expenseScale: string[];
    withdrawalRates: string[];
    cells: Array<Array<{ targetAssets: string | null; progress: string | null }>>;
  } | null;
  unavailableReasons: string[];
  disclaimers: string[];
}

export interface GoalInput {
  name: string;
  type: GoalType;
  targetAmount: string;
  currency: string;
  targetDate?: string | null;
  startedAt: string;
  initialAmount?: string;
  inflationAdjusted?: boolean;
  inflationRate?: string | null;
  expectedAnnualReturn?: string | null;
  monthlyContribution?: string | null;
  fundingSource: GoalFundingSource;
  accountId?: string | null;
  portfolioId?: string | null;
  priority?: number;
  note?: string | null;
}

export interface ReportSummary {
  id: string;
  type: ReportType;
  title: string;
  rangeFrom: string;
  rangeTo: string;
  currency: string;
  rowCount: number;
  generatedAt: string;
  createdAt: string;
}

export interface ReportDetail extends ReportSummary {
  params: Record<string, unknown>;
  basis: {
    range: { from: string; to: string };
    currency: string;
    rateDates: string[];
    accountScope: { mode: string; accounts: number; excluded: string[] };
    completeness: {
      isComplete: boolean;
      missingMonths: string[];
      missingRates: string[];
      staleValuations: Array<{ portfolioId: string; priceDate: string | null }>;
      unpricedSymbols: string[];
    };
    modelVersions: Record<string, string>;
    generatedAt: string;
    notes: string[];
  };
  modelVersions: Record<string, string>;
}

export interface ReportData {
  reportId: string;
  type: ReportType;
  data: Record<string, unknown>;
  basis: ReportDetail['basis'];
  generatedAt: string;
}

export const goalsApi = {
  list: (params: { status?: GoalStatus; type?: GoalType } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.type) query.set('type', params.type);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return api.get<{ goals: GoalListItem[]; asOf: string }>(`/api/goals${suffix}`);
  },
  detail: (id: string) => api.get<GoalDetail>(`/api/goals/${id}`),
  create: (body: GoalInput) => api.post<{ id: string; name: string }>('/api/goals', body),
  update: (id: string, body: Partial<GoalInput> & { status?: GoalStatus }) =>
    api.patch<{ id: string; name: string }>(`/api/goals/${id}`, body),
  remove: (id: string) => api.delete<null>(`/api/goals/${id}`),
  progress: (id: string) => api.get<GoalProgress>(`/api/goals/${id}/progress`),
  history: (id: string, months?: number) => {
    const suffix = months ? `?months=${months}` : '';
    return api.get<GoalHistory>(`/api/goals/${id}/history${suffix}`);
  },
  summary: () => api.get<GoalSummaryData>('/api/goals/summary'),
  projection: (
    id: string,
    body: {
      expectedAnnualReturn?: string;
      monthlyContribution?: string;
      feeRate?: string;
      includeProbabilistic?: boolean;
    } = {},
  ) => api.post<GoalProjection>(`/api/goals/${id}/projection`, body),
};

export const financialIndependenceApi = {
  overview: () => api.get<FinancialIndependence>('/api/financial-independence/overview'),
  calculate: (body: { annualExpense?: string; withdrawalRate?: string }) =>
    api.post<FinancialIndependence>('/api/financial-independence/calculate', body),
};

export const reportsApi = {
  list: (type?: ReportType) => {
    const suffix = type ? `?type=${type}` : '';
    return api.get<{ reports: ReportSummary[] }>(`/api/reports${suffix}`);
  },
  create: (body: { type: ReportType; from: string; to: string; title?: string | null }) =>
    api.post<{ report: ReportSummary }>('/api/reports', body),
  build: (type: ReportType, body: { from: string; to: string; title?: string | null }) => {
    const path = `/api/reports/${type.replace(/_/g, '-')}`;
    return api.post<{ report: ReportSummary }>(path, body);
  },
  detail: (id: string) => api.get<{ report: ReportDetail }>(`/api/reports/${id}`),
  data: (id: string) => api.get<ReportData>(`/api/reports/${id}/data`),
  regenerate: (id: string) => api.post<{ report: ReportSummary }>(`/api/reports/${id}/regenerate`),
  remove: (id: string) => api.delete<null>(`/api/reports/${id}`),
  /** 下载走原生 fetch，必须带认证头；使用 Blob 触发保存 */
  downloadUrl: (id: string, format: 'csv' | 'xlsx') => `/api/reports/${id}/download?format=${format}`,
};

