import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import LoadingState from '@/components/ui/LoadingState';
import { ApiError } from '@/lib/client';
import { backupsApi, BACKUP_DOMAINS, type BackupDomain, type BackupRecord } from '@/lib/data-management';
import { translateError } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';

interface Props {
  backup: BackupRecord;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * 恢复向导：预览 → 选择 → 确认。
 *
 * 强制先预览：不看到影响面就执行恢复，等于闭着眼睛覆盖数据。
 * 确认标记要求手输 RESTORE，避免误点。
 */
export default function RestoreWizard({ backup, onDone, onCancel }: Props) {
  const { t } = useTranslation(['data', 'enums']);
  const queryClient = useQueryClient();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedDomains, setSelectedDomains] = useState<BackupDomain[]>(BACKUP_DOMAINS as BackupDomain[]);
  const [policy, setPolicy] = useState<'skip' | 'overwrite'>('skip');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ written: number; skipped: number } | null>(null);

  const preview = useQuery({
    queryKey: ['backup-preview', backup.id],
    queryFn: () => backupsApi.preview(backup.id),
    enabled: step === 2,
  });

  const restore = useMutation({
    mutationFn: () => backupsApi.restore(backup.id, { domains: selectedDomains, conflict: policy, confirm }),
    onSuccess: (data) => {
      setError(null);
      setResult({
        written: data.domains.reduce((sum, item) => sum + item.written, 0),
        skipped: data.domains.reduce((sum, item) => sum + item.skipped, 0),
      });
      void queryClient.invalidateQueries();
    },
    onError: (err) => setError(err instanceof ApiError ? translateError(err, t) : String(err)),
  });

  function toggleDomain(domain: BackupDomain) {
    setSelectedDomains((current) =>
      current.includes(domain) ? current.filter((item) => item !== domain) : [...current, domain],
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
        <h3 className="text-sm font-semibold">{t('backup.wizard.title')}</h3>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs text-[var(--color-content-muted)]">
        {[1, 2, 3].map((index) => (
          <li
            key={index}
            className={`rounded-full px-2.5 py-1 ${
              step === index ? 'btn-action' : 'bg-black/5 dark:bg-white/10'
            }`}
          >
            {t(`backup.wizard.step${index}`)}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-3 text-sm">
          <p>{t('backup.wizard.created_at', { time: formatDateTime(backup.createdAt) })}</p>
          <p className="text-xs text-[var(--color-content-muted)]">{t('backup.wizard.warning')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
            >
              {t('backup.wizard.cancel')}
            </button>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="flex items-center gap-1 rounded-lg btn-action px-3 py-1.5 text-sm"
            >
              {t('backup.wizard.next')}
              <ArrowRight className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {preview.isLoading && <LoadingState />}
          {preview.data && (
            <>
              <h4 className="text-sm font-medium">{t('backup.wizard.domains')}</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-[var(--color-content-muted)]">
                    <tr>
                      <th className="text-left">{t('backup.wizard.domain')}</th>
                      <th className="text-right">{t('backup.wizard.insert')}</th>
                      <th className="text-right">{t('backup.wizard.overwrite')}</th>
                      <th className="text-right">{t('backup.wizard.conflict')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.preview.domains.map((item) => (
                      <tr key={item.domain} className="border-t border-[var(--color-border-subtle)]">
                        <td className="py-1.5">{t(`enums:backup_domain.${item.domain}`, { defaultValue: item.domain })}</td>
                        <td className="text-right tabular-nums">{item.insert}</td>
                        <td className="text-right tabular-nums">{item.overwrite}</td>
                        <td className="text-right tabular-nums">{item.conflict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.data.preview.conflicts.length > 0 && (
                <div className="text-xs">
                  <p className="font-medium">{t('backup.wizard.conflicts_title')}</p>
                  <ul className="mt-1 space-y-0.5 text-[var(--color-content-muted)]">
                    {preview.data.preview.conflicts.slice(0, 10).map((conflict) => (
                      <li key={`${conflict.domain}-${conflict.key}`}>
                        {conflict.domain}: {conflict.key}
                      </li>
                    ))}
                  </ul>
                  {preview.data.preview.truncated && <p>{t('backup.wizard.truncated')}</p>}
                </div>
              )}

              <p className="text-xs text-[var(--color-content-muted)]">{t('backup.wizard.warning')}</p>
            </>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              {t('backup.wizard.back')}
            </button>
            <button
              type="button"
              disabled={preview.isLoading}
              onClick={() => setStep(3)}
              className="flex items-center gap-1 rounded-lg btn-action px-3 py-1.5 text-sm"
            >
              {t('backup.wizard.next')}
              <ArrowRight className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 text-sm">
          {result ? (
            <p className="text-emerald-600 dark:text-emerald-400">
              {t('backup.wizard.result', { written: result.written, skipped: result.skipped })}
            </p>
          ) : (
            <>
              <div>
                <p className="mb-1.5 font-medium">{t('backup.wizard.select_domains')}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {BACKUP_DOMAINS.map((domain) => (
                    <label key={domain} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedDomains.includes(domain)}
                        onChange={() => toggleDomain(domain)}
                      />
                      {t(`enums:backup_domain.${domain}`, { defaultValue: domain })}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 font-medium">{t('backup.wizard.policy')}</p>
                <label className="mr-4 inline-flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="policy"
                    checked={policy === 'skip'}
                    onChange={() => setPolicy('skip')}
                  />
                  {t('backup.wizard.policy_skip')}
                </label>
                <label className="inline-flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="policy"
                    checked={policy === 'overwrite'}
                    onChange={() => setPolicy('overwrite')}
                  />
                  {t('backup.wizard.policy_overwrite')}
                </label>
              </div>

              <div>
                <p className="mb-1.5 font-medium">{t('backup.wizard.confirm_hint')}</p>
                <input
                  className="input w-full"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder={t('backup.wizard.confirm_placeholder')}
                  autoComplete="off"
                />
              </div>

              {error && <p className="text-red-600 dark:text-red-400">{error}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5"
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {t('backup.wizard.back')}
                </button>
                <button
                  type="button"
                  disabled={confirm !== 'RESTORE' || selectedDomains.length === 0 || restore.isPending}
                  onClick={() => restore.mutate()}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-white disabled:opacity-40"
                >
                  {restore.isPending ? t('backup.wizard.executing') : t('backup.wizard.execute')}
                </button>
              </div>
            </>
          )}

          <button type="button" onClick={onDone} className="text-xs underline">
            {t('backup.wizard.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
