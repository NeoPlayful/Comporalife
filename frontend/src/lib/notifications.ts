import { api } from './client';

export type NotificationKind =
  | 'export_ready'
  | 'backup_ready'
  | 'restore_done'
  | 'job_failed'
  | 'email_verified'
  | 'deletion_requested'
  | 'deletion_approved'
  | 'admin_action';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** 渲染参数：文案由前端按 kind 从 i18n 生成，切换语言时历史通知也随之切换 */
  metadata: Record<string, unknown> | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: (params: { page?: number; pageSize?: number; unreadOnly?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.unreadOnly) query.set('unreadOnly', 'true');
    const suffix = query.toString();
    return api.get<{ notifications: AppNotification[]; unreadCount: number }>(
      `/api/notifications${suffix ? `?${suffix}` : ''}`,
    );
  },
  markRead: (id: string) =>
    api.patch<{ read: boolean; unreadCount: number }>(`/api/notifications/${id}/read`, {}),
  markAllRead: () =>
    api.post<{ marked: number; unreadCount: number }>('/api/notifications/read-all', {}),
};
