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
  /** 冷却期是否已满，由服务端计算 */
  coolingOffElapsed?: boolean;
}

export interface DashboardOverview {
  users: { total: number; active: number; disabled: number; newLast24h: number; newLast7d: number };
  sessions: number;
}

export interface JobOverview {
  counts: Record<string, number>;
  active: number;
}

export interface SystemMetrics {
  version: string;
  node: string;
  uptimeSeconds: number;
  memoryMb: number;
  database: 'ok' | 'fail';
}

export interface AdminPermissions {
  role: 'admin' | 'super_admin';
  permissions: string[];
}

export const adminApi = {
  overview: () => api.get<DashboardOverview>('/api/admin/dashboard/overview'),
  registrations: () => api.get<{ points: Array<{ date: string; count: number }> }>('/api/admin/dashboard/registrations'),
  security: () =>
    api.get<{ window: string; loginCount: number; failedLogins: number; disabledUsers: number }>(
      '/api/admin/dashboard/security',
    ),
  jobOverview: () => api.get<JobOverview>('/api/admin/dashboard/jobs'),

  users: (params: { page?: number; search?: string; role?: AdminRole; status?: string; reveal?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.search) query.set('search', params.search);
    if (params.role) query.set('role', params.role);
    if (params.status) query.set('status', params.status);
    if (params.reveal) query.set('reveal', 'true');
    return api.get<{ users: AdminUser[] }>(`/api/admin/users?${query}`);
  },
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

  auditLogs: (page = 1) =>
    api.get<{ logs: Array<{ id: string; action: string; targetType: string | null; targetId: string | null; ip: string | null; createdAt: string }> }>(
      `/api/admin/audit-logs?page=${page}`,
    ),
  jobs: (page = 1, status?: string) =>
    api.get<{ jobs: Array<{ id: string; kind: string; status: string; progress: string; failureCode: string | null; createdAt: string; finishedAt: string | null }> }>(
      `/api/admin/jobs?page=${page}${status ? `&status=${status}` : ''}`,
    ),
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
};
