import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/components/ui/EmptyState';
import { ApiError } from '@/lib/client';
import { backupsApi, type BackupRecord } from '@/lib/data-management';
import { downloadUrlAsFile } from '@/lib/download';
import { translateError } from '@/lib/error-message';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';
import RestoreWizard from './RestoreWizard';

export default function BackupPanel() {
  const { t } = useTranslation('data');
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);

  const [restoring, setRestoring] = useState<BackupRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['backups'],
    queryFn: () => backupsApi.list({}),
    refetchInterval: (query) =>
      query.state.data?.backups.some((item) => item.status === 'creating') ? 2000 : false,
  });

  const create = useMutation({
    mutationFn: () => backupsApi.create(),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => backupsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
  });

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--color-content-muted)]">{t('backup.hint')}</p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {create.isPending ? t('backup.creating') : t('backup.create')}
        </button>
        {create.isSuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400">{t('backup.created')}</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('backup.list_title')}</h3>

        {list.data?.backups.length === 0 ? (
          <EmptyState title={t('backup.empty')} description="" />
        ) : (
          <ul className="space-y-2">
            {list.data?.backups.map((item) => (
              <li key={item.id} className="rounded-xl border border-[var(--color-border-subtle)] p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{t(`backup.status.${item.status}`)}</p>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {formatDateTime(item.createdAt)} ·{' '}
                      {t('export.size', {
                        size: `${formatNumber(Math.round(item.sizeBytes / 1024), { maximumFractionDigits: 0 })} KB`,
                      })}
                      {item.sha256 && ` · ${item.sha256.slice(0, 12)}…`}
                    </p>
                    <p className="text-xs text-[var(--color-content-muted)]">
                      {item.restoreCount > 0
                        ? t('backup.restore_count', { count: item.restoreCount })
                        : t('backup.never_restored')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={item.status !== 'ready'}
                      onClick={() => setRestoring(item)}
                      className="flex items-center gap-1 rounded-lg border border-amber-500/50 px-2.5 py-1.5 text-amber-700 disabled:opacity-40 dark:text-amber-400"
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      {t('backup.restore')}
                    </button>
                    <button
                      type="button"
                      disabled={item.status !== 'ready'}
                      onClick={() =>
                        void downloadUrlAsFile(
                          backupsApi.downloadUrl(item.id),
                          accessToken,
                          `backup-${item.id}.json.enc`,
                        )
                      }
                      className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2.5 py-1.5 disabled:opacity-40"
                    >
                      <Download className="size-3.5" aria-hidden />
                      {t('backup.download')}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      className="rounded-lg border border-[var(--color-border-subtle)] px-2 py-1.5 text-red-600 dark:text-red-400"
                      aria-label={t('backup.delete')}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>

                {restoring?.id === item.id && (
                  <div className="mt-3">
                    <RestoreWizard
                      backup={item}
                      onCancel={() => setRestoring(null)}
                      onDone={() => {
                        setRestoring(null);
                        void queryClient.invalidateQueries();
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
