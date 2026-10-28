import { api } from './client';

export type AdminRole = 'super_admin' | 'admin' | 'user';

/** 注销生命周期不在账号状态枚举里，单独作为一个筛选维度 */
export type AdminDeletionFilter = 'pending' | 'ready' | 'deleted';

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

/** 每个币种对的当前生效汇率：只保留最新一条，而不是按日期的流水 */
export interface AdminLatestExchangeRate {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  rateDate: string;
  source: 'manual' | 'provider';
  updatedAt: string;
  /** 距离最新汇率的自然日差，用于提示「汇率滞后」 */
  daysLag: number;
}

export interface AdminExchangeRateStats {
  pairs: number;
  manual: number;
  provider: number;
  baseCurrencies: number;
  /** 超过 staleDays 天没有更新的币种对数：覆盖数要配上它才有意义 */
  stale: number;
  staleDays: number;
}

export interface AdminRateHistoryPoint {
  rate: string;
  rateDate: string;
  source: 'manual' | 'provider';
}

export interface RateSyncFailure {
  pair: string;
  code: string;
}

/** 同步频率：存在系统设置里，可在后台在线修改 */
export type RateSyncFrequency = 'hourly' | 'daily' | 'weekly';

export interface RateSyncSettings {
  enabled: boolean;
  frequency: RateSyncFrequency;
  frequencies: RateSyncFrequency[];
}

/** 数据源预设：地址与响应解析固定在服务端，页面只填密钥与（自定义源）地址 */
export type RateProviderId = 'exchangerate-api' | 'openexchangerates' | 'custom';

/** 数据源配置回显：密钥只有末四位，没有明文也没有密文 */
export interface RateProviderConfigView {
  provider: RateProviderId;
  anchorCurrency: string;
  keyConfigured: boolean;
  keyHint: string;
  customUrl: string;
  ratesPath: string;
  datePath: string;
  /** database = 后台可改；environment = 仍在读部署环境变量；none = 尚未配置 */
  source: 'database' | 'environment' | 'none';
}

export interface RateProviderUpdateInput {
  provider: RateProviderId;
  anchorCurrency: string;
  /** 省略 = 保持现有密钥；空串 = 清除；非空 = 覆盖 */
  apiKey?: string;
  customUrl?: string;
  ratesPath?: string;
  datePath?: string;
}

export interface RateProviderStatus {
  configured: boolean;
  provider: string;
  anchorCurrency: string;
  keyConfigured: boolean;
  /** 已配置密钥的末四位；未配置时为空串 */
  keyHint: string;
  /** 数据源来自数据库、部署环境（回退），或尚未配置 */
  configSource: 'database' | 'environment' | 'none';
  customUrlConfigured: boolean;
  enabled: boolean;
  frequency: RateSyncFrequency;
  /** 由调度器给出；调度器未运行时为 null，不要在前端自行推算 */
  nextRunAt: string | null;
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    status: 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped';
    fetchedPairs: number;
    writtenRows: number;
    skippedManual: number;
    failures: RateSyncFailure[] | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
  disabledReason: string | null;
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
  /** 后台代建账号：管理员直接设定初始密码，默认关闭，仅超管可切换 */
  adminUserCreateEnabled: boolean;
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

  users: (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: AdminRole;
    status?: string;
    deletion?: AdminDeletionFilter;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.search) query.set('search', params.search);
    if (params.role) query.set('role', params.role);
    if (params.status) query.set('status', params.status);
    if (params.deletion) query.set('deletion', params.deletion);
    return api.getPaged<{ users: AdminUser[] }>(`/api/admin/users?${query}`);
  },
  /** 后台代建账号：不签发会话，管理员建号后仍保持自己的登录态 */
  createUser: (body: {
    email: string;
    nickname: string;
    password: string;
    role?: AdminRole;
    language?: string;
  }) => api.post<{ user: AdminUser }>('/api/admin/users', body),
  /** 授予管理员前的候选账号检索（按邮箱或 ID） */
  searchUsers: (query: string) =>
    api.get<{ users: Array<{ id: string; email: string; nickname: string; role: AdminRole; status: string }> }>(
      `/api/admin/users/search?query=${encodeURIComponent(query)}`,
    ),
  user: (id: string) => api.get<{ user: AdminUser }>(`/api/admin/users/${id}`),
  /** 只改昵称、邮箱、语言；密码与角色各有独立接口 */
  updateUser: (
    id: string,
    body: { nickname?: string; email?: string; language?: string },
  ) => api.patch<{ user: AdminUser }>(`/api/admin/users/${id}`, body),
  /** 默认软删除；permanent 时连同该用户全部财务数据物理清除，不可恢复（仅超管） */
  deleteUser: (id: string, options: { permanent?: boolean } = {}) =>
    api.delete<{ id: string; deleted: boolean; disposition: 'soft_deleted' | 'permanent' }>(
      `/api/admin/users/${id}${options.permanent ? '?permanent=true' : ''}`,
    ),
  disableUser: (id: string) => api.post<{ id: string; status: string }>(`/api/admin/users/${id}/disable`, {}),
  enableUser: (id: string) => api.post<{ id: string; status: string }>(`/api/admin/users/${id}/enable`, {}),
  revokeSessions: (id: string) => api.post<{ id: string; revoked: number }>(`/api/admin/users/${id}/revoke-sessions`, {}),
  loginLogs: (id: string, page = 1) =>
    api.getPaged<{ logs: Array<{ id: string; action: string; ip: string | null; createdAt: string }> }>(
      `/api/admin/users/${id}/login-logs?page=${page}`,
    ),
  userAuditLogs: (id: string, page = 1) =>
    api.getPaged<{ logs: Array<{ id: string; action: string; createdAt: string }> }>(
      `/api/admin/users/${id}/audit-logs?page=${page}`,
    ),
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
  adminUserCreation: () => api.get<{ enabled: boolean }>('/api/admin/settings/user-creation'),
  setAdminUserCreation: (enabled: boolean) =>
    api.patch<{ enabled: boolean }>('/api/admin/settings/user-creation', { enabled }),

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
  }) =>
    api.post<{ exchangeRate: AdminExchangeRate; replaced: boolean }>(
      '/api/admin/exchange-rates',
      body,
    ),
  /** 批量录入同一生效日期的多组汇率：单事务写入，任一失败整批回滚 */
  bulkCreateExchangeRates: (body: {
    rateDate: string;
    rates: Array<{ baseCurrency: string; quoteCurrency: string; rate: string }>;
  }) =>
    api.post<{
      exchangeRates: AdminExchangeRate[];
      writtenRows: number;
      rateDate: string;
    }>('/api/admin/exchange-rates/bulk', body),
  /** 当前汇率：每个币种对最新一条，附带全局覆盖统计 */
  latestExchangeRates: (filters: {
    page?: number;
    pageSize?: number;
    base?: string;
    quote?: string;
    source?: string;
    q?: string;
  } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    return api.getPaged<{
      exchangeRates: AdminLatestExchangeRate[];
      stats: AdminExchangeRateStats;
    }>(`/api/admin/exchange-rates/latest?${query}`);
  },
  exchangeRateHistory: (params: { from: string; to: string; days?: number }) => {
    const query = new URLSearchParams({ from: params.from, to: params.to });
    if (params.days) query.set('days', String(params.days));
    return api.get<{
      from: string;
      to: string;
      days: number;
      inverted: boolean;
      points: AdminRateHistoryPoint[];
    }>(`/api/admin/exchange-rates/history?${query}`);
  },
  rateSyncSettings: () => api.get<RateSyncSettings>('/api/admin/rate-sync/settings'),
  updateRateSyncSettings: (input: { enabled?: boolean; frequency?: RateSyncFrequency }) =>
    api.patch<RateSyncSettings>('/api/admin/rate-sync/settings', input),
  rateProvider: () => api.get<RateProviderConfigView>('/api/admin/rate-sync/provider'),
  updateRateProvider: (input: RateProviderUpdateInput) =>
    api.patch<RateProviderConfigView>('/api/admin/rate-sync/provider', input),
  /** 手动触发一次同步：同步执行，返回本次摘要 */
  refreshRates: () =>
    api.post<{
      provider: string;
      anchorCurrency: string;
      status: 'succeeded' | 'partial' | 'failed' | 'skipped';
      fetchedPairs: number;
      writtenRows: number;
      skippedManual: number;
      failures: RateSyncFailure[];
      errorCode: string | null;
      errorMessage: string | null;
      startedAt: string;
      finishedAt: string;
    }>('/api/market-data/refresh'),
  /** source 省略时按既有规则转人工；显式给 provider 表示把这一行交还自动同步 */
  updateExchangeRate: (id: string, input: { rate: string; source?: 'manual' | 'provider' }) =>
    api.patch<{ exchangeRate: AdminExchangeRate }>(`/api/admin/exchange-rates/${id}`, input),
  deleteExchangeRate: (id: string) => api.delete<{ deleted: boolean }>(`/api/admin/exchange-rates/${id}`),
  rateProviderStatus: () => api.get<RateProviderStatus>('/api/market-data/providers'),
};
