import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { auditApi, type AuditLogItem } from '@/lib/data-management';
import { formatDateTime } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 10;

/** 只展示白名单字段：不出现金额、流水内容或原始 IP */
function AuditRow({ item }: { item: AuditLogItem }) {
  const { t } = useTranslation('audit');

  return (
    <tr className="align-top hover:bg-black/5 dark:hover:bg-white/5">
      <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
        {formatDateTime(item.createdAt)}
      </td>
      <td className="px-3 py-2">
        <span className="font-medium">{t(`actions.${item.action}`, { defaultValue: item.action })}</span>
        <span className="ml-1.5 font-mono text-xs text-[var(--color-content-muted)]">· {item.action}</span>
      </td>
      <td className="px-3 py-2">
        {item.targetType ? (
          <>
            <span className="text-xs text-[var(--color-content-muted)]">{item.targetType}</span>
            {item.targetId && (
              <span className="ml-1 font-mono text-xs">· {item.targetId.slice(0, 8)}…</span>
            )}
          </>
        ) : (
          <span className="text-[var(--color-content-muted)]">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[var(--color-content-muted)]">
        {item.ip ?? '—'}
      </td>
    </tr>
  );
}

export default function AuditPage() {
  const { t } = useTranslation('audit');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ action: '', from: '', to: '' });

  const query = useQuery({
    queryKey: ['audit', page, pageSize, applied],
    queryFn: () =>
      auditApi.list({
        page,
        pageSize,
        ...(applied.action ? { action: applied.action } : {}),
        ...(applied.from ? { from: applied.from } : {}),
        ...(applied.to ? { to: applied.to } : {}),
      }),
  });

  const items = query.data?.data.items ?? [];
  const pagination = query.data?.pagination ?? null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ action, from, to });
          setPage(1);
        }}
      >
        <label className="text-sm">
          {t('filter.action')}
          <input
            className="input mt-1"
            placeholder={t('filter.action_placeholder')}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('filter.from')}
          <input
            type="date"
            className="input mt-1"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="text-sm">
          {t('filter.to')}
          <input
            type="date"
            className="input mt-1"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm text-white"
        >
          {t('filter.apply')}
        </button>
      </form>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}

      {query.data && items.length === 0 && (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      )}

      {items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">{t('table.time')}</th>
                <th className="px-3 py-2">{t('table.action')}</th>
                <th className="px-3 py-2">{t('table.target')}</th>
                <th className="px-3 py-2">{t('table.ip')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {items.map((item) => (
                <AuditRow key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
