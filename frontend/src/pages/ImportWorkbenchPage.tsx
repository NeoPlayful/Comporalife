import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import BatchStatusBadge from '@/components/imports/BatchStatusBadge';
import DuplicateReview from '@/components/imports/DuplicateReview';
import ImportStepper from '@/components/imports/ImportStepper';
import MappingEditor from '@/components/imports/MappingEditor';
import PreviewTable from '@/components/imports/PreviewTable';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { importsApi, type ColumnMapping, type CommitResult } from '@/lib/imports';

const DEFAULT_MAPPING: ColumnMapping = {
  occurredAt: 0,
  amountMode: 'signed',
  amount: 1,
  description: 2,
  dateFormat: 'YYYY-MM-DD',
};

export default function ImportWorkbenchPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { t } = useTranslation('imports');

  const [step, setStep] = useState(2);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [templateName, setTemplateName] = useState('');
  // 提交后的导入统计是结束页的核心内容，留在页面里；中途各步的结果走 toast
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const detail = useQuery({ queryKey: ['imports', id], queryFn: () => importsApi.detail(id) });
  const rowsQuery = useQuery({
    queryKey: ['imports', id, 'rows'],
    queryFn: () => importsApi.rows(id, 'all', 1, 200),
    enabled: step >= 3,
  });
  const duplicatesQuery = useQuery({
    queryKey: ['imports', id, 'duplicates'],
    queryFn: () => importsApi.duplicates(id),
    enabled: step === 4,
  });

  const batch = detail.data?.batch;
  const effectiveMapping = mapping ?? batch?.mapping ?? DEFAULT_MAPPING;
  const headers = batch?.headers ?? [];

  const dateSample = useMemo(() => {
    const first = rowsQuery.data?.rows.find((row) => row.occurredAt);
    return first?.occurredAt ? new Date(first.occurredAt).toISOString().slice(0, 10) : null;
  }, [rowsQuery.data]);

  const saveMapping = useMutation({
    mutationFn: () =>
      importsApi.setMapping(id, {
        mapping: effectiveMapping,
        ...(templateName.trim() ? { templateName: templateName.trim() } : {}),
      }),
    onSuccess: async () => {
      toastSuccess(t('mapping.saved'));
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      await rowsQuery.refetch();
      setStep(3);
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  const validate = useMutation({
    mutationFn: () => importsApi.validate(id),
    onSuccess: async (result) => {
      toastSuccess(
        t('validate.validated', {
          valid: result.batch.counts.valid,
          invalid: result.batch.counts.invalid,
          duplicate: result.batch.counts.duplicate,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      await queryClient.invalidateQueries({ queryKey: ['imports', id, 'rows'] });

      const totalDuplicates = result.batch.counts.duplicate + result.batch.counts.suspected;
      setStep(totalDuplicates > 0 ? 4 : 5);
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  const decideDuplicates = useMutation({
    mutationFn: (decisions: Array<{ rowId: string; action: 'keep' | 'skip' }>) =>
      importsApi.decideDuplicates(id, decisions),
    onSuccess: async () => {
      toastSuccess(t('duplicates.saved'));
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      setStep(5);
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  const commit = useMutation({
    mutationFn: () => {
      // 幂等键在批次内固定：重试不会造成重复入账
      const key = `import-${id}`;
      return importsApi.commit(id, key);
    },
    onSuccess: async (result) => {
      setCommitResult(result);
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  const rollback = useMutation({
    mutationFn: () => importsApi.rollback(id),
    onSuccess: async () => {
      toastSuccess(t('workbench.rollback.done'));
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'IMPORT_ROLLBACK_BLOCKED') {
        const details = err.details as { blockedTransactions?: Array<{ reason: string }> } | undefined;
        const reasons = details?.blockedTransactions
          ?.map((item) => item.reason)
          .join(t('common:list_separator'));
        toastError(
          t('workbench.rollback.blocked', {
            reasons: reasons ?? t('workbench.rollback.blocked_default'),
          }),
        );
      } else {
        toastError(translateError(err, t));
      }
    },
  });

  const cancel = useMutation({
    mutationFn: () => importsApi.cancel(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      toastSuccess(t('workbench.cancel.done'));
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  if (detail.isPending) return <LoadingState label={t('loading_batches')} />;
  if (detail.error || !batch) {
    return (
      <ErrorState message={t('workbench.load_failed')} onRetry={() => void detail.refetch()} />
    );
  }

  const counts = batch.counts;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{batch.originalFilename}</h1>
            <BatchStatusBadge status={batch.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {t('workbench.meta', {
              account: batch.accountName,
              format: batch.format.toUpperCase(),
              encoding: batch.encoding,
              total: counts.total,
            })}
            {batch.sheetName ? ` · ${t('workbench.sheet', { name: batch.sheetName })}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/imports')}
          className="text-sm text-[var(--color-accent)]"
        >
          {t('workbench.back')}
        </button>
      </div>

      <ImportStepper current={step} onSelect={(target) => target >= 2 && setStep(target)} />

      {batch.failureReason && batch.status === 'failed' && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-500">{batch.failureReason}</p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('workbench.stats.valid')} value={counts.valid} tone="text-emerald-500" />
        <Stat label={t('workbench.stats.invalid')} value={counts.invalid} tone="text-[var(--color-negative)]" />
        <Stat label={t('workbench.stats.duplicate')} value={counts.duplicate} tone="text-amber-500" />
        <Stat label={t('workbench.stats.suspected')} value={counts.suspected} tone="text-amber-500" />
      </div>

      {step === 2 && (
        <section className="card space-y-4 p-4">
          <h2 className="text-sm font-medium">{t('mapping.title')}</h2>
          {headers.length === 0 ? (
            <p className="text-sm text-[var(--color-content-muted)]">{t('mapping.no_headers')}</p>
          ) : (
            <>
              <MappingEditor
                headers={headers}
                mapping={effectiveMapping}
                dateSample={dateSample}
                onChange={setMapping}
              />
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label htmlFor="template-name" className="block text-xs text-[var(--color-content-muted)]">
                    {t('mapping.save_template')}
                  </label>
                  <input
                    id="template-name"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder={t('mapping.template_placeholder')}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={saveMapping.isPending}
                  onClick={() => saveMapping.mutate()}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {saveMapping.isPending ? t('mapping.saving') : t('mapping.save_mapping')}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {step >= 3 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t('preview.title')}</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
              >
                {t('preview.change_mapping')}
              </button>
              {batch.status !== 'completed' && batch.status !== 'rolled_back' && (
                <button
                  type="button"
                  disabled={validate.isPending}
                  onClick={() => validate.mutate()}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  {validate.isPending ? t('preview.validating') : t('preview.start_validate')}
                </button>
              )}
            </div>
          </div>
          {rowsQuery.isPending ? (
            <LoadingState label={t('preview.loading_rows')} />
          ) : (
            <PreviewTable rows={rowsQuery.data?.rows ?? []} />
          )}
          {rowsQuery.data && rowsQuery.data.pagination.total > rowsQuery.data.rows.length && (
            <p className="text-xs text-[var(--color-content-muted)]">
              {t('preview.truncated', {
                shown: rowsQuery.data.rows.length,
                total: rowsQuery.data.pagination.total,
              })}
            </p>
          )}
        </section>
      )}

      {step === 4 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">{t('duplicates.title')}</h2>
          {duplicatesQuery.isPending ? (
            <LoadingState label={t('duplicates.loading')} />
          ) : (
            <DuplicateReview
              exact={duplicatesQuery.data?.exact ?? []}
              suspected={duplicatesQuery.data?.suspected ?? []}
              submitting={decideDuplicates.isPending}
              onSubmit={(decisions) => decideDuplicates.mutate(decisions)}
            />
          )}
        </section>
      )}

      {step === 5 && (
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-medium">{t('workbench.result.title')}</h2>

          {commitResult ? (
            <div className="space-y-1 text-sm">
              <p>{t('workbench.result.imported', { count: commitResult.importedRows })}</p>
              <p className="text-[var(--color-content-muted)]">
                {t('workbench.result.summary', {
                  skipped: commitResult.skippedRows,
                  matched: commitResult.categoryMatched,
                  uncategorized: commitResult.uncategorized,
                })}
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/transactions')}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                >
                  {t('workbench.result.view_transactions')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/imports/unmatched')}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                >
                  {t('workbench.result.match_transfers')}
                </button>
                <a
                  href={importsApi.errorExportUrl(id)}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                >
                  {t('workbench.result.export_errors')}
                </a>
              </div>
            </div>
          ) : batch.status === 'completed' ? (
            <p className="text-sm text-[var(--color-content-muted)]">
              {t('workbench.result.already_completed', { count: counts.imported })}
            </p>
          ) : (
            <>
              <p className="text-sm">
                {t('workbench.result.confirm_summary_valid')}
                <strong>{counts.valid}</strong>
                {t('workbench.result.confirm_summary_rest', {
                  skipped: counts.skipped + counts.duplicate + counts.invalid,
                })}
              </p>
              <button
                type="button"
                disabled={commit.isPending || counts.valid === 0}
                onClick={() => commit.mutate()}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {commit.isPending ? t('workbench.result.committing') : t('workbench.result.confirm_import')}
              </button>
            </>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-2 border-t border-[var(--color-border-subtle)] pt-4">
        {['parsed', 'mapped', 'validated'].includes(batch.status) && (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: t('workbench.cancel.action'),
                message: t('workbench.cancel.confirm'),
                tone: 'danger',
              });
              if (ok) cancel.mutate();
            }}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm text-[var(--color-content-muted)]"
          >
            {t('workbench.cancel.action')}
          </button>
        )}

        {batch.status === 'completed' && (
          <button
            type="button"
            disabled={rollback.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: t('workbench.rollback.action'),
                message: t('workbench.rollback.confirm'),
                tone: 'danger',
              });
              if (ok) rollback.mutate();
            }}
            className="rounded-lg border border-[var(--color-negative)] px-3 py-1.5 text-sm text-[var(--color-negative)]"
          >
            {rollback.isPending ? t('workbench.rollback.running') : t('workbench.rollback.action')}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-[var(--color-content-muted)]">{label}</p>
      <p className={`text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
