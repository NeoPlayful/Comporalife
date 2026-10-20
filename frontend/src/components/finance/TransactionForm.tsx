import { accountsApi, type Account } from '@/api/accounts';
import { categoriesApi, type FlatCategory } from '@/api/categories';
import { ApiError } from '@/api/client';
import { transactionsApi, transfersApi } from '@/api/transactions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

type FormType = 'expense' | 'income' | 'transfer' | 'adjustment';

const TYPE_OPTIONS: Array<{ value: FormType; label: string }> = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' },
  { value: 'adjustment', label: '余额调整' },
];

export default function TransactionForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<FormType>('expense');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts', false],
    queryFn: () => accountsApi.list({ status: 'active' }),
  });

  const categoryKind = type === 'income' ? 'income' : 'expense';
  const categoriesQuery = useQuery({
    queryKey: ['categories', categoryKind],
    queryFn: () => categoriesApi.tree(categoryKind),
    enabled: type !== 'transfer',
  });

  const accounts = accountsQuery.data?.accounts ?? [];
  const categories = categoriesQuery.data?.flat ?? [];

  // 默认选中第一个账户，减少新建交易时的操作步骤
  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0]!.id);
  }, [accounts, accountId]);

  useEffect(() => {
    setCategoryId('');
  }, [type]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (type === 'transfer') {
        return transfersApi.create({
          fromAccountId: accountId,
          toAccountId,
          amount,
          occurredAt: new Date(occurredAt).toISOString(),
          description: description || undefined,
          note: note || undefined,
        });
      }

      return transactionsApi.create({
        type,
        accountId,
        categoryId: categoryId || null,
        amount,
        occurredAt: new Date(occurredAt).toISOString(),
        description,
        merchant: merchant || undefined,
        note: note || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account'] });
      onSaved();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : '保存失败');
    },
  });

  const accountCurrency = accounts.find((a) => a.id === accountId)?.currency ?? 'CNY';
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const currencyMismatch =
    type === 'transfer' && toAccount !== undefined && toAccount.currency !== accountCurrency;

  const canSubmit =
    accountId &&
    amount.trim() &&
    description.trim().length > 0 &&
    (type !== 'adjustment' || categoryId) &&
    (type !== 'transfer' || (toAccountId && toAccountId !== accountId && !currencyMismatch));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="关闭" />

      <div className="card relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-xl">
        <h2 className="mb-4 text-base font-medium">新增交易</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) saveMutation.mutate();
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/5">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
                  type === option.value
                    ? 'bg-[var(--color-surface-raised)] font-medium text-[var(--color-content)]'
                    : 'text-[var(--color-content-muted)]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <Field label={type === 'transfer' ? '转出账户' : '账户'}>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input">
              {accounts.length === 0 && <option value="">请先创建账户</option>}
              {accounts.map((account: Account) => (
                <option key={account.id} value={account.id}>
                  {account.name}（{account.currency}）
                </option>
              ))}
            </select>
          </Field>

          {type === 'transfer' && (
            <Field label="转入账户">
              <select
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="input"
              >
                <option value="">请选择</option>
                {accounts
                  .filter((account) => account.id !== accountId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}（{account.currency}）
                    </option>
                  ))}
              </select>
              {currencyMismatch && (
                <span className="mt-1 block text-xs text-[var(--color-negative)]">
                  当前版本不支持跨币种转账
                </span>
              )}
            </Field>
          )}

          {type !== 'transfer' && (
            <Field label={type === 'adjustment' ? '调整分类（必填）' : '分类'}>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="input"
              >
                <option value="">未分类</option>
                {categories.map((category: FlatCategory) => (
                  <option key={category.id} value={category.id}>
                    {category.parentId ? '　' : ''}
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={`金额（${accountCurrency}）`}>
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="input"
              />
            </Field>

            <Field label="日期">
              <input
                required
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <Field label="摘要">
            <input
              required
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={type === 'transfer' ? '留空则自动生成' : '例如：午餐'}
              className="input"
            />
          </Field>

          {type !== 'transfer' && (
            <Field label="商户（可选）">
              <input
                maxLength={100}
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="input"
              />
            </Field>
          )}

          <Field label="备注（可选）">
            <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="input" />
          </Field>

          {type === 'adjustment' && (
            <p className="text-xs text-[var(--color-content-muted)]">
              余额调整会生成一笔带外部对手方的调整交易，用于把账户余额校正到实际值。
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit || saveMutation.isPending}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saveMutation.isPending ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-[var(--color-content-muted)]">{label}</span>
      {children}
    </label>
  );
}
