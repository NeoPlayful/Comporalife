import { api, type RequestOptions } from './client';

export interface AuthUser {
  id: string;
  email: string;
  nickname: string;
  role: 'super_admin' | 'admin' | 'user';
  status: 'active' | 'disabled' | 'pending_verification';
  createdAt: string;
}

export interface LoginResult {
  user: AuthUser;
  accessToken: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

export interface Preferences {
  baseCurrency: string;
  timezone: string;
  dateFormat: string;
  theme: 'dark' | 'light' | 'system';
  language: 'zh-CN' | 'en-US';
  simulationDefaults: Record<string, unknown> | null;
}

export const authApi = {
  register: (body: {
    email: string;
    password: string;
    nickname: string;
    language?: 'zh-CN' | 'en-US';
  }) => api.post<LoginResult>('/api/auth/register', body),

  login: (body: { email: string; password: string }) => api.post<LoginResult>('/api/auth/login', body),

  logout: () => api.post<{ loggedOut: boolean }>('/api/auth/logout'),

  me: (options?: RequestOptions) => api.get<{ user: AuthUser }>('/api/auth/me', options),

  changePassword: (body: { oldPassword: string; newPassword: string }) =>
    api.post<{ changed: boolean; requiresReauth: boolean }>('/api/auth/change-password', body),

  forgotPassword: (email: string) =>
    api.post<{ message: string }>('/api/auth/forgot-password', { email }),

  resetPassword: (body: { token: string; newPassword: string }) =>
    api.post<{ reset: boolean }>('/api/auth/reset-password', body),

  sessions: () => api.get<{ sessions: SessionInfo[] }>('/api/auth/sessions'),

  revokeSession: (id: string) => api.delete<{ revoked: boolean }>(`/api/auth/sessions/${id}`),

  revokeOtherSessions: () => api.delete<{ revokedCount: number }>('/api/auth/sessions'),

  profile: () => api.get<{ user: AuthUser }>('/api/profile'),

  updateProfile: (body: { nickname: string }) =>
    api.patch<{ user: { id: string; email: string; nickname: string } }>('/api/profile', body),

  preferences: () => api.get<{ preferences: Preferences }>('/api/profile/preferences'),

  updatePreferences: (body: Partial<Preferences>) =>
    api.patch<{ preferences: Preferences }>('/api/profile/preferences', body),
};
