import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UploadDropzone from '@/components/imports/UploadDropzone';
import ErrorState from '@/components/ui/ErrorState';
import { accountsApi, type Account } from '@/lib/accounts';
import { ApiError } from '@/lib/client';
import { importsApi } from '@/lib/imports';

export default function ImportNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateBatchId, setDuplicateBatchId] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts', 'active'],
    queryFn: () => accountsApi.list({ status: 'active' }),
  });

  const accounts: Account[] = accountsQuery.data?.accounts ?? [];

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0]!.id);
  }, [accounts, accountId]);

  async function handleFile(file: File, encoding?: 'utf-8' | 'gb18030') {
    if (!accountId) {
      setError('请先选择目标账户');
      return;
    }

    setUploading(true);
    setError(null);
    setDuplicateBatchId(null);

    try {
      const result = await importsApi.upload(accountId, file, { ...(encoding ? { encoding } : {}) });
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
      navigate(`/imports/${result.batch.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IMPORT_ALREADY_UPLOADED') {
        const details = err.details as { batchId?: string } | undefined;
        setDuplicateBatchId(details?.batchId ?? null);
        setError('该文件之前已完成导入，如需重新导入请先撤销原批次。');
      } else {
        setError(err instanceof ApiError ? err.message : '上传失败，请重试');
      }
    } finally {
      setUploading(false);
    }
  }

  if (accountsQuery.isPending) return <p className="text-sm text-[var(--color-content-muted)]">加载账户…</p>;
  if (accountsQuery.error) {
    return <ErrorState message="账户列表加载失败" onRetry={() => void accountsQuery.refetch()} />;
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">导入账单</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          选择目标账户并上传银行导出的 CSV 或 XLSX 文件。文件会先进入暂存区，确认映射与预览后才会写入账本。
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="card p-4 text-sm">
          还没有可用账户。
          <button
            type="button"
            onClick={() => navigate('/accounts')}
            className="ml-2 text-[var(--color-accent)]"
          >
            先去创建账户
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <label htmlFor="target-account" className="block text-sm">
              目标账户
            </label>
            <select
              id="target-account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-3 py-2 text-sm"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}（{account.currency}）
                </option>
              ))}
            </select>
          </div>

          <UploadDropzone onFile={handleFile} disabled={uploading} />

          {uploading && <p className="text-sm text-[var(--color-content-muted)]">正在上传并解析文件…</p>}

          {error && (
            <div role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
              {error}
              {duplicateBatchId && (
                <button
                  type="button"
                  onClick={() => navigate(`/imports/${duplicateBatchId}`)}
                  className="ml-2 underline"
                >
                  查看原批次
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
