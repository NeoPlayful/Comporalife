import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { formatDateTime } from '@/lib/format';
import { notificationsApi, type AppNotification } from '@/lib/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/**
 * 通知正文由 kind + metadata 在渲染时生成。
 * 这样切换语言时历史通知会跟着变，而不是停留在写入时的语言。
 */
export function useNotificationText() {
  const { t } = useTranslation('notifications');

  return (item: AppNotification): string => {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;

    switch (item.kind) {
      case 'export_ready':
        return t('kinds.export_ready', { scope: String(meta.scope ?? '') });
      case 'backup_ready':
        return t('kinds.backup_ready');
      case 'restore_done':
        return t('kinds.restore_done', { rows: Number(meta.rowsWritten ?? 0) });
      case 'job_failed':
        return t('kinds.job_failed', { task: String(meta.taskKind ?? '') });
      case 'email_verified':
        return t('kinds.email_verified');
      case 'deletion_requested':
        return t('kinds.deletion_requested');
      case 'deletion_approved':
        return t('kinds.deletion_approved');
      case 'admin_action':
        return t(`admin_actions.${String(meta.action ?? 'unknown')}`, { defaultValue: t('kinds.admin_action') });
      default:
        return t('kinds.unknown');
    }
  };
}

export default function NotificationsPage() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const text = useNotificationText();

  const listQuery = useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () => notificationsApi.list({ unreadOnly }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {t('subtitle', { count: listQuery.data?.unreadCount ?? 0 })}
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm disabled:opacity-60"
          disabled={markAll.isPending || (listQuery.data?.unreadCount ?? 0) === 0}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck className="size-4" />
          {t('mark_all_read')}
        </button>
      </header>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={unreadOnly}
          onChange={(event) => setUnreadOnly(event.target.checked)}
        />
        {t('unread_only')}
      </label>

      {listQuery.isLoading && <LoadingState />}
      {listQuery.isError && <ErrorState onRetry={() => void listQuery.refetch()} />}

      {listQuery.data && listQuery.data.notifications.length === 0 && (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      )}

      {listQuery.data && listQuery.data.notifications.length > 0 && (
        <ul className="space-y-1.5">
          {listQuery.data.notifications.map((item) => (
            <li
              key={item.id}
              className={`card flex items-start justify-between gap-3 p-3 ${
                item.readAt ? 'opacity-70' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm">{text(item)}</p>
                <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                  {formatDateTime(item.createdAt)}
                  {item.link && (
                    <>
                      {' · '}
                      <Link to={item.link} className="text-[var(--color-accent)]">
                        {t('view')}
                      </Link>
                    </>
                  )}
                </p>
              </div>

              {!item.readAt && (
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                  onClick={() => markRead.mutate(item.id)}
                >
                  {t('mark_read')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
