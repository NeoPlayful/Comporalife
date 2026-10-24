import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { adminApi } from '@/lib/admin';
import { formatNumber } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

export default function AdminDashboardPage() {
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
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="card p-4">
            <p className="text-xs text-[var(--color-content-muted)]">{card.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatNumber(card.value ?? 0, { maximumFractionDigits: 0 })}
            </p>
          </div>
        ))}
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-medium">{t('dashboard.system')}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-4">
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
      </section>
    </div>
  );
}
