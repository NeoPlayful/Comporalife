import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { adminApi, type AdminAuditFilters } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 10;

/** 元数据只展示服务端白名单放行的标量字段，键名直接呈现，避免误读 */
function MetadataList({ metadata }: { metadata: Record<string, unknown> | null }) {
  const entries = metadata ? Object.entries(metadata) : [];
  if (entries.length === 0) return <span className="text-xs text-[var(--color-content-muted)]">—</span>;

  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center gap-1 rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[11px]"
        >
          <span className="text-[var(--color-content-muted)]">{key}</span>
          <span className="font-mono">{String(value)}</span>
        </span>
      ))}
    </span>
  );
}

export default function AdminAuditPage() {
  const { t } = useTranslation('admin');
  const [filters, setFilters] = useState<AdminAuditFilters>({ page: 1, pageSize: PAGE_SIZE });
  const [draft, setDraft] = useState({ action: '', actorId: '', targetId: '', from: '', to: '' });

  const query = useQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: () => adminApi.auditLogs(filters),
  });

  const logs = query.data?.data.logs ?? [];
  const pagination = query.data?.pagination ?? null;

  function applyFilters() {
    setFilters({
      page: 1,
      ...(draft.action ? { action: draft.action } : {}),
      ...(draft.actorId ? { actorId: draft.actorId } : {}),
      ...(draft.targetId ? { targetId: draft.targetId } : {}),
      ...(draft.from ? { from: draft.from } : {}),
      ...(draft.to ? { to: draft.to } : {}),
      pageSize: PAGE_SIZE,
    });
  }

  function resetFilters() {
    setDraft({ action: '', actorId: '', targetId: '', from: '', to: '' });
    setFilters({ page: 1, pageSize: PAGE_SIZE });
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold">{t('audit.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('audit.subtitle')}</p>
      </header>

      <div className="card flex flex-wrap items-end gap-2 p-3">
        <label className="w-44 text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.action')}</span>
          <input
            className="input"
            placeholder={t('audit.filter.action_placeholder')}
            value={draft.action}
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
          />
        </label>

        <label className="w-36 text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.from')}</span>
          <input
            type="date"
            className="input"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>

        <label className="w-36 text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.to')}</span>
          <input
            type="date"
            className="input"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>

        <label className="w-48 text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.actor')}</span>
          <input
            className="input font-mono text-xs"
            placeholder={t('audit.filter.id_placeholder')}
            value={draft.actorId}
            onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
          />
        </label>

        <label className="w-48 text-sm">
          <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.target')}</span>
          <input
            className="input font-mono text-xs"
            placeholder={t('audit.filter.id_placeholder')}
            value={draft.targetId}
            onChange={(event) => setDraft({ ...draft, targetId: event.target.value })}
          />
        </label>

        <div className="flex gap-2 pb-0.5">
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-lg btn-action px-3 py-1.5 text-sm"
          >
            {t('audit.filter.apply')}
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
          >
            {t('audit.filter.reset')}
          </button>
        </div>
      </div>

      {query.isLoading && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}

      {query.data && logs.length === 0 && (
        <EmptyState title={t('audit.empty.title')} description={t('audit.empty.description')} />
      )}

      {logs.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">{t('audit.table.time')}</th>
                <th className="px-3 py-2">{t('audit.table.action')}</th>
                <th className="px-3 py-2">{t('audit.table.actor')}</th>
                <th className="px-3 py-2">{t('audit.table.target')}</th>
                <th className="px-3 py-2">{t('audit.table.ip')}</th>
                <th className="px-3 py-2">{t('audit.table.detail')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {logs.map((log) => (
                <tr key={log.id} className="align-top hover:bg-black/5 dark:hover:bg-white/5">
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium">
                      {t(`audit.actions.${log.action}`, { defaultValue: log.action })}
                    </span>
                    <span className="ml-1.5 font-mono text-xs text-[var(--color-content-muted)]">
                      · {log.action}
                    </span>
                  </td>
                  <td className="px-3 py-2">{log.actorEmail ?? t('audit.unknown_actor')}</td>
                  <td className="px-3 py-2">
                    {log.targetType ? (
                      <>
                        <span className="text-xs text-[var(--color-content-muted)]">{log.targetType}</span>
                        {log.targetId && (
                          <span className="ml-1 font-mono text-xs">· {log.targetId.slice(0, 8)}…</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[var(--color-content-muted)]">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[var(--color-content-muted)]">
                    {log.ip ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <MetadataList metadata={log.metadata} />
                  </td>
                </tr>
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
          onPageChange={(next) => setFilters({ ...filters, page: next })}
          onPageSizeChange={(size) => setFilters({ ...filters, page: 1, pageSize: size })}
        />
      )}
    </div>
  );
}
