import LoadingState from '@/components/ui/LoadingState';
import { adminApi, type AdminRole } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function AdminUsersPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<AdminRole | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const users = useQuery({
    queryKey: ['admin', 'users', search, role, reveal],
    queryFn: () =>
      adminApi.users({
        ...(search ? { search } : {}),
        ...(role ? { role } : {}),
        reveal,
      }),
  });

  const act = useMutation<unknown, Error, { id: string; action: 'disable' | 'enable' | 'revoke' | 'deletion' }>({
    mutationFn: (input) => {
      if (input.action === 'disable') return adminApi.disableUser(input.id);
      if (input.action === 'enable') return adminApi.enableUser(input.id);
      if (input.action === 'revoke') return adminApi.revokeSessions(input.id);
      return adminApi.reviewDeletion(input.id);
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  const loginLogs = useQuery({
    queryKey: ['admin', 'login-logs', expanded],
    queryFn: () => adminApi.loginLogs(expanded!),
    enabled: Boolean(expanded),
  });

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
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="input" value={role} onChange={(event) => setRole(event.target.value as AdminRole | '')}>
          <option value="">{t('users.all_roles')}</option>
          <option value="super_admin">{t('roles.super_admin')}</option>
          <option value="admin">{t('roles.admin')}</option>
          <option value="user">{t('roles.user')}</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={reveal} onChange={(event) => setReveal(event.target.checked)} />
          {t('users.reveal')}
        </label>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {users.isLoading && <LoadingState />}

      {users.data && (
        <ul className="space-y-2">
          {users.data.users.length === 0 && (
            <li className="text-sm text-[var(--color-content-muted)]">{t('users.empty')}</li>
          )}

          {users.data.users.map((user) => (
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

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === user.id ? null : user.id)}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                  >
                    {t('users.login_logs')}
                  </button>

                  {user.status === 'active' ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('users.disable_confirm'))) {
                          act.mutate({ id: user.id, action: 'disable' });
                        }
                      }}
                      className="rounded-lg border border-red-500/40 px-2 py-1 text-xs text-red-600 dark:text-red-400"
                    >
                      {t('users.disable')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => act.mutate({ id: user.id, action: 'enable' })}
                      className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                    >
                      {t('users.enable')}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('users.revoke_confirm'))) {
                        act.mutate({ id: user.id, action: 'revoke' });
                      }
                    }}
                    className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                  >
                    {t('users.revoke_sessions')}
                  </button>
                </div>
              </div>

              {expanded === user.id && loginLogs.data && (
                <ul className="mt-2 space-y-1 rounded-lg bg-black/5 p-2 text-xs dark:bg-white/5">
                  {loginLogs.data.logs.length === 0 && <li>{t('users.empty')}</li>}
                  {loginLogs.data.logs.map((log) => (
                    <li key={log.id}>
                      {log.action} · {formatDateTime(log.createdAt)} · {log.ip ?? '—'}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
