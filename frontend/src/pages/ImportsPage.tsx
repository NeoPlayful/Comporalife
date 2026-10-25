import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import BatchStatusBadge from '@/components/imports/BatchStatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { translateError } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { importsApi, type ImportStatus } from '@/lib/imports';

const FILTER_KEYS: Array<ImportStatus | 'all'> = ['all', 'parsed', 'validated', 'completed', 'failed'];

export default function ImportsPage() {
  const [status, setStatus] = useState<ImportStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const { t } = useTranslation('imports');

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['imports', status, page],
    queryFn: () => importsApi.list(status, page, 20),
  });

  if (isPending) return <LoadingState label={t('loading_batches')} />;

  if (error) {
    return <ErrorState message={translateError(error, t)} onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex gap-2">
          <Link
            to="/imports/rules"
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
          >
            {t('rules_link')}
          </Link>
          <Link
            to="/imports/unmatched"
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
          >
            {t('unmatched_link')}
          </Link>
          <Link
            to="/imports/new"
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            {t('import_link')}
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTER_KEYS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1 text-sm ${
              status === value
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            {t(`filters.${value}`)}
          </button>
        ))}
      </div>

      {data.batches.length === 0 ? (
        <EmptyState
          title={t('empty_title')}
          description={t('empty_description')}
          action={
            <Link
              to="/imports/new"
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
            >
              {t('empty_action')}
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">{t('table.file')}</th>
                <th className="px-3 py-2 font-medium">{t('table.account')}</th>
                <th className="px-3 py-2 font-medium">{t('table.status')}</th>
                <th className="px-3 py-2 font-medium">{t('table.rows')}</th>
                <th className="px-3 py-2 font-medium">{t('table.imported')}</th>
                <th className="px-3 py-2 font-medium">{t('table.created_at')}</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.map((batch) => (
                <tr key={batch.id} className="border-b border-[var(--color-border-subtle)]/50 last:border-0">
                  <td className="px-3 py-2">
                    <Link to={`/imports/${batch.id}`} className="hover:text-[var(--color-accent)]">
                      {batch.originalFilename}
                    </Link>
                    <p className="text-xs text-[var(--color-content-muted)]">{batch.format.toUpperCase()}</p>
                  </td>
                  <td className="px-3 py-2">{batch.accountName}</td>
                  <td className="px-3 py-2">
                    <BatchStatusBadge status={batch.status} />
                  </td>
                  <td className="px-3 py-2">{batch.counts.total}</td>
                  <td className="px-3 py-2">{batch.counts.imported}</td>
                  <td className="px-3 py-2 text-[var(--color-content-muted)]">
                    {formatDateTime(batch.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={data.pagination.page}
        pageSize={data.pagination.pageSize}
        total={data.pagination.total}
        totalPages={data.pagination.totalPages}
        onPageChange={setPage}
      />
    </div>
  );
}
