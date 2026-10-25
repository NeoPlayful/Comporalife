import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { auditApi, type AuditLogItem } from '@/lib/data-management';
import { formatDateTime } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 20;

/** 只展示白名单字段：不出现金额、流水内容或原始 IP */
function AuditItem({ item }: { item: AuditLogItem }) {
  const { t } = useTranslation('audit');

  return (
    <li className="card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{t(`actions.${item.action}`, { defaultValue: item.action })}</p>
        <p className="text-xs text-[var(--color-content-muted)]">{formatDateTime(item.createdAt)}</p>
      </div>
      <p className="mt-1 text-xs text-[var(--color-content-muted)]">
        {item.targetType ?? '—'}
        {item.targetId ? ` · ${item.targetId.slice(0, 8)}…` : ''}
        {item.ip ? ` · ${item.ip}` : ''}
      </p>
    </li>
  );
}

export default function AuditPage() {
  const { t } = useTranslation('audit');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState({ action: '', from: '', to: '' });

  const query = useQuery({
    queryKey: ['audit', page, applied],
    queryFn: () =>
      auditApi.list({
        page,
        pageSize: PAGE_SIZE,
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
        <ul className="space-y-1.5">
          {items.map((item) => (
            <AuditItem key={item.id} item={item} />
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
        />
      )}
    </div>
  );
}
