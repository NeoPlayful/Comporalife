import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import UploadDropzone from '@/components/imports/UploadDropzone';
import Modal from '@/components/ui/Modal';
import { accountsApi, type Account } from '@/lib/accounts';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { importsApi } from '@/lib/imports';

/**
 * 上传账单弹窗。
 *
 * 上传成功后直接跳到该批次的处理页：映射、校验、重复确认都在那边完成，
 * 这里只负责「选账户 + 传文件」这一步。
 */
export default function ImportUploadDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
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
    enabled: open,
  });

  const accounts: Account[] = useMemo(() => accountsQuery.data?.accounts ?? [], [accountsQuery.data]);

  // 账户异步加载，弹窗挂载时下拉框还不存在，Modal 只能把焦点给关闭按钮。
  // 账户到位后补一次焦点，用户打开就能直接选账户。焦点已被用户移到别处时不抢。
  const accountRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const dialog = accountRef.current?.closest('[role="dialog"]');
    const active = document.activeElement;
    if (!open || !dialog || !(active instanceof HTMLElement) || !dialog.contains(active)) return;
    accountRef.current?.focus();
  }, [open, accounts.length]);

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0]!.id);
  }, [accounts, accountId]);

  // 每次重新打开都从干净状态开始，避免上次的报错留在弹窗里
  useEffect(() => {
    if (!open) return;
    setError(null);
    setDuplicateBatchId(null);
  }, [open]);

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
      }
      setError(translateError(err, t));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal
      open={open}
      size="xl"
      title={t('new.title')}
      description={t('new.subtitle')}
      busy={uploading}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          disabled={uploading}
          className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
        >
          {t('common:actions.cancel')}
        </button>
      }
    >
      {accountsQuery.isPending ? (
        <p className="text-sm text-[var(--color-content-muted)]">{t('new.loading_accounts')}</p>
      ) : accountsQuery.error ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--color-negative)]">{t('new.accounts_failed')}</p>
          <button
            type="button"
            onClick={() => void accountsQuery.refetch()}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
          >
            {t('common:actions.retry')}
          </button>
        </div>
      ) : accounts.length === 0 ? (
        <p className="text-sm">
          {t('new.no_accounts')}
          <button
            type="button"
            onClick={() => navigate('/accounts')}
            className="ml-2 text-[var(--color-accent)]"
          >
            {t('new.create_account')}
          </button>
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="import-target-account" className="block text-sm">
              {t('new.target_account')}
            </label>
            <select
              id="import-target-account"
              ref={accountRef}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              data-autofocus
              disabled={uploading}
              className="input"
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
            <div
              role="alert"
              className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]"
            >
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
        </div>
      )}
    </Modal>
  );
}
