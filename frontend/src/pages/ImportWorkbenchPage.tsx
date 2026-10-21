import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BatchStatusBadge from '@/components/imports/BatchStatusBadge';
import DuplicateReview from '@/components/imports/DuplicateReview';
import ImportStepper from '@/components/imports/ImportStepper';
import MappingEditor from '@/components/imports/MappingEditor';
import PreviewTable from '@/components/imports/PreviewTable';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { ApiError } from '@/lib/client';
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

  const [step, setStep] = useState(2);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      setError(null);
      setMessage('映射已保存');
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      await rowsQuery.refetch();
      setStep(3);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存映射失败'),
  });

  const validate = useMutation({
    mutationFn: () => importsApi.validate(id),
    onSuccess: async (result) => {
      setError(null);
      setMessage(
        `校验完成：有效 ${result.batch.counts.valid} 行，无效 ${result.batch.counts.invalid} 行，重复 ${result.batch.counts.duplicate} 行`,
      );
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      await queryClient.invalidateQueries({ queryKey: ['imports', id, 'rows'] });

      const totalDuplicates = result.batch.counts.duplicate + result.batch.counts.suspected;
      setStep(totalDuplicates > 0 ? 4 : 5);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '校验失败'),
  });

  const decideDuplicates = useMutation({
    mutationFn: (decisions: Array<{ rowId: string; action: 'keep' | 'skip' }>) =>
      importsApi.decideDuplicates(id, decisions),
    onSuccess: async () => {
      setError(null);
      setMessage('重复行已确认');
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      setStep(5);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存确认失败'),
  });

  const commit = useMutation({
    mutationFn: () => {
      // 幂等键在批次内固定：重试不会造成重复入账
      const key = `import-${id}`;
      return importsApi.commit(id, key);
    },
    onSuccess: async (result) => {
      setError(null);
      setCommitResult(result);
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '提交失败'),
  });

  const rollback = useMutation({
    mutationFn: () => importsApi.rollback(id),
    onSuccess: async () => {
      setError(null);
      setMessage('批次已撤销，相关交易已冲正');
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'IMPORT_ROLLBACK_BLOCKED') {
        const details = err.details as { blockedTransactions?: Array<{ reason: string }> } | undefined;
        const reasons = details?.blockedTransactions?.map((item) => item.reason).join('；');
        setError(`无法撤销：${reasons ?? '存在依赖'}`);
      } else {
        setError(err instanceof ApiError ? err.message : '撤销失败');
      }
    },
  });

  const cancel = useMutation({
    mutationFn: () => importsApi.cancel(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['imports', id] });
      setMessage('批次已取消');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '取消失败'),
  });

  if (detail.isPending) return <LoadingState label="加载导入批次…" />;
  if (detail.error || !batch) {
    return <ErrorState message="导入批次不存在或无权访问" onRetry={() => void detail.refetch()} />;
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
            {batch.accountName} · {batch.format.toUpperCase()} · {batch.encoding}
            {batch.sheetName ? ` · 工作表 ${batch.sheetName}` : ''} · 共 {counts.total} 行
          </p>
        </div>
        <button type="button" onClick={() => navigate('/imports')} className="text-sm text-[var(--color-accent)]">
          返回列表
        </button>
      </div>

      <ImportStepper current={step} onSelect={(target) => target >= 2 && setStep(target)} />

      {message && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">{message}</p>}
      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}
      {batch.failureReason && batch.status === 'failed' && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-500">{batch.failureReason}</p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="有效" value={counts.valid} tone="text-emerald-500" />
        <Stat label="无效" value={counts.invalid} tone="text-[var(--color-negative)]" />
        <Stat label="重复" value={counts.duplicate} tone="text-amber-500" />
        <Stat label="疑似" value={counts.suspected} tone="text-amber-500" />
      </div>

      {step === 2 && (
        <section className="card space-y-4 p-4">
          <h2 className="text-sm font-medium">字段映射</h2>
          {headers.length === 0 ? (
            <p className="text-sm text-[var(--color-content-muted)]">未读取到表头，无法映射。</p>
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
                    保存为模板（可选）
                  </label>
                  <input
                    id="template-name"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="例如：示例银行 CSV"
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-1.5 text-sm"
                  />
                </div>
                <button
                  type="button"
                  disabled={saveMapping.isPending}
                  onClick={() => saveMapping.mutate()}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {saveMapping.isPending ? '保存中…' : '保存映射'}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {step >= 3 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">数据预览</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
              >
                改映射
              </button>
              {batch.status !== 'completed' && batch.status !== 'rolled_back' && (
                <button
                  type="button"
                  disabled={validate.isPending}
                  onClick={() => validate.mutate()}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  {validate.isPending ? '校验中…' : '开始校验'}
                </button>
              )}
            </div>
          </div>
          {rowsQuery.isPending ? (
            <LoadingState label="加载行数据…" />
          ) : (
            <PreviewTable rows={rowsQuery.data?.rows ?? []} />
          )}
          {rowsQuery.data && rowsQuery.data.pagination.total > rowsQuery.data.rows.length && (
            <p className="text-xs text-[var(--color-content-muted)]">
              仅显示前 {rowsQuery.data.rows.length} 行，共 {rowsQuery.data.pagination.total} 行
            </p>
          )}
        </section>
      )}

      {step === 4 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">重复确认</h2>
          {duplicatesQuery.isPending ? (
            <LoadingState label="加载重复行…" />
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
          <h2 className="text-sm font-medium">提交结果</h2>

          {commitResult ? (
            <div className="space-y-1 text-sm">
              <p>已导入 {commitResult.importedRows} 笔交易</p>
              <p className="text-[var(--color-content-muted)]">
                跳过 {commitResult.skippedRows} 行 · 自动分类 {commitResult.categoryMatched} 笔 · 未分类{' '}
                {commitResult.uncategorized} 笔
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/transactions')}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                >
                  查看流水
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/imports/unmatched')}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                >
                  去匹配转账
                </button>
                <a
                  href={importsApi.errorExportUrl(id)}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                >
                  导出错误行
                </a>
              </div>
            </div>
          ) : batch.status === 'completed' ? (
            <p className="text-sm text-[var(--color-content-muted)]">
              该批次已提交，共导入 {counts.imported} 笔交易。
            </p>
          ) : (
            <>
              <p className="text-sm">
                将导入 <strong>{counts.valid}</strong> 笔交易，跳过 {counts.skipped + counts.duplicate + counts.invalid} 行。
              </p>
              <button
                type="button"
                disabled={commit.isPending || counts.valid === 0}
                onClick={() => commit.mutate()}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {commit.isPending ? '提交中…' : '确认导入'}
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
            onClick={() => {
              if (window.confirm('取消后本次上传的数据不会入账，确定取消？')) cancel.mutate();
            }}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm text-[var(--color-content-muted)]"
          >
            取消批次
          </button>
        )}

        {batch.status === 'completed' && (
          <button
            type="button"
            disabled={rollback.isPending}
            onClick={() => {
              if (window.confirm('撤销会冲正本批次全部交易并要求重新导入，确定继续？')) rollback.mutate();
            }}
            className="rounded-lg border border-[var(--color-negative)] px-3 py-1.5 text-sm text-[var(--color-negative)]"
          >
            {rollback.isPending ? '撤销中…' : '撤销本批次'}
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
