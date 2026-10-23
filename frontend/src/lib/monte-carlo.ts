import { api } from './client';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type RunStage = 'preparing' | 'simulating' | 'aggregating' | 'finalizing';
export type RebalanceFrequency = 'none' | 'monthly' | 'quarterly' | 'annual';
export type Frequency = 'none' | 'monthly' | 'annual';
export type Timing = 'begin' | 'end';
export type StressPresetKey = 'crash' | 'stagflation' | 'lost_decade';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type SuggestionNote =
  | 'no_holdings'
  | 'insufficient_history'
  | 'samples_below_1_year'
  | 'samples_below_3_years'
  | 'correlation_requires_manual_input';

/** 请求侧：金额与比率统一用字符串，避免 JSON 数字精度损失 */
export interface ScenarioAssetInput {
  key: string;
  label: string;
  weight: string;
  expectedAnnualReturn: string;
  annualVolatility: string;
}

export interface ScenarioSettingsInput {
  initialValue: string;
  contribution: { amount: string; frequency: Frequency; timing: Timing };
  withdrawal: { amount: string; frequency: Frequency; startYear: number };
  inflationRate: string;
  feeRate: string;
  targetAmount: string | null;
}

export interface ScenarioBody {
  name?: string;
  currency?: string;
  years: number;
  pathCount: number;
  rebalance: RebalanceFrequency;
  assets: ScenarioAssetInput[];
  correlation: number[][];
  settings: ScenarioSettingsInput;
  note?: string | null;
}

export interface Scenario {
  id: string;
  name: string;
  currency: string;
  years: number;
  pathCount: number;
  rebalance: RebalanceFrequency;
  returnModel: 'lognormal';
  assets: ScenarioAssetInput[];
  correlation: number[][];
  settings: ScenarioSettingsInput;
  modelVersion: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  runs?: RunSummary[];
}

export interface RunSummary {
  id: string;
  scenarioId?: string;
  status: RunStatus;
  stage: RunStage | null;
  progress: string;
  /** 创建运行时的响应里带队列位置，历史列表里不带 */
  queuePosition?: number;
  seed?: number;
  pathCount?: number;
  years?: number;
  modelVersion?: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  failureCode?: string | null;
  failureMessage?: string | null;
}

export interface ScenarioListItem {
  id: string;
  name: string;
  currency: string;
  years: number;
  pathCount: number;
  rebalance: RebalanceFrequency;
  updatedAt: string;
  latestRun: RunSummary | null;
}

export interface RunDetail {
  id: string;
  scenarioId: string;
  scenarioName: string;
  status: RunStatus;
  stage: RunStage | null;
  progress: string;
  queuePosition: number;
  attempts: number;
  seed: number;
  pathCount: number;
  years: number;
  modelVersion: string;
  createdAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface QuantileSet {
  p5: string;
  p10: string;
  p25: string;
  p50: string;
  p75: string;
  p90: string;
  p95: string;
  mean: string;
  sd: string;
}

export interface SimulationResult {
  terminal: { nominal: QuantileSet; real: QuantileSet };
  contributed: { nominal: QuantileSet; real: QuantileSet };
  standardError: string;
  probabilities: {
    loss: string;
    realLoss: string;
    target: string | null;
    ruin: string;
  };
  drawdown: { p50: string; p90: string; p99: string; mean: string };
  yearlyBands: Array<{ year: number; p10: string; p25: string; p50: string; p75: string; p90: string }>;
  histogram: { min: string; max: string; bins: number[] };
  deterministic: boolean;
}

export interface Assumptions {
  returnModel: 'lognormal';
  modelVersion: string;
  seed: number;
  pathCount: number;
  years: number;
  rebalance: RebalanceFrequency;
  assets: ScenarioAssetInput[];
  correlation: string[][];
  initialValue: string;
  contribution: { amount: string; frequency: Frequency; timing: Timing };
  withdrawal: { amount: string; frequency: Frequency; startYear: number };
  inflationRate: string;
  feeRate: string;
  targetAmount: string | null;
  stressPreset: StressPresetKey | null;
}

export interface RunResultResponse {
  runId: string;
  status: RunStatus;
  result: SimulationResult;
  assumptions: Assumptions;
}

export interface PreviewResponse {
  seed: number;
  pathCount: number;
  terminal: { nominal: QuantileSet; real: QuantileSet };
  probabilities: { loss: string; realLoss: string; target: string | null; ruin: string };
  standardError: string;
}

export interface SamplePathResponse {
  resolution: 'monthly' | 'yearly';
  paths: Array<{ index: number; values: string[] }>;
}

export interface StressPreset {
  key: StressPresetKey;
  labelKey: string;
  descriptionKey: string;
  assumption: { annualReturn: number; inflationRate: number; shockMonths?: number };
}

export interface SuggestionAsset {
  key: string;
  label: string;
  weight: string;
  expectedAnnualReturn: string | null;
  annualVolatility: string | null;
}

export interface SuggestionResponse {
  portfolio: { id: string; name: string; currency: string };
  assets: SuggestionAsset[];
  correlation: null;
  history: { from: string | null; to: string | null; samples: number; frequency: 'daily' };
  confidence: ConfidenceLevel;
  notes: SuggestionNote[];
}

export interface CompareItem {
  runId: string | null;
  scenarioName: string;
  runStatus: RunStatus | 'missing';
  seed: number | null;
  pathCount: number | null;
  years: number;
  result: SimulationResult | null;
}

export const monteCarloApi = {
  list: () => api.get<{ items: ScenarioListItem[] }>('/api/simulations/monte-carlo'),
  get: (id: string) => api.get<Scenario>(`/api/simulations/monte-carlo/${id}`),
  create: (body: ScenarioBody) => api.post<Scenario>('/api/simulations/monte-carlo', body),
  update: (id: string, body: Partial<ScenarioBody>) =>
    api.patch<Scenario>(`/api/simulations/monte-carlo/${id}`, body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/simulations/monte-carlo/${id}`),
  duplicate: (id: string, name: string) =>
    api.post<Scenario>(`/api/simulations/monte-carlo/${id}/duplicate`, { name }),

  preview: (body: Omit<ScenarioBody, 'name' | 'currency' | 'note'> & { seed?: number }) =>
    api.post<PreviewResponse>('/api/simulations/monte-carlo/calculate', body),

  createRun: (
    scenarioId: string,
    body: { pathCount?: number; seed?: number; stressPreset?: StressPresetKey },
  ) => api.post<RunSummary>(`/api/simulations/monte-carlo/${scenarioId}/runs`, body),

  listRuns: (scenarioId: string, limit = 20) =>
    api.get<{ items: RunSummary[] }>(`/api/simulations/monte-carlo/${scenarioId}/runs?limit=${limit}`),

  getRun: (scenarioId: string, runId: string) =>
    api.get<{ run: RunDetail; assumptions: Assumptions }>(
      `/api/simulations/monte-carlo/${scenarioId}/runs/${runId}`,
    ),

  getResult: (scenarioId: string, runId: string) =>
    api.get<RunResultResponse>(`/api/simulations/monte-carlo/${scenarioId}/runs/${runId}/results`),

  getPaths: (
    scenarioId: string,
    runId: string,
    options: { count?: number; resolution?: 'monthly' | 'yearly'; indexes?: string },
  ) => {
    const params = new URLSearchParams();
    if (options.count !== undefined) params.set('count', String(options.count));
    if (options.resolution) params.set('resolution', options.resolution);
    if (options.indexes) params.set('indexes', options.indexes);

    return api.get<SamplePathResponse>(
      `/api/simulations/monte-carlo/${scenarioId}/runs/${runId}/paths?${params.toString()}`,
    );
  },

  cancelRun: (scenarioId: string, runId: string) =>
    api.post<{ id: string; status: RunStatus }>(
      `/api/simulations/monte-carlo/${scenarioId}/runs/${runId}/cancel`,
      {},
    ),

  compare: (body: { runIds?: string[]; scenarioIds?: string[] }) =>
    api.post<CompareItem[]>('/api/simulations/monte-carlo/compare', body),

  presets: () => api.get<{ presets: StressPreset[] }>('/api/simulations/monte-carlo/presets'),

  suggestions: (portfolioId: string) =>
    api.get<SuggestionResponse>(`/api/simulations/monte-carlo/suggestions?portfolioId=${portfolioId}`),
};
