import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { adminApi, type AdminRole, type AdminUser } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 20;

type UserAction =
  | 'disable'
  | 'enable'
  | 'revoke'
  | 'deletion'
  | 'reject-deletion'
  | 'reset-mail';

/** 详情面板：账号操作与两类记录集中在这里，列表行只负责定位 */
function UserDetail({
  user,
  onAction,
  pending,
}: {
  user: AdminUser;
  onAction: (action: UserAction) => void;
  pending: boolean;
}) {
  const { t } = useTranslation('admin');
  const [tab, setTab] = useState<'logins' | 'audit'>('logins');

  const loginLogs = useQuery({
    queryKey: ['admin', 'login-logs', user.id],
    queryFn: () => adminApi.loginLogs(user.id),
  });

  const auditLogs = useQuery({
    queryKey: ['admin', 'user-audit-logs', user.id],
    queryFn: () => adminApi.userAuditLogs(user.id),
  });

  const deleted = Boolean(user.deletedAt);

  return (
    <div className="mt-3 space-y-3 border-t border-[var(--color-border-subtle)] pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {deleted ? (
          <span className="rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
            {t('users.deleted_badge')}
          </span>
        ) : user.status === 'active' ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t('users.disable_confirm'))) onAction('disable');
            }}
            className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-600 disabled:opacity-50 dark:text-red-400"
          >
            {t('users.disable')}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAction('enable')}
            className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs disabled:opacity-50"
          >
            {t('users.enable')}
          </button>
        )}

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(t('users.revoke_confirm'))) onAction('revoke');
          }}
          className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs disabled:opacity-50"
        >
          {t('users.revoke_sessions')}
        </button>

        {!deleted && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t('users.reset_mail_confirm', { email: user.email }))) onAction('reset-mail');
            }}
            className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs disabled:opacity-50"
          >
            {t('users.reset_mail')}
          </button>
        )}

        {user.deletionRequestedAt && !deleted && (
          <>
            <button
              type="button"
              disabled={pending || !user.coolingOffElapsed}
              title={user.coolingOffElapsed ? undefined : t('users.cooling_off_pending')}
              onClick={() => {
                if (window.confirm(t('users.approve_deletion_confirm', { email: user.email }))) onAction('deletion');
              }}
              className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-600 disabled:opacity-40 dark:text-red-400"
            >
              {t('users.approve_deletion')}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(t('users.reject_deletion_confirm', { email: user.email }))) {
                  onAction('reject-deletion');
                }
              }}
              className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs disabled:opacity-50"
            >
              {t('users.reject_deletion')}
            </button>
          </>
        )}
      </div>

      {user.deletionRequestedAt && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {deleted
            ? t('users.deletion_done', { time: formatDateTime(user.deletedAt) })
            : user.coolingOffElapsed
              ? t('users.deletion_ready')
              : t('users.deletion_cooling', { time: formatDateTime(user.deletionRequestedAt) })}
        </p>
      )}

      <div>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setTab('logins')}
            className={`rounded-lg px-2 py-1 ${tab === 'logins' ? 'bg-black/5 dark:bg-white/10' : 'text-[var(--color-content-muted)]'}`}
          >
            {t('users.login_logs')}
          </button>
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`rounded-lg px-2 py-1 ${tab === 'audit' ? 'bg-black/5 dark:bg-white/10' : 'text-[var(--color-content-muted)]'}`}
          >
            {t('users.audit_logs')}
          </button>
        </div>

        <ul className="mt-2 space-y-1 rounded-lg bg-black/5 p-2 text-xs dark:bg-white/5">
          {tab === 'logins' && (
            <>
              {loginLogs.isLoading && <li className="text-[var(--color-content-muted)]">{t('common:actions.loading')}</li>}
              {loginLogs.isError && <li className="text-[var(--color-negative)]">{t('users.load_failed')}</li>}
              {loginLogs.data?.logs.length === 0 && <li>{t('users.empty')}</li>}
              {loginLogs.data?.logs.map((log) => (
                <li key={log.id}>
                  {t(`auditActions.${log.action}`, { defaultValue: log.action })} · {formatDateTime(log.createdAt)} ·{' '}
                  {log.ip ?? '—'}
                </li>
              ))}
            </>
          )}

          {tab === 'audit' && (
            <>
              {auditLogs.isLoading && <li className="text-[var(--color-content-muted)]">{t('common:actions.loading')}</li>}
              {auditLogs.isError && <li className="text-[var(--color-negative)]">{t('users.load_failed')}</li>}
              {auditLogs.data?.logs.length === 0 && <li>{t('users.empty')}</li>}
              {auditLogs.data?.logs.map((log) => (
                <li key={log.id}>
                  {t(`auditActions.${log.action}`, { defaultValue: log.action })} · {formatDateTime(log.createdAt)}
                </li>
              ))}
            </>
          )}
        </ul>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<AdminRole | ''>('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reveal, setReveal] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['admin', 'users', search, role, status, page, reveal],
    queryFn: () =>
      adminApi.users({
        page,
        pageSize: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        reveal,
      }),
  });

  const act = useMutation<unknown, Error, { id: string; action: UserAction }>({
    mutationFn: (input) => {
      if (input.action === 'disable') return adminApi.disableUser(input.id);
      if (input.action === 'enable') return adminApi.enableUser(input.id);
      if (input.action === 'revoke') return adminApi.revokeSessions(input.id);
      if (input.action === 'reset-mail') return adminApi.sendPasswordReset(input.id);
      if (input.action === 'reject-deletion') return adminApi.reviewDeletion(input.id, 'reject');
      return adminApi.reviewDeletion(input.id, 'approve');
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  const list = users.data?.data.users ?? [];
  const pagination = users.data?.pagination ?? null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('users.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
        {t('users.notice_no_financial')}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input w-full max-w-xs"
          placeholder={t('users.search')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <select
          className="input"
          value={role}
          onChange={(event) => {
            setRole(event.target.value as AdminRole | '');
            setPage(1);
          }}
        >
          <option value="">{t('users.all_roles')}</option>
          <option value="super_admin">{t('roles.super_admin')}</option>
          <option value="admin">{t('roles.admin')}</option>
          <option value="user">{t('roles.user')}</option>
        </select>
        <select
          className="input"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('users.all_statuses')}</option>
          <option value="active">{t('statuses.active')}</option>
          <option value="disabled">{t('statuses.disabled')}</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={reveal} onChange={(event) => setReveal(event.target.checked)} />
          {t('users.reveal')}
        </label>
      </div>

      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      {users.isLoading && <LoadingState />}
      {users.isError && <ErrorState onRetry={() => void users.refetch()} />}

      {users.data && list.length === 0 && (
        <p className="text-sm text-[var(--color-content-muted)]">{t('users.empty')}</p>
      )}

      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((user) => (
            <li key={user.id} className="card p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {user.email} · {t(`roles.${user.role}`)} · {t(`statuses.${user.status}`)}
                  </p>
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {t('users.joined', { time: formatDateTime(user.createdAt) })} ·{' '}
                    {user.lastLoginAt
                      ? t('users.last_login', { time: formatDateTime(user.lastLoginAt) })
                      : t('users.never_logged_in')}
                    {user.lastLoginIp && ` · ${user.lastLoginIp}`}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setExpanded(expanded === user.id ? null : user.id)}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                >
                  {expanded === user.id ? t('users.collapse') : t('users.expand')}
                </button>
              </div>

              {expanded === user.id && (
                <UserDetail
                  user={user}
                  pending={act.isPending}
                  onAction={(action) => act.mutate({ id: user.id, action })}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {pagination && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          totalLabel="pagination.total_accounts"
        />
      )}
    </div>
  );
}
