import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { adminApi, type AdminRole, type AdminUser } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

type Tab = 'dashboard' | 'users' | 'admins' | 'system';

export default function AdminPage() {
  const { t } = useTranslation('admin');
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
        </div>
        <Link to="/dashboard" className="text-sm underline">
          {t('nav.back_to_app')}
        </Link>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-[var(--color-border-subtle)] pb-2">
        {(['dashboard', 'users', 'admins', 'system'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              tab === key
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            {key === 'dashboard'
              ? t('dashboard.title')
              : key === 'users'
                ? t('users.title')
                : key === 'admins'
                  ? t('admins.title')
                  : t('system.title')}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'admins' && <AdminsTab />}
      {tab === 'system' && <SystemTab />}
    </div>
  );
}

function DashboardTab() {
  const { t } = useTranslation('admin');
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => adminApi.overview() });
  const security = useQuery({ queryKey: ['admin', 'security'], queryFn: () => adminApi.security() });
  const jobs = useQuery({ queryKey: ['admin', 'jobs'], queryFn: () => adminApi.jobOverview() });
  const info = useQuery({ queryKey: ['admin', 'info'], queryFn: () => adminApi.systemInfo() });

  if (overview.isLoading || security.isLoading || jobs.isLoading || info.isLoading) return <LoadingState />;
  if (overview.isError) return <ErrorState onRetry={() => void overview.refetch()} />;

  const cards = [
    { label: t('dashboard.users_total'), value: overview.data?.users.total },
    { label: t('dashboard.users_active'), value: overview.data?.users.active },
    { label: t('dashboard.users_disabled'), value: overview.data?.users.disabled },
    { label: t('dashboard.new_24h'), value: overview.data?.users.newLast24h },
    { label: t('dashboard.new_7d'), value: overview.data?.users.newLast7d },
    { label: t('dashboard.sessions'), value: overview.data?.sessions },
    { label: t('dashboard.logins_7d'), value: security.data?.loginCount },
    { label: t('dashboard.failed_logins_7d'), value: security.data?.failedLogins },
    { label: t('dashboard.active_jobs'), value: jobs.data?.active },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3"
          >
            <p className="text-xs text-[var(--color-content-muted)]">{card.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatNumber(card.value ?? 0, { maximumFractionDigits: 0 })}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--color-border-subtle)] p-3 text-sm">
        <p className="mb-2 font-medium">{t('dashboard.system')}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-4">
          <div>
            <dt className="text-[var(--color-content-muted)]">{t('dashboard.version')}</dt>
            <dd>{info.data?.version}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-content-muted)]">{t('dashboard.node')}</dt>
            <dd>{info.data?.node}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-content-muted)]">{t('dashboard.uptime')}</dt>
            <dd>{formatNumber(info.data?.uptimeSeconds ?? 0, { maximumFractionDigits: 0 })}s</dd>
          </div>
          <div>
            <dt className="text-[var(--color-content-muted)]">{t('dashboard.memory')}</dt>
            <dd>{formatNumber(info.data?.memoryMb ?? 0, { maximumFractionDigits: 0 })} MB</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function UsersTab() {
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
    <div className="space-y-3">
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
            <li key={user.id} className="rounded-xl border border-[var(--color-border-subtle)] p-3 text-sm">
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

function AdminsTab() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const admins = useQuery({ queryKey: ['admin', 'admins'], queryFn: () => adminApi.admins() });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'grant' | 'revoke' }) =>
      input.action === 'grant' ? adminApi.grant(input.id) : adminApi.revoke(input.id),
    onSuccess: () => {
      setError(null);
      setTargetId('');
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="block text-[var(--color-content-muted)]">{t('admins.grant_hint')}</span>
          <input
            className="input mt-1 w-64"
            placeholder={t('admins.grant_placeholder')}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!targetId || act.isPending}
          onClick={() => act.mutate({ id: targetId, action: 'grant' })}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          {t('admins.grant')}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {admins.data && (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
          {admins.data.admins.length === 0 && (
            <li className="p-3 text-sm text-[var(--color-content-muted)]">{t('admins.empty')}</li>
          )}

          {admins.data.admins.map((admin) => (
            <li key={admin.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <p className="font-medium">
                  {admin.email} · {t(`roles.${admin.role}`)}
                </p>
                <p className="text-xs text-[var(--color-content-muted)]">{formatDateTime(admin.createdAt)}</p>
              </div>

              {admin.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => act.mutate({ id: admin.id, action: 'revoke' })}
                  className="rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400"
                >
                  {t('admins.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SystemTab() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const registration = useQuery({ queryKey: ['admin', 'registration'], queryFn: () => adminApi.registration() });
  const jobs = useQuery({ queryKey: ['admin', 'job-list'], queryFn: () => adminApi.jobs(1) });
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => adminApi.auditLogs(1) });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => adminApi.setRegistration(enabled),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--color-border-subtle)] p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">{t('system.registration')}</p>
            <p className="text-xs text-[var(--color-content-muted)]">{t('system.registration_hint')}</p>
          </div>
          <button
            type="button"
            onClick={() => toggle.mutate(!registration.data?.enabled)}
            disabled={registration.isLoading || toggle.isPending}
            className={`rounded-lg px-3 py-1.5 text-xs text-white ${
              registration.data?.enabled ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          >
            {registration.data?.enabled ? t('system.registration_on') : t('system.registration_off')}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t('system.jobs')}</h2>
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] text-sm">
          {jobs.data?.jobs.length === 0 && (
            <li className="p-3 text-[var(--color-content-muted)]">{t('dashboard.active_jobs')}: 0</li>
          )}
          {jobs.data?.jobs.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-2 p-3">
              <span>
                {job.kind} · {job.status}
                {job.failureCode && ` · ${job.failureCode}`}
              </span>
              <span className="text-xs text-[var(--color-content-muted)]">{formatDateTime(job.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">{t('system.audit_title')}</h2>
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)] text-sm">
          {audit.data?.logs.map((log) => (
            <li key={log.id} className="flex items-center justify-between gap-2 p-3">
              <span>
                {log.action} · {log.targetType ?? '—'}
              </span>
              <span className="text-xs text-[var(--color-content-muted)]">{formatDateTime(log.createdAt)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export type { AdminUser };
