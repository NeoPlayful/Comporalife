import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/components/ui/EmptyState';
import { ApiError } from '@/lib/client';
import { exportsApi, type ExportDetail, type ExportScope } from '@/lib/data-management';
import { translateError } from '@/lib/error-message';
import { formatDateTime, formatNumber } from '@/lib/format';
import { downloadUrlAsFile } from '@/lib/download';
import { toastError, toastSuccess } from '@/lib/toast';
import { useAuthStore } from '@/stores/auth-store';

const SCOPES: ExportScope[] = ['full', 'ledger', 'investments', 'simulations', 'planning', 'settings'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export default function ExportPanel() {
  const { t } = useTranslation(['data', 'enums']);
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);

  const [scope, setScope] = useState<ExportScope>('full');
  const [useRange, setUseRange] = useState(false);
  const [from, setFrom] = useState(firstDayOfYear());
  const [to, setTo] = useState(today());
  const [includeArchived, setIncludeArchived] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['exports'],
    queryFn: () => exportsApi.list({}),
    // 后台任务完成前需要看到状态变化
    refetchInterval: (query) =>
      query.state.data?.exports.some((item) => item.status === 'queued' || item.status === 'running') ? 2000 : false,
  });

  const detail = useQuery({
    queryKey: ['export', selected],
    queryFn: () => exportsApi.detail(selected!),
    enabled: Boolean(selected),
  });

  const create = useMutation({
    mutationFn: () =>
      exportsApi.create({
        scope,
        includeArchived,
        ...(useRange ? { from, to } : {}),
      }),
    onSuccess: (result) => {
      toastSuccess(
        result.async
          ? t('export.async_queued', { rows: result.estimatedRows })
          : t('export.sync_done', { rows: result.rowCount }),
      );
      void queryClient.invalidateQueries({ queryKey: ['exports'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toastError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => exportsApi.remove(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.deleted'));
      queryClient.invalidateQueries({ queryKey: ['exports'] });
    },
  });

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--color-content-muted)]">{t('export.hint')}</p>

      <div className="space-y-4 rounded-xl border border-[var(--color-border-subtle)] p-4">
        <div>
          <label className="block text-sm font-medium">{t('export.scope')}</label>
          <select
            className="input mt-1 w-full"
            value={scope}
            onChange={(event) => setScope(event.target.value as ExportScope)}
          >
            {SCOPES.map((item) => (
              <option key={item} value={item}>
                {t(`export.scopes.${item}`)}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useRange} onChange={(event) => setUseRange(event.target.checked)} />
          {t('export.range_hint')}
        </label>

        {useRange && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-[var(--color-content-muted)]">{t('export.from')}</span>
              <input type="date" className="input mt-1 w-full" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-[var(--color-content-muted)]">{t('export.to')}</span>
              <input type="date" className="input mt-1 w-full" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          {t('export.include_archived')}
        </label>

        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="rounded-lg btn-action px-4 py-2 text-sm font-medium"
        >
          {create.isPending ? t('export.creating') : t('export.create')}
        </button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('export.list_title')}</h3>

        {list.data?.exports.length === 0 ? (
          <EmptyState title={t('export.empty')} description="" />
        ) : (
          <ul className="space-y-2">
            {list.data?.exports.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-[var(--color-border-subtle)] p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {t(`export.scopes.${item.scope}`)} · {t(`export.status.${item.status}`)}
                    </p>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {formatDateTime(item.createdAt)}
                      {item.rowCount !== null && ` · ${t('export.row_count', { rows: item.rowCount })}`}
                      {item.sizeBytes !== null &&
                        ` · ${t('export.size', { size: `${formatNumber(Math.round(item.sizeBytes / 1024), { maximumFractionDigits: 0 })} KB` })}`}
                    </p>
                    {item.expiresAt && (
                      <p className="text-xs text-[var(--color-content-muted)]">
                        {t('export.expires', { time: formatDateTime(item.expiresAt) })}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={item.status !== 'ready'}
                      onClick={() =>
                        void downloadUrlAsFile(exportsApi.downloadUrl(item.id), accessToken, `export-${item.id}.zip`)
                      }
                      className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 disabled:opacity-40"
                    >
                      <Download className="size-3.5" aria-hidden />
                      {t('export.download')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelected(item.id === selected ? null : item.id)}
                      className="rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5"
                    >
                      {t('export.manifest')}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1.5 text-red-600 dark:text-red-400"
                      aria-label={t('export.delete')}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>

                {selected === item.id && detail.data && <ManifestBlock detail={detail.data.export} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ManifestBlock({ detail }: { detail: ExportDetail }) {
  const { t } = useTranslation('data');
  const manifest = detail.manifest;
  if (!manifest) return null;

  const completeness = manifest.completeness;

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-black/5 p-3 text-xs dark:bg-white/5">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {manifest.files.map((file) => (
          <span key={file.name}>
            {file.name} · {file.rows}
          </span>
        ))}
      </div>

      <div>
        <p className="font-medium">{t('export.completeness_title')}</p>
        <p className={completeness.isComplete ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
          {completeness.isComplete ? t('export.complete') : t('export.incomplete')}
        </p>
        {completeness.missingMonths.length > 0 && (
          <p>{t('export.missing_months', { months: completeness.missingMonths.join('、') })}</p>
        )}
        {completeness.unpricedSymbols.length > 0 && <p>{completeness.unpricedSymbols.join(', ')}</p>}
      </div>

      <div>
        <p className="font-medium">{t('export.excluded_title')}</p>
        <ul className="mt-1 space-y-0.5">
          {manifest.excluded.map((item) => (
            <li key={item.key}>
              <span className="font-mono">{item.key}</span> · {item.reason}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
