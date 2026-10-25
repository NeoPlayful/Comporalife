import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { adminApi, type AdminAuditFilters } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 20;

/** 元数据只展示服务端白名单放行的标量字段，键名直接呈现，避免误读 */
function MetadataList({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return null;
  const entries = Object.entries(metadata);
  if (entries.length === 0) return null;

  return (
    <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-content-muted)]">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-1">
          <dt className="opacity-70">{key}</dt>
          <dd className="font-mono">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AdminAuditPage() {
  const { t } = useTranslation('admin');
  const [filters, setFilters] = useState<AdminAuditFilters>({ page: 1 });
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

      <div className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.action')}</span>
            <input
              className="input w-full"
              placeholder={t('audit.filter.action_placeholder')}
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.from')}</span>
            <input
              type="date"
              className="input w-full"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.to')}</span>
            <input
              type="date"
              className="input w-full"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.actor')}</span>
            <input
              className="input w-full font-mono text-xs"
              placeholder={t('audit.filter.id_placeholder')}
              value={draft.actorId}
              onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{t('audit.filter.target')}</span>
            <input
              className="input w-full font-mono text-xs"
              placeholder={t('audit.filter.id_placeholder')}
              value={draft.targetId}
              onChange={(event) => setDraft({ ...draft, targetId: event.target.value })}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white"
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
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
          {logs.map((log) => (
            <li key={log.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{t(`audit.actions.${log.action}`, { defaultValue: log.action })}</p>
                <p className="text-xs text-[var(--color-content-muted)]">{formatDateTime(log.createdAt)}</p>
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
                {t('audit.by', { actor: log.actorEmail ?? t('audit.unknown_actor') })}
                {log.targetType ? ` · ${t('audit.target', { type: log.targetType })}` : ''}
                {log.targetId ? ` · ${log.targetId.slice(0, 8)}…` : ''}
                {log.ip ? ` · ${log.ip}` : ''}
              </p>
              <MetadataList metadata={log.metadata} />
            </li>
          ))}
        </ul>
      )}

      {pagination && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={(next) => setFilters({ ...filters, page: next })}
        />
      )}
    </div>
  );
}
