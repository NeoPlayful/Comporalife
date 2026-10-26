import Modal from '@/components/ui/Modal';
import { accountsApi, type Account } from '@/lib/accounts';
import { categoriesApi, type FlatCategory } from '@/lib/categories';
import { translateError } from '@/lib/error-message';
import { transactionsApi, transfersApi } from '@/lib/transactions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type FormType = 'expense' | 'income' | 'transfer' | 'adjustment';

const TYPE_OPTIONS: FormType[] = ['expense', 'income', 'transfer', 'adjustment'];

export default function TransactionForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
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
      setError(translateError(err, t));
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

  // 交易表单字段多，只有记录过内容才值得在关闭时拦一下
  const dirty =
    amount !== '' || description !== '' || merchant !== '' || note !== '' || categoryId !== '';

  return (
    <Modal
      open
      title={t('transactions:form.title')}
      variant="sheet"
      size="lg"
      dirty={dirty}
      busy={saveMutation.isPending}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('transactions:form.cancel')}
          </button>
          <button
            type="submit"
            form="transaction-create-form"
            disabled={!canSubmit || saveMutation.isPending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saveMutation.isPending ? t('transactions:form.saving') : t('transactions:form.save')}
          </button>
        </>
      }
    >
        <form
          id="transaction-create-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) saveMutation.mutate();
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/5">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                className={`rounded-md px-2 py-1.5 text-sm transition-colors ${
                  type === option
                    ? 'bg-[var(--color-surface-raised)] font-medium text-[var(--color-content)]'
                    : 'text-[var(--color-content-muted)]'
                }`}
              >
                {t(`transactions:form.types.${option}`)}
              </button>
            ))}
          </div>

          <Field
            label={
              type === 'transfer'
                ? t('transactions:form.from_account')
                : t('transactions:form.account')
            }
          >
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input">
              {accounts.length === 0 && (
                <option value="">{t('transactions:form.create_account_first')}</option>
              )}
              {accounts.map((account: Account) => (
                <option key={account.id} value={account.id}>
                  {account.name}（{account.currency}）
                </option>
              ))}
            </select>
          </Field>

          {type === 'transfer' && (
            <Field label={t('transactions:form.to_account')}>
              <select
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="input"
              >
                <option value="">{t('transactions:form.select_account')}</option>
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
                  {t('transactions:form.cross_currency_unsupported')}
                </span>
              )}
            </Field>
          )}

          {type !== 'transfer' && (
            <Field
              label={
                type === 'adjustment'
                  ? t('transactions:form.adjustment_category')
                  : t('transactions:form.category')
              }
            >
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="input"
              >
                <option value="">{t('transactions:form.uncategorized')}</option>
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
            <Field label={t('transactions:form.amount', { currency: accountCurrency })}>
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="input"
              />
            </Field>

            <Field label={t('transactions:form.date')}>
              <input
                required
                type="date"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <Field label={t('transactions:form.description')}>
            <input
              required
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                type === 'transfer'
                  ? t('transactions:form.transfer_description_placeholder')
                  : t('transactions:form.description_placeholder')
              }
              className="input"
            />
          </Field>

          {type !== 'transfer' && (
            <Field label={t('transactions:form.merchant')}>
              <input
                maxLength={100}
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="input"
              />
            </Field>
          )}

          <Field label={t('transactions:form.note')}>
            <input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="input" />
          </Field>

          {type === 'adjustment' && (
            <p className="text-xs text-[var(--color-content-muted)]">
              {t('transactions:form.adjustment_hint')}
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
              {error}
            </p>
          )}
        </form>
    </Modal>
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
