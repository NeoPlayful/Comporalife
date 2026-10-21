import { api } from './client';

export type ImportStatus =
  | 'uploaded'
  | 'parsed'
  | 'mapped'
  | 'validated'
  | 'committing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolled_back';

export type ImportRowStatus =
  | 'pending'
  | 'valid'
  | 'invalid'
  | 'duplicate'
  | 'suspected'
  | 'skipped'
  | 'imported'
  | 'failed';

export interface ImportCounts {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  suspected: number;
  skipped: number;
  imported: number;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  accountName: string;
  currency: string;
  status: ImportStatus;
  originalFilename: string;
  fileSize: number;
  format: 'csv' | 'xlsx';
  encoding: string;
  sheetName: string | null;
  headerRow: number | null;
  counts: ImportCounts;
  committedAt: string | null;
  rolledBackAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ImportBatchDetail extends ImportBatch {
  mapping: ColumnMapping | null;
  headers: string[] | null;
  failureReason: string | null;
}

export interface ColumnMapping {
  occurredAt: number;
  amountMode: 'signed' | 'debitCredit';
  amount?: number;
  debit?: number;
  credit?: number;
  currency?: number;
  description?: number;
  merchant?: number;
  externalId?: number;
  balanceAfter?: number;
  dateFormat: string;
}

export interface ParsedSummary {
  format: 'csv' | 'xlsx';
  encoding: string;
  delimiter: string | null;
  sheetName: string | null;
  sheetNames: string[] | null;
  headerRow: number;
  headers: string[];
  totalRows: number;
}

export interface UploadResponse {
  batch: ImportBatch;
  parsed: ParsedSummary;
  template: { id: string; name: string } | null;
}

export interface ImportRow {
  id: string;
  rowNumber: number;
  occurredAt: string | null;
  amount: string | null;
  currency: string | null;
  description: string | null;
  merchant: string | null;
  externalId: string | null;
  direction: 'income' | 'expense' | null;
  status: ImportRowStatus;
  errors: Array<{ field: string; code: string; message: string }>;
  duplicateKind: 'exact' | 'suspected' | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DuplicateRow {
  id: string;
  rowNumber: number;
  occurredAt: string | null;
  amount: string | null;
  description: string | null;
  direction: string | null;
  status: ImportRowStatus;
  duplicateKind: 'exact' | 'suspected' | null;
  counterpart: {
    id: string;
    type: string;
    occurredAt: string;
    description: string;
    merchant: string | null;
    accountName: string | null;
  } | null;
}

export interface CommitResult {
  importedRows: number;
  skippedRows: number;
  uncategorized: number;
  categoryMatched: number;
}

export const importsApi = {
  list: (status = 'all', page = 1, pageSize = 20) =>
    api.get<{ batches: ImportBatch[]; pagination: Pagination }>(
      `/api/imports?status=${status}&page=${page}&pageSize=${pageSize}`,
    ),

  detail: (id: string) =>
    api.get<{ batch: ImportBatchDetail; actions: string[] }>(`/api/imports/${id}`),

  upload: (accountId: string, file: File, options: { encoding?: string } = {}) => {
    const form = new FormData();
    form.append('file', file);
    const query = new URLSearchParams({ accountId });
    if (options.encoding) query.set('encoding', options.encoding);
    return api.upload<UploadResponse>(`/api/imports/upload?${query}`, form);
  },

  preview: (id: string, page = 1, pageSize = 100) =>
    api.get<{ rows: ImportRow[]; pagination: Pagination }>(
      `/api/imports/${id}/preview?page=${page}&pageSize=${pageSize}`,
    ),

  rows: (id: string, status = 'all', page = 1, pageSize = 100) =>
    api.get<{ rows: ImportRow[]; pagination: Pagination }>(
      `/api/imports/${id}/rows?status=${status}&page=${page}&pageSize=${pageSize}`,
    ),

  setMapping: (id: string, payload: { mapping: ColumnMapping; headerRow?: number; templateName?: string; version?: number }) =>
    api.patch<{ batch: ImportBatch }>(`/api/imports/${id}/mapping`, payload),

  validate: (id: string) =>
    api.post<{
      batch: ImportBatch;
      errors: Array<{ rowNumber: number; errors: Array<{ code: string; message: string }> }>;
      headers: string[];
    }>(`/api/imports/${id}/validate`),

  cancel: (id: string) => api.post<{ cancelled: boolean }>(`/api/imports/${id}/cancel`),

  errors: (id: string) =>
    api.get<{ total: number; byCode: Array<{ code: string; count: number }>; rows: unknown[] }>(
      `/api/imports/${id}/errors`,
    ),

  duplicates: (id: string) =>
    api.get<{ exact: DuplicateRow[]; suspected: DuplicateRow[] }>(`/api/imports/${id}/duplicates`),

  decideDuplicates: (id: string, decisions: Array<{ rowId: string; action: 'keep' | 'skip' }>) =>
    api.patch<{ applied: number; forcedExact: number; warning?: string }>(`/api/imports/${id}/duplicates`, {
      decisions,
    }),

  commit: (id: string, idempotencyKey: string) =>
    api.post<CommitResult>(`/api/imports/${id}/commit`, undefined, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  rollback: (id: string) => api.post<{ voided: number; alreadyVoided: number }>(`/api/imports/${id}/rollback`),

  errorExportUrl: (id: string) => `/api/imports/${id}/errors/export`,
};

export interface ImportTemplate {
  id: string;
  name: string;
  bankName: string | null;
  format: 'csv' | 'xlsx';
  headerSignature: string;
  mapping: ColumnMapping;
  createdAt: string;
  updatedAt: string;
}

export const importTemplatesApi = {
  list: () => api.get<{ templates: ImportTemplate[]; pagination: Pagination }>('/api/imports/templates'),
  create: (body: { name: string; bankName?: string; format: 'csv' | 'xlsx'; headerSignature: string; mapping: ColumnMapping }) =>
    api.post<{ template: ImportTemplate }>('/api/imports/templates', body),
  update: (id: string, body: { name?: string; bankName?: string | null; mapping?: ColumnMapping }) =>
    api.patch<{ template: ImportTemplate }>(`/api/imports/templates/${id}`, body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/imports/templates/${id}`),
};

export interface RuleConditions {
  logic?: 'all' | 'any';
  accountIds?: string[];
  directions?: Array<'income' | 'expense'>;
  merchant?: { op: 'equals' | 'contains' | 'startsWith'; value: string };
  description?: { op: 'equals' | 'contains' | 'startsWith'; value: string };
  amount?: { min?: string; max?: string };
  onlyUncategorized?: boolean;
}

export interface RuleActions {
  categoryId?: string;
  addTagIds?: string[];
  markReviewed?: boolean;
}

export interface ClassificationRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
  matchCount: number;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const classificationRulesApi = {
  list: () => api.get<{ rules: ClassificationRule[]; pagination: Pagination }>('/api/classification-rules'),
  create: (body: {
    name: string;
    priority?: number;
    enabled?: boolean;
    conditions: RuleConditions;
    actions: RuleActions;
  }) => api.post<{ rule: ClassificationRule }>('/api/classification-rules', body),
  update: (
    id: string,
    body: Partial<{ name: string; priority: number; enabled: boolean; conditions: RuleConditions; actions: RuleActions }>,
  ) => api.patch<{ rule: ClassificationRule }>(`/api/classification-rules/${id}`, body),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/classification-rules/${id}`),
  test: (id: string) =>
    api.post<{ matched: number; sample: Array<{ id: string; occurredAt: string; type: string; description: string; merchant: string | null; amount: string }> }>(
      `/api/classification-rules/${id}/test`,
    ),
  apply: (body: { transactionIds?: string[]; onlyUncategorized?: boolean; overwrite?: boolean }) =>
    api.post<{ matched: number; categorized: number; tagged: number; skipped: number }>(
      '/api/classification-rules/apply',
      body,
    ),
  reorder: (items: Array<{ id: string; priority: number }>) =>
    api.post<{ updated: number }>('/api/classification-rules/reorder', { items }),
};

export interface UnmatchedTransaction {
  id: string;
  type: string;
  occurredAt: string;
  description: string;
  merchant: string | null;
  note: string | null;
  amount: string;
  currency: string;
  accountId: string;
  accountName: string;
  externalId: string | null;
}

export interface TransferCandidate {
  outgoing: UnmatchedTransaction;
  incoming: UnmatchedTransaction;
  score: number;
  reasons: string[];
}

export const transferMatchApi = {
  unmatched: (params: { accountId?: string; from?: string; to?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.accountId) query.set('accountId', params.accountId);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query}` : '';
    return api.get<{ transactions: UnmatchedTransaction[]; candidates: TransferCandidate[] }>(
      `/api/transactions/unmatched${suffix}`,
    );
  },
  match: (transactionIdA: string, transactionIdB: string) =>
    api.post<{ transferId: string }>('/api/transfers/match', { transactionIdA, transactionIdB }),
  unmatch: (transferId: string) => api.post<{ created: string[] }>(`/api/transfers/${transferId}/unmatch`),
};
