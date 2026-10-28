import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/components/ui/EmptyState';
import { ApiError } from '@/lib/client';
import { jobsApi, type JobItem } from '@/lib/data-management';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDateTime } from '@/lib/format';

type Filter = 'all' | 'running' | 'failed';

export default function JobList({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation(['data', 'enums']);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');

  const query = useQuery({
    queryKey: ['jobs', filter],
    queryFn: () =>
      jobsApi.list({
        ...(filter === 'running' ? { status: 'running' } : {}),
        ...(filter === 'failed' ? { status: 'failed' } : {}),
      }),
    // 有未结束任务时轮询：任务面板不轮询等于要用户手动刷新
    refetchInterval: (state) =>
      state.state.data?.items.some((item) => item.status === 'queued' || item.status === 'running') ? 1500 : false,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => jobsApi.cancel(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.cancelled'));
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toastError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  const retry = useMutation({
    mutationFn: (id: string) => jobsApi.retry(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.submitted'));
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (err) => toastError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(['all', 'running', 'failed'] as Filter[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === key ? 'btn-action' : 'bg-black/5 dark:bg-white/10'
            }`}
          >
            {t(`jobs.filter_${key}`)}
          </button>
        ))}
      </div>

      {query.data?.items.length === 0 ? (
        <EmptyState title={t('jobs.empty')} description="" />
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-xl border border-[var(--color-border-subtle)]">
          {query.data?.items.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{t(`enums:task_kind.${job.kind}`, { defaultValue: job.kind })}</p>
                <p className="text-xs text-[var(--color-content-muted)]">
                  {t(`jobs.status.${job.status}`)} · {formatDateTime(job.createdAt)}
                  {job.failureCode && ` · ${job.failureCode}`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {(job.status === 'running' || job.status === 'queued') && (
                  <>
                    <ProgressBar value={Number(job.progress)} />
                    <button
                      type="button"
                      onClick={() => cancel.mutate(job.id)}
                      className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                    >
                      <Ban className="size-3" aria-hidden />
                      {t('jobs.cancel')}
                    </button>
                  </>
                )}

                {job.status === 'failed' && !compact && (
                  <button
                    type="button"
                    onClick={() => retry.mutate(job.id)}
                    className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                  >
                    <RotateCw className="size-3" aria-hidden />
                    {t('jobs.retry')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
        <div className="h-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs tabular-nums text-[var(--color-content-muted)]">{percent}%</span>
    </div>
  );
}

export type { JobItem };
