import { adminApi } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function AdminSystemPage() {
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
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('system.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <section className="card p-4 text-sm">
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
      </section>

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
