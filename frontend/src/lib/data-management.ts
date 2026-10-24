import { api } from './client';

// ===== 数据质量 =====

export interface QualityMetric {
  key: string;
  count: number | null;
  rule: string;
  unavailableReason: string | null;
}

export interface QualitySummary {
  checkedAt: string;
  lookbackMonths: number;
  metrics: QualityMetric[];
  isComplete: boolean;
}

export interface UncategorizedItem {
  transactionId: string;
  occurredAt: string;
  description: string;
  merchant: string | null;
  amount: string;
  currency: string;
  accountId: string | null;
  accountName: string | null;
  type: string;
  daysOld: number;
}

export interface DuplicateItem {
  transactionId: string;
  accountId: string;
  accountName: string;
  occurredAt: string;
  description: string;
  amount: string;
  currency: string;
  conflictingTransactionId: string;
  conflictingOccurredAt: string;
  conflictingDescription: string;
  dayGap: number;
}

export interface MissingMonthsData {
  months: string[];
  accounts: Array<{ accountId: string; name: string; missing: string[] }>;
}

export interface StaleValuationItem {
  portfolioId: string;
  name: string;
  priceDate: string | null;
  daysStale: number | null;
  missingSymbols: string[];
}

export interface RateLagItem {
  from: string;
  to: string;
  latestDate: string | null;
  daysLag: number | null;
}

export interface AuditLogItem {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export const dataQualityApi = {
  summary: () => api.get<QualitySummary>('/api/data-quality/summary'),
  uncategorized: (params: { limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    return api.get<{ items: UncategorizedItem[]; total: number }>(`/api/data-quality/uncategorized?${query}`);
  },
  duplicates: (limit = 100) =>
    api.get<{ items: DuplicateItem[]; total: number; truncated: boolean }>(
      `/api/data-quality/duplicates?limit=${limit}`,
    ),
  missingMonths: (months = 12) =>
    api.get<MissingMonthsData>(`/api/data-quality/missing-months?months=${months}`),
  staleValuations: () =>
    api.get<{ items: StaleValuationItem[]; total: number }>('/api/data-quality/stale-valuations'),
  rateLag: () => api.get<{ items: RateLagItem[]; total: number }>('/api/data-quality/rate-lag'),
  recheck: () => api.post<{ taskId: string; status: string }>('/api/data-quality/recheck', {}),
};

export const auditApi = {
  list: (params: { page?: number; pageSize?: number; action?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.action) query.set('action', params.action);
    return api.get<{ items: AuditLogItem[] }>(`/api/audit-logs?${query}`);
  },
  detail: (id: string) => api.get<{ auditLog: AuditLogItem }>(`/api/audit-logs/${id}`),
};

// ===== 导出 =====

export type ExportScope = 'full' | 'ledger' | 'investments' | 'simulations' | 'planning' | 'settings';
export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';

export interface ExportRecord {
  id: string;
  scope: ExportScope;
  format: string;
  status: ExportStatus;
  rowCount: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  failureCode: string | null;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ExportDetail extends ExportRecord {
  params: Record<string, unknown>;
  manifest: {
    schemaVersion: string;
    files: Array<{ name: string; rows: number; bytes: number; sha256: string }>;
    totals: Record<string, number>;
    completeness: {
      isComplete: boolean;
      missingMonths: string[];
      staleValuations: number;
      rateLagPairs: string[];
      unpricedSymbols: string[];
    };
    excluded: string[];
    notes: string[];
  } | null;
}

export const exportsApi = {
  list: (params: { page?: number; scope?: ExportScope; status?: ExportStatus } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.scope) query.set('scope', params.scope);
    if (params.status) query.set('status', params.status);
    return api.get<{ exports: ExportRecord[] }>(`/api/exports?${query}`);
  },
  create: (body: { scope: ExportScope; from?: string; to?: string; includeArchived?: boolean }) =>
    api.post<
      | { exportId: string; status: 'ready'; rowCount: number; sizeBytes: number | null; expiresAt: string | null; async: false }
      | { exportId: string; taskId: string; status: 'queued'; async: true; estimatedRows: number }
    >('/api/exports', body),
  detail: (id: string) => api.get<{ export: ExportDetail }>(`/api/exports/${id}`),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/exports/${id}`),
  downloadUrl: (id: string) => `/api/exports/${id}/download`,
};

// ===== 备份与恢复 =====

export type BackupDomain =
  | 'accounts'
  | 'categories'
  | 'tags'
  | 'transactions'
  | 'entries'
  | 'budgets'
  | 'instruments'
  | 'portfolios'
  | 'trades'
  | 'portfolio_cashflows'
  | 'valuations'
  | 'simulation_scenarios'
  | 'goals'
  | 'reports'
  | 'settings';

export const BACKUP_DOMAINS: BackupDomain[] = [
  'accounts',
  'categories',
  'tags',
  'transactions',
  'entries',
  'budgets',
  'instruments',
  'portfolios',
  'trades',
  'portfolio_cashflows',
  'valuations',
  'simulation_scenarios',
  'goals',
  'reports',
  'settings',
];

export interface BackupRecord {
  id: string;
  format: string;
  schemaVersion: string;
  scope: Record<string, number>;
  sizeBytes: number;
  sha256: string;
  status: 'creating' | 'ready' | 'failed' | 'expired';
  restoreCount: number;
  lastRestoredAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface RestorePreview {
  backupId: string;
  schemaVersion: string;
  createdAt: string;
  domains: Array<{ domain: BackupDomain; insert: number; overwrite: number; conflict: number; skip: number }>;
  conflicts: Array<{ domain: string; key: string; reason: string }>;
  truncated: boolean;
  warnings: string[];
  requiresConfirm: string;
}

export const backupsApi = {
  list: (params: { page?: number } = {}) =>
    api.get<{ backups: BackupRecord[] }>(`/api/backups?page=${params.page ?? 1}`),
  create: () => api.post<{ backupId: string; taskId: string; status: string }>('/api/backups', {}),
  detail: (id: string) => api.get<{ backup: BackupRecord }>(`/api/backups/${id}`),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/backups/${id}`),
  preview: (id: string) =>
    api.post<{ preview: RestorePreview }>(`/api/backups/${id}/restore-preview`, {}),
  restore: (id: string, body: { domains: BackupDomain[]; conflict: 'skip' | 'overwrite'; confirm: string }) =>
    api.post<{
      backupId: string;
      domains: Array<{ domain: BackupDomain; written: number; skipped: number }>;
      restoreCount: number;
      lastRestoredAt: string | null;
    }>(`/api/backups/${id}/restore`, body),
  downloadUrl: (id: string) => `/api/backups/${id}/download`,
};

// ===== 任务 =====

export interface JobItem {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: string;
  stage: string | null;
  targetType: string | null;
  targetId: string | null;
  failureCode: string | null;
  failureMessage?: string | null;
  attempts?: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  source: 'task' | 'monte-carlo';
}

export const jobsApi = {
  list: (params: { kind?: string; status?: string; cursor?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.kind) query.set('kind', params.kind);
    if (params.status) query.set('status', params.status);
    if (params.cursor) query.set('cursor', params.cursor);
    query.set('limit', String(params.limit ?? 20));
    return api.get<{ items: JobItem[]; nextCursor: string | null; counts: Record<string, number> }>(
      `/api/jobs?${query}`,
    );
  },
  detail: (id: string) => api.get<{ job: JobItem }>(`/api/jobs/${id}`),
  cancel: (id: string) => api.post<{ id: string; status: string; cancelled?: boolean }>(`/api/jobs/${id}/cancel`, {}),
  retry: (id: string) => api.post<{ id: string; status: string; attempts: number }>(`/api/jobs/${id}/retry`, {}),
};
