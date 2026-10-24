import BackupPanel from '@/components/data/BackupPanel';
import ExportPanel from '@/components/data/ExportPanel';
import JobList from '@/components/data/JobList';
import QualityDetailTable from '@/components/data/QualityDetailTable';
import QualitySummaryCards from '@/components/data/QualitySummaryCards';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { dataQualityApi } from '@/lib/data-management';
import { formatDateTime } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Tab = 'quality' | 'export' | 'backup' | 'jobs';

export default function DataPage() {
  const { t } = useTranslation('data');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('quality');
  const [metricKey, setMetricKey] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ['quality', 'summary'],
    queryFn: () => dataQualityApi.summary(),
    enabled: tab === 'quality',
  });

  const recheck = useMutation({
    mutationFn: () => dataQualityApi.recheck(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['quality'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-[var(--color-border-subtle)] pb-2">
        {(['quality', 'export', 'backup', 'jobs'] as Tab[]).map((key) => (
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
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'quality' && (
        <div className="space-y-4">
          {summary.isLoading && <LoadingState />}
          {summary.isError && <ErrorState onRetry={() => void summary.refetch()} />}

          {summary.data && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[var(--color-content-muted)]">
                  {t('quality.checked_at', { time: formatDateTime(summary.data.checkedAt) })} ·{' '}
                  {t('quality.lookback', { months: summary.data.lookbackMonths })}
                </p>
                <button
                  type="button"
                  onClick={() => recheck.mutate()}
                  disabled={recheck.isPending}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                >
                  {recheck.isSuccess ? t('quality.rechecking') : t('quality.recheck')}
                </button>
              </div>

              <QualitySummaryCards
                metrics={summary.data.metrics}
                activeKey={metricKey}
                onSelect={(key) => setMetricKey(metricKey === key ? null : key)}
              />

              {metricKey && (
                <section className="space-y-2">
                  <h2 className="text-sm font-semibold">{t('quality.detail_title')}</h2>
                  <QualityDetailTable metricKey={metricKey} />
                </section>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'export' && <ExportPanel />}
      {tab === 'backup' && <BackupPanel />}
      {tab === 'jobs' && <JobList />}
    </div>
  );
}
