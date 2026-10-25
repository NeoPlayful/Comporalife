import { api } from './client';

export type AdminRole = 'super_admin' | 'admin' | 'user';

export interface AdminUser {
  id: string;
  email: string;
  nickname: string;
  role: AdminRole;
  status: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  sessionCount?: number;
  /** 注销申请时间；非空表示有待审批的申请 */
  deletionRequestedAt?: string | null;
  /** 已批准注销的时间；非空表示账号已软删除，不能重新启用 */
  deletedAt?: string | null;
  /** 冷却期是否已满，由服务端计算 */
  coolingOffElapsed?: boolean;
}

export interface AdminExchangeRate {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  rateDate: string;
  source: 'manual' | 'provider';
  updatedAt: string;
}

export interface AdminRatePairRequest {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: { nickname: string };
}

export interface AdminAuditLog {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  /** 操作者脱敏邮箱 */
  actorEmail: string | null;
  createdAt: string;
}

export interface DashboardOverview {
  users: { total: number; active: number; disabled: number; newLast24h: number; newLast7d: number };
  sessions: number;
}

/** 任务与风险模拟分开计数：两类实体状态枚举不同，不能相加 */
export interface JobOverview {
  tasks: { counts: Record<string, number>; active: number };
  runs: { counts: Record<string, number>; active: number };
  active: number;
}

export interface SystemMetrics {
  version: string;
  node: string;
  uptimeSeconds: number;
  memoryMb: number;
  database: 'ok' | 'fail';
}

export interface AdminSettingsOverview {
  registrationEnabled: boolean;
  emailVerificationEnabled: boolean;
  mailConfigured: boolean;
  deletionCoolingOffDays: number;
  auditLogRetentionDays: number;
  capabilities: { canWriteSettings: boolean; canManageAdmins: boolean };
}

export interface AdminPermissions {
  role: 'admin' | 'super_admin';
  permissions: string[];
}

export interface AdminAuditFilters {
  action?: string;
  actorId?: string;
  targetId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const adminApi = {
  overview: () => api.get<DashboardOverview>('/api/admin/dashboard/overview'),
  registrations: () => api.get<{ points: Array<{ date: string; count: number }> }>('/api/admin/dashboard/registrations'),
  security: () =>
    api.get<{ window: string; loginCount: number; failedLogins: number; disabledUsers: number }>(
      '/api/admin/dashboard/security',
    ),
  jobOverview: () => api.get<JobOverview>('/api/admin/dashboard/jobs'),

  users: (params: { page?: number; pageSize?: number; search?: string; role?: AdminRole; status?: string; reveal?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.search) query.set('search', params.search);
    if (params.role) query.set('role', params.role);
    if (params.status) query.set('status', params.status);
    if (params.reveal) query.set('reveal', 'true');
    return api.getPaged<{ users: AdminUser[] }>(`/api/admin/users?${query}`);
  },
  /** 授予管理员前的候选账号检索（按邮箱或 ID） */
  searchUsers: (query: string) =>
    api.get<{ users: Array<{ id: string; email: string; nickname: string; role: AdminRole; status: string }> }>(
      `/api/admin/users/search?query=${encodeURIComponent(query)}`,
    ),
  user: (id: string, reveal = false) =>
    api.get<{ user: AdminUser }>(`/api/admin/users/${id}${reveal ? '?reveal=true' : ''}`),
  disableUser: (id: string) => api.post<{ id: string; status: string }>(`/api/admin/users/${id}/disable`, {}),
  enableUser: (id: string) => api.post<{ id: string; status: string }>(`/api/admin/users/${id}/enable`, {}),
  revokeSessions: (id: string) => api.post<{ id: string; revoked: number }>(`/api/admin/users/${id}/revoke-sessions`, {}),
  loginLogs: (id: string, page = 1) =>
    api.get<{ logs: Array<{ id: string; action: string; ip: string | null; createdAt: string }> }>(
      `/api/admin/users/${id}/login-logs?page=${page}`,
    ),
  userAuditLogs: (id: string) =>
    api.get<{ logs: Array<{ id: string; action: string; createdAt: string }> }>(`/api/admin/users/${id}/audit-logs`),
  reviewDeletion: (id: string, decision: 'approve' | 'reject', note?: string) =>
    api.post<{ id: string; decision: string; status: string; disposition?: string }>(
      `/api/admin/users/${id}/deletion-review`,
      { decision, ...(note ? { note } : {}) },
    ),
  sendPasswordReset: (id: string) =>
    api.post<{ triggered: boolean }>(`/api/admin/users/${id}/send-password-reset`, {}),
  retryJob: (id: string) =>
    api.post<{ id: string; status: string; attempts: number }>(`/api/admin/jobs/${id}/retry`, {}),

  admins: () =>
    api.get<{ admins: Array<{ id: string; email: string; nickname: string; role: AdminRole; status: string; createdAt: string }> }>(
      '/api/admin/admins',
    ),
  grant: (id: string) => api.post<{ id: string; role: string }>(`/api/admin/admins/${id}/grant`, {}),
  revoke: (id: string) => api.post<{ id: string; role: string }>(`/api/admin/admins/${id}/revoke`, {}),
  permissions: () => api.get<AdminPermissions>('/api/admin/permissions/me'),

  auditLogs: (filters: AdminAuditFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.action) query.set('action', filters.action);
    if (filters.actorId) query.set('actorId', filters.actorId);
    if (filters.targetId) query.set('targetId', filters.targetId);
    if (filters.from) query.set('from', filters.from);
    if (filters.to) query.set('to', filters.to);
    if (filters.page) query.set('page', String(filters.page));
    if (filters.pageSize) query.set('pageSize', String(filters.pageSize));
    return api.getPaged<{ logs: AdminAuditLog[] }>(`/api/admin/audit-logs?${query}`);
  },
  jobs: (page = 1, status?: string) =>
    api.getPaged<{ jobs: Array<{ id: string; kind: string; status: string; progress: string; failureCode: string | null; createdAt: string; finishedAt: string | null }> }>(
      `/api/admin/jobs?page=${page}${status ? `&status=${status}` : ''}`,
    ),
  settingsOverview: () => api.get<AdminSettingsOverview>('/api/admin/settings'),
  systemInfo: () => api.get<SystemMetrics>('/api/admin/system/info'),
  systemMetrics: () =>
    api.get<{ jobs: JobOverview; sessions: number; uptimeSeconds: number; memoryMb: number }>(
      '/api/admin/system/metrics',
    ),
  registration: () => api.get<{ enabled: boolean }>('/api/admin/settings/registration'),
  setRegistration: (enabled: boolean) =>
    api.patch<{ enabled: boolean }>('/api/admin/settings/registration', { enabled }),
  emailVerification: () => api.get<{ enabled: boolean }>('/api/admin/settings/email-verification'),
  setEmailVerification: (enabled: boolean) =>
    api.patch<{ enabled: boolean }>('/api/admin/settings/email-verification', { enabled }),

  exchangeRates: (filters: {
    page?: number;
    pageSize?: number;
    base?: string;
    quote?: string;
    source?: string;
    from?: string;
    to?: string;
  } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return api.getPaged<{ exchangeRates: AdminExchangeRate[] }>(
      `/api/admin/exchange-rates?${query}`,
    );
  },
  createExchangeRate: (body: {
    baseCurrency: string;
    quoteCurrency: string;
    rate: string;
    rateDate: string;
  }) => api.post<{ exchangeRate: AdminExchangeRate }>('/api/admin/exchange-rates', body),
  updateExchangeRate: (id: string, rate: string) =>
    api.patch<{ exchangeRate: AdminExchangeRate }>(`/api/admin/exchange-rates/${id}`, { rate }),
  deleteExchangeRate: (id: string) => api.delete<{ deleted: boolean }>(`/api/admin/exchange-rates/${id}`),
  ratePairRequests: (filters: { page?: number; pageSize?: number; status?: string } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return api.getPaged<{ requests: AdminRatePairRequest[] }>(`/api/admin/rate-pair-requests?${query}`);
  },
  reviewRatePairRequest: (id: string, body: { status: 'approved' | 'rejected'; note?: string }) =>
    api.post<{ status: string }>(`/api/admin/rate-pair-requests/${id}/review`, body),
};
