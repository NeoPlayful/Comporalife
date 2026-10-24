import { api } from './client';

export interface CompoundParams {
  principal: string;
  contributionAmount: string;
  contributionFrequency: 'none' | 'monthly' | 'annual';
  contributionTiming: 'begin' | 'end';
  annualReturnRate: string;
  years: number;
  inflationRate: string;
  feeRate: string;
  // v2 进阶参数：全部可选，缺省与旧口径一致
  annualContributionIncrease?: string;
  withdrawalAmount?: string;
  withdrawalFrequency?: 'none' | 'monthly' | 'annual';
  withdrawalStartYear?: number;
  taxRate?: string;
}

export interface SolveResult {
  solveFor: 'contribution' | 'years';
  requiredContribution?: string;
  requiredYears?: number;
  contributionAmount?: string;
  years?: number;
  targetAmount: string;
  actualValue: string;
  difference: string;
  iterations: number;
}

export interface YearlyRow {
  year: number;
  contributedThisYear: string;
  totalContributed: string;
  nominalValue: string;
  realValue: string;
  cumulativeGain: string;
}

export interface CompoundResult {
  totalContributed: string;
  finalNominalValue: string;
  totalGain: string;
  finalRealValue: string;
  effectiveAnnualReturn: string;
  modelVersion: string;
  assumptions: Record<string, string | number>;
  yearlySchedule: YearlyRow[];
}

export interface Scenario extends CompoundParams {
  id: string;
  name: string;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface Comparison {
  label: string;
  finalNominalValue: string;
  totalContributed: string;
  totalGain: string;
  yearSeries: Array<{ year: number; nominalValue: string }>;
}

export const simulationsApi = {
  calculate: (params: CompoundParams) =>
    api.post<{ result: CompoundResult; input: CompoundParams }>(
      '/api/simulations/compound/calculate',
      params,
    ),

  list: () => api.get<{ scenarios: Scenario[] }>('/api/simulations/compound'),

  detail: (id: string) =>
    api.get<{ scenario: Scenario; result: CompoundResult }>(`/api/simulations/compound/${id}`),

  save: (body: CompoundParams & { name: string }) =>
    api.post<{ scenario: Scenario }>('/api/simulations/compound', body),

  update: (id: string, body: Partial<CompoundParams> & { name?: string }) =>
    api.patch<{ scenario: Scenario; result: CompoundResult }>(`/api/simulations/compound/${id}`, body),

  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/simulations/compound/${id}`),

  duplicate: (id: string) =>
    api.post<{ scenario: Scenario }>(`/api/simulations/compound/${id}/duplicate`),

  solve: (body: CompoundParams & { targetAmount: string; solveFor: 'contribution' | 'years' }) =>
    api.post<SolveResult>('/api/simulations/compound/solve', body),
  compare: (body: { scenarioIds?: string[]; params?: CompoundParams[] }) =>
    api.post<{ comparisons: Comparison[] }>('/api/simulations/compound/compare', body),
};

export const DEFAULT_PARAMS: CompoundParams = {
  principal: '10000',
  contributionAmount: '500',
  contributionFrequency: 'monthly',
  contributionTiming: 'end',
  annualReturnRate: '0.07',
  years: 20,
  inflationRate: '0.025',
  feeRate: '0',
};
