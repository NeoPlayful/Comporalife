import ErrorState from '@/components/ui/ErrorState';
import { adminApi } from '@/lib/admin';
import { formatDate, formatNumber } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

/** 单个聚合区块：每个查询独立处理加载与失败，失败不静默显示为 0 */
function Section({
  title,
  query,
  children,
}: {
  title: string;
  query: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  children: React.ReactNode;
}) {
  const { t } = useTranslation('admin');

  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {query.isLoading && <p className="text-xs text-[var(--color-content-muted)]">{t('common:actions.loading')}</p>}
      {query.isError && (
        <p className="text-xs text-[var(--color-negative)]">
          {t('dashboard.load_failed')}{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </button>
        </p>
      )}
      {!query.isLoading && !query.isError && children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-content-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">
        {formatNumber(value ?? 0, { maximumFractionDigits: 0 })}
      </p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { t } = useTranslation('admin');
  const overview = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => adminApi.overview() });
  const security = useQuery({ queryKey: ['admin', 'security'], queryFn: () => adminApi.security() });
  const jobs = useQuery({ queryKey: ['admin', 'jobs'], queryFn: () => adminApi.jobOverview() });
  const info = useQuery({ queryKey: ['admin', 'info'], queryFn: () => adminApi.systemInfo() });
  const trend = useQuery({ queryKey: ['admin', 'registrations'], queryFn: () => adminApi.registrations() });

  const points = trend.data?.points ?? [];
  // 趋势用横向条表示：管理员关心的是「哪天多」，不需要读精确刻度
  const maxCount = points.reduce((max, point) => Math.max(max, point.count), 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">{t('dashboard.accounts')}</h2>
        {overview.isLoading && (
          <p className="text-xs text-[var(--color-content-muted)]">{t('common:actions.loading')}</p>
        )}
        {overview.isError && <ErrorState onRetry={() => void overview.refetch()} />}
        {overview.data && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('dashboard.users_total')} value={overview.data.users.total} />
            <Stat label={t('dashboard.users_active')} value={overview.data.users.active} />
            <Stat label={t('dashboard.users_disabled')} value={overview.data.users.disabled} />
            <Stat label={t('dashboard.sessions')} value={overview.data.sessions} />
            <Stat label={t('dashboard.new_24h')} value={overview.data.users.newLast24h} />
            <Stat label={t('dashboard.new_7d')} value={overview.data.users.newLast7d} />
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('dashboard.security_title')} query={security}>
          {security.data && (
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('dashboard.logins_7d')} value={security.data.loginCount} />
              <Stat label={t('dashboard.failed_logins_7d')} value={security.data.failedLogins} />
              <Stat label={t('dashboard.users_disabled')} value={security.data.disabledUsers} />
            </div>
          )}
        </Section>

        <Section title={t('dashboard.jobs_title')} query={jobs}>
          {jobs.data && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Stat label={t('dashboard.jobs_tasks_active')} value={jobs.data.tasks.active} />
                <Stat label={t('dashboard.jobs_runs_active')} value={jobs.data.runs.active} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(jobs.data.tasks.counts).map(([status, count]) => (
                  <div key={`task-${status}`} className="flex justify-between">
                    <dt className="text-[var(--color-content-muted)]">{t(`dashboard.job_status.${status}`, { defaultValue: status })}</dt>
                    <dd className="tabular-nums">{count}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Section>
      </div>

      <Section title={t('dashboard.trend_title')} query={trend}>
        {points.length === 0 ? (
          <p className="text-xs text-[var(--color-content-muted)]">{t('dashboard.trend_empty')}</p>
        ) : (
          <ul className="space-y-1">
            {points.slice(-14).map((point) => (
              <li key={point.date} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-[var(--color-content-muted)]">
                  {formatDate(point.date)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                  <span
                    className="block h-full rounded-full bg-[var(--color-accent)]"
                    style={{ width: `${maxCount > 0 ? (point.count / maxCount) * 100 : 0}%` }}
                  />
                </span>
                <span className="w-6 shrink-0 text-right tabular-nums">{point.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('dashboard.system')} query={info}>
        {info.data && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-5">
            <div>
              <dt className="text-[var(--color-content-muted)]">{t('dashboard.version')}</dt>
              <dd>{info.data.version}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-content-muted)]">{t('dashboard.node')}</dt>
              <dd>{info.data.node}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-content-muted)]">{t('dashboard.uptime')}</dt>
              <dd>{formatNumber(info.data.uptimeSeconds, { maximumFractionDigits: 0 })}s</dd>
            </div>
            <div>
              <dt className="text-[var(--color-content-muted)]">{t('dashboard.memory')}</dt>
              <dd>{formatNumber(info.data.memoryMb, { maximumFractionDigits: 0 })} MB</dd>
            </div>
            <div>
              <dt className="text-[var(--color-content-muted)]">{t('dashboard.database')}</dt>
              <dd
                className={
                  info.data.database === 'ok'
                    ? 'text-[var(--color-positive)]'
                    : 'text-[var(--color-negative)]'
                }
              >
                {t(`dashboard.db_status.${info.data.database}`)}
              </dd>
            </div>
          </dl>
        )}
      </Section>
    </div>
  );
}
