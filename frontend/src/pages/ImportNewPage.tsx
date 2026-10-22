import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import UploadDropzone from '@/components/imports/UploadDropzone';
import ErrorState from '@/components/ui/ErrorState';
import { accountsApi, type Account } from '@/lib/accounts';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { importsApi } from '@/lib/imports';

export default function ImportNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('imports');
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
      setError(t('new.select_account_first'));
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
        setError(translateError(err, t));
      } else {
        setError(translateError(err, t));
      }
    } finally {
      setUploading(false);
    }
  }

  if (accountsQuery.isPending) {
    return <p className="text-sm text-[var(--color-content-muted)]">{t('new.loading_accounts')}</p>;
  }
  if (accountsQuery.error) {
    return (
      <ErrorState message={t('new.accounts_failed')} onRetry={() => void accountsQuery.refetch()} />
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t('new.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('new.subtitle')}</p>
      </div>

      {accounts.length === 0 ? (
        <div className="card p-4 text-sm">
          {t('new.no_accounts')}
          <button
            type="button"
            onClick={() => navigate('/accounts')}
            className="ml-2 text-[var(--color-accent)]"
          >
            {t('new.create_account')}
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <label htmlFor="target-account" className="block text-sm">
              {t('new.target_account')}
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

          {uploading && (
            <p className="text-sm text-[var(--color-content-muted)]">{t('new.uploading')}</p>
          )}

          {error && (
            <div role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
              {error}
              {duplicateBatchId && (
                <button
                  type="button"
                  onClick={() => navigate(`/imports/${duplicateBatchId}`)}
                  className="ml-2 underline"
                >
                  {t('new.view_original')}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
