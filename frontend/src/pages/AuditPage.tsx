import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { auditApi, type AuditLogItem } from '@/lib/data-management';
import { formatDateTime } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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

  const query = useQuery({
    queryKey: ['audit', page, action],
    queryFn: () => auditApi.list({ page, action: action || undefined }),
  });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          {t('filter.action')}
          <input
            className="input mt-1"
            placeholder={t('filter.action_placeholder')}
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}

      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title={t('empty.title')}
          description={page > 1 ? t('empty.no_more') : t('empty.description')}
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <ul className="space-y-1.5">
          {query.data.items.map((item) => (
            <AuditItem key={item.id} item={item} />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 disabled:opacity-50"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          {t('pagination.prev')}
        </button>
        <span className="text-[var(--color-content-muted)]">
          {t('pagination.page', { page })}
        </span>
        {/* 审计接口不返回总页数：本页满则允许继续翻，空页由用户看到空态后自行返回 */}
        <button
          type="button"
          className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 disabled:opacity-50"
          disabled={!query.data || query.data.items.length === 0}
          onClick={() => setPage(page + 1)}
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  );
}
