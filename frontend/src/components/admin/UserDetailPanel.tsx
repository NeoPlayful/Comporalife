import Pagination from '@/components/ui/Pagination';
import { adminApi, type AdminUser } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LifecycleBadge, RoleBadge, StatusBadge, hasLifecycle } from './UserBadges';

export type UserAction =
  | 'disable'
  | 'enable'
  | 'revoke'
  | 'deletion'
  | 'reject-deletion'
  | 'reset-mail';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border-subtle)] py-2 last:border-0">
      <span className="text-xs text-[var(--color-content-muted)]">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}

/** 活动记录分页：登录记录与管理员操作共用一套外观，只是取数不同 */
function ActivityList({
  tab,
  userId,
  page,
  onPageChange,
}: {
  tab: 'logins' | 'audit';
  userId: string;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation('admin');

  const loginQuery = useQuery({
    queryKey: ['admin', 'login-logs', userId, page],
    queryFn: () => adminApi.loginLogs(userId, page),
    enabled: tab === 'logins',
    placeholderData: (previous) => previous,
  });

  const auditQuery = useQuery({
    queryKey: ['admin', 'user-audit-logs', userId, page],
    queryFn: () => adminApi.userAuditLogs(userId, page),
    enabled: tab === 'audit',
    placeholderData: (previous) => previous,
  });

  const active = tab === 'logins' ? loginQuery : auditQuery;
  const logs = active.data?.data.logs ?? [];
  const pagination = active.data?.pagination ?? null;

  return (
    <div className="space-y-2">
      {active.isLoading && (
        <p className="text-xs text-[var(--color-content-muted)]">{t('common:actions.loading')}</p>
      )}
      {active.isError && <p className="text-xs text-[var(--color-negative)]">{t('users.load_failed')}</p>}
      {active.data && logs.length === 0 && (
        <p className="text-sm text-[var(--color-content-muted)]">{t('users.empty')}</p>
      )}

      {logs.length > 0 && (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-lg border border-[var(--color-border-subtle)]">
          {logs.map((log) => (
            <li key={log.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span>
                {t(`auditActions.${log.action}`, { defaultValue: log.action })}
                <span className="ml-1.5 font-mono text-[var(--color-content-muted)]">{log.action}</span>
              </span>
              <span className="text-[var(--color-content-muted)]">
                {formatDateTime(log.createdAt)}
                {'ip' in log && log.ip ? ` · ${log.ip}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pagination && pagination.totalPages > 1 && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}

/**
 * 账号详情面板（内联折叠）。
 *
 * 点击列表行后在该行下方就地展开，而不是从侧边推出抽屉：详情与列表共享同一
 * 上下文，滚回列表也不会丢失定位。破坏性操作交给页面的 ConfirmDialog。
 * 一次只展开一个账号，由外层控制哪个 id 处于展开态。
 */
export default function UserDetailPanel({
  user,
  detail,
  pending,
  actionPending,
  onClose,
  onAction,
}: {
  user: AdminUser;
  /** 详情接口返回的完整数据，含会话数；未取到前先用列表行兜底 */
  detail: AdminUser | null;
  pending: boolean;
  actionPending: boolean;
  onClose: () => void;
  onAction: (action: UserAction, user: AdminUser) => void;
}) {
  const { t } = useTranslation('admin');
  const [tab, setTab] = useState<'logins' | 'audit'>('logins');
  const [page, setPage] = useState(1);

  const data = detail ?? user;
  const deleted = Boolean(data.deletedAt);
  const disabled = data.status !== 'active';
  const busy = pending || actionPending;

  function switchTab(next: 'logins' | 'audit') {
    setTab(next);
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/12 text-lg font-semibold text-[var(--color-accent)]"
          >
            {data.nickname.trim().slice(0, 1).toUpperCase() || '?'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{data.nickname}</p>
            <p className="truncate text-sm text-[var(--color-content-muted)]">{data.email}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <RoleBadge role={data.role} />
              <StatusBadge status={data.status} />
              {hasLifecycle(data) && <LifecycleBadge user={data} />}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
        >
          {t('users.collapse_detail')}
        </button>
      </div>

      {data.deletionRequestedAt && (
        <div className="rounded-lg border border-[var(--color-border-subtle)] p-3">
          <p className="mb-1 text-xs font-medium text-[var(--color-content-muted)]">
            {t('users.detail_deletion_title')}
          </p>
          <p className="text-sm">
            {data.deletedAt
              ? t('users.detail_deleted_at', { time: formatDateTime(data.deletedAt) })
              : data.coolingOffElapsed
                ? t('users.detail_cooling_done')
                : t('users.deletion_cooling', {
                    time: formatDateTime(data.deletionRequestedAt),
                  })}
          </p>
          {!data.deletedAt && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !data.coolingOffElapsed}
                title={data.coolingOffElapsed ? undefined : t('users.cooling_off_pending')}
                onClick={() => onAction('deletion', user)}
                className="rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs text-red-600 disabled:opacity-40 dark:text-red-400"
              >
                {t('users.approve_deletion')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction('reject-deletion', user)}
                className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 text-xs disabled:opacity-50"
              >
                {t('users.reject_deletion')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="mb-1 text-sm font-semibold">{t('users.detail_account')}</h3>
          <InfoRow label={t('users.col_joined')} value={formatDateTime(data.createdAt)} />
          <InfoRow
            label={t('users.col_last_login')}
            value={
              data.lastLoginAt ? (
                <span>
                  {formatDateTime(data.lastLoginAt)}
                  {data.lastLoginIp && <span className="ml-1.5 font-mono text-xs">{data.lastLoginIp}</span>}
                </span>
              ) : (
                t('users.never_logged_in')
              )
            }
          />
          <InfoRow
            label={t('users.col_email')}
            value={
              data.emailVerifiedAt ? (
                <span className="text-emerald-600 dark:text-emerald-400">{t('users.email_verified')}</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">{t('users.email_unverified')}</span>
              )
            }
          />
          <InfoRow
            label={t('users.col_sessions')}
            value={
              (data.sessionCount ?? 0) > 0
                ? t('users.detail_sessions', { count: data.sessionCount ?? 0 })
                : t('users.detail_no_sessions')
            }
          />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('users.detail_activity')}</h3>
            <div className="flex rounded-lg border border-[var(--color-border-subtle)] p-0.5 text-xs">
              {(['logins', 'audit'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => switchTab(value)}
                  aria-pressed={tab === value}
                  className={`rounded-md px-2.5 py-1 ${
                    tab === value ? 'btn-action' : 'hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  {value === 'logins' ? t('users.login_logs') : t('users.audit_logs')}
                </button>
              ))}
            </div>
          </div>
          <ActivityList tab={tab} userId={user.id} page={page} onPageChange={setPage} />
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] pt-3">
        {!deleted &&
          (disabled ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('enable', user)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm disabled:opacity-50"
            >
              {t('users.enable')}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('disable', user)}
              className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-600 disabled:opacity-50 dark:text-red-400"
            >
              {t('users.disable')}
            </button>
          ))}
        {!deleted && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('reset-mail', user)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm disabled:opacity-50"
            >
              {t('users.reset_mail')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction('revoke', user)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm disabled:opacity-50"
            >
              {t('users.revoke_sessions')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
