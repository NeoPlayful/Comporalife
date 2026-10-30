import {
  LIABILITY_TYPES,
  accountsApi,
  type Account,
  type AccountType,
} from '@/lib/accounts';
import { ACCOUNT_TYPES, useEnumLabels } from '@/lib/enum-labels';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import CurrencySelect from '@/components/finance/CurrencySelect';
import MoneyDisplay from '@/components/finance/MoneyDisplay';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['accounts', showArchived],
    queryFn: () => accountsApi.list({ status: showArchived ? 'all' : 'active' }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => accountsApi.archive(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.archived'));
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => accountsApi.unarchive(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.unarchived'));
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => accountsApi.remove(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.deleted'));
      // 账户余额同时出现在仪表盘与净资产里，删干净后这些统计都要重取
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    // 有关联数据时后端拒绝删除：把「请改为归档」原样透出，不然用户只看到一句冲突
    onError: (err) => toastError(translateError(err, t)),
  });

  const { assets, liabilities } = useMemo(() => {
    const list = accountsQuery.data?.accounts.filter((a) => a.status === 'active') ?? [];

    // 多币种暂不做折算，按币种分组累计，避免混算产生误导性总额
    const byCurrency = new Map<string, { assets: number; liabilities: number }>();

    for (const account of list) {
      const bucket = byCurrency.get(account.currency) ?? { assets: 0, liabilities: 0 };
      const value = Number(account.balance);

      if (LIABILITY_TYPES.includes(account.type)) {
        bucket.liabilities += Math.abs(value);
      } else {
        bucket.assets += value;
      }

      byCurrency.set(account.currency, bucket);
    }

    return {
      assets: [...byCurrency.entries()].map(([currency, v]) => ({ currency, amount: v.assets })),
      liabilities: [...byCurrency.entries()].map(([currency, v]) => ({ currency, amount: v.liabilities })),
    };
  }, [accountsQuery.data]);

  if (accountsQuery.isLoading) return <LoadingState />;
  if (accountsQuery.isError) {
    return <ErrorState message={t('accounts:load_failed')} onRetry={() => accountsQuery.refetch()} />;
  }

  const accounts = accountsQuery.data?.accounts ?? [];
  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const archivedAccounts = accounts.filter((a) => a.status === 'archived');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('accounts:title')}</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--color-content-muted)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="size-4 rounded border-[var(--color-border-subtle)]"
            />
            {t('accounts:show_archived')}
          </label>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-lg btn-action px-3 py-2 text-sm font-medium"
          >
            <Plus className="size-4" />
            {t('accounts:new')}
          </button>
        </div>
      </div>

      {(assets.length > 0 || liabilities.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card p-4">
            <p className="text-xs text-[var(--color-content-muted)]">{t('accounts:total_assets')}</p>
            <div className="mt-1 space-y-1">
              {assets.map((item) => (
                <MoneyDisplay
                  key={item.currency}
                  amount={String(item.amount)}
                  currency={item.currency}
                  className="block text-lg font-semibold"
                />
              ))}
            </div>
          </div>
          <div className="card p-4">
            <p className="text-xs text-[var(--color-content-muted)]">
              {t('accounts:total_liabilities')}
            </p>
            <div className="mt-1 space-y-1">
              {liabilities.map((item) => (
                <MoneyDisplay
                  key={item.currency}
                  amount={String(item.amount)}
                  currency={item.currency}
                  className="block text-lg font-semibold text-[var(--color-negative)]"
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {activeAccounts.length === 0 && !showArchived ? (
        <div className="card">
          <EmptyState
            title={t('accounts:empty_title')}
            description={t('accounts:empty_description')}
            action={
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="rounded-lg btn-action px-4 py-2 text-sm font-medium"
              >
                {t('accounts:empty_action')}
              </button>
            }
          />
        </div>
      ) : (
        <AccountList
          accounts={showArchived ? accounts : activeAccounts}
          onArchive={(id) => archiveMutation.mutate(id)}
          onUnarchive={(id) => unarchiveMutation.mutate(id)}
          onDelete={(id) => deleteMutation.mutate(id)}
          deletingId={deleteMutation.isPending ? deleteMutation.variables ?? null : null}
        />
      )}

      {showArchived && archivedAccounts.length > 0 && (
        <p className="text-xs text-[var(--color-content-muted)]">{t('accounts:archived_hint')}</p>
      )}

      {dialogOpen && (
        <AccountDialog
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
            toastSuccess(t('common:feedback.created'));
            setDialogOpen(false);
            queryClient.invalidateQueries({ queryKey: ['accounts'] });
          }}
        />
      )}
    </div>
  );
}

function AccountList({
  accounts,
  onArchive,
  onUnarchive,
  onDelete,
  deletingId,
}: {
  accounts: Account[];
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const { t } = useTranslation();
  const { accountType } = useEnumLabels();
  const confirm = useConfirm();

  async function confirmDelete(account: Account) {
    const ok = await confirm({
      title: t('accounts:delete_title'),
      // 后端会校验关联数据，但用户点了删除就该先知道「这一下会真的消失」
      message: t('accounts:delete_confirm', { name: account.name }),
      confirmLabel: t('accounts:delete'),
      tone: 'danger',
    });
    if (ok) onDelete(account.id);
  }

  return (
    <div className="card divide-y divide-[var(--color-border-subtle)]">
      {accounts.map((account) => (
        <div key={account.id} className="flex items-center justify-between gap-3 p-4">
          <Link to={`/accounts/${account.id}`} className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{account.name}</p>
              <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-xs text-[var(--color-content-muted)] dark:bg-white/5">
                {accountType(account.type)}
              </span>
              {account.status === 'archived' && (
                <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-xs text-[var(--color-content-muted)] dark:bg-white/5">
                  {t('accounts:archived_badge')}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--color-content-muted)]">
              {account.institution ?? t('accounts:no_institution')}
            </p>
          </Link>

          <div className="flex shrink-0 items-center gap-3">
            <MoneyDisplay
              amount={account.balance}
              currency={account.currency}
              colorize={LIABILITY_TYPES.includes(account.type)}
              className="text-sm font-medium"
            />
            <button
              type="button"
              onClick={() => (account.status === 'active' ? onArchive(account.id) : onUnarchive(account.id))}
              className="grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
              aria-label={account.status === 'active' ? t('accounts:archive') : t('accounts:unarchive')}
              title={account.status === 'active' ? t('accounts:archive') : t('accounts:unarchive')}
            >
              {account.status === 'active' ? (
                <Archive className="size-4" />
              ) : (
                <RotateCcw className="size-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete(account)}
              disabled={deletingId === account.id}
              className="grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-[var(--color-negative)]/10 hover:text-[var(--color-negative)] disabled:opacity-50"
              aria-label={t('accounts:delete')}
              title={t('accounts:delete')}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const { accountType } = useEnumLabels();
  const [form, setForm] = useState({
    name: '',
    type: 'bank' as AccountType,
    institution: '',
    currency: 'CNY',
    openingBalance: '0',
    openingBalanceDate: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => accountsApi.create(form),
    onSuccess: onCreated,
    onError: (err) => setError(translateError(err, t)),
  });

  const dirty =
    form.name.trim() !== '' ||
    form.institution !== '' ||
    form.openingBalance !== '0' ||
    form.currency !== 'CNY' ||
    form.type !== 'bank';

  return (
    <Modal
      open
      title={t('accounts:dialog.title')}
      dirty={dirty}
      busy={createMutation.isPending}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('common:actions.cancel')}
          </button>
          <button
            type="submit"
            form="account-create-form"
            disabled={createMutation.isPending}
            className="rounded-lg btn-action px-3 py-2 text-sm font-medium"
          >
            {createMutation.isPending
              ? t('accounts:dialog.creating')
              : t('accounts:dialog.create')}
          </button>
        </>
      }
    >
      <form
        id="account-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="space-y-3"
      >
          <Field label={t('accounts:dialog.name')}>
            <input
              required
              maxLength={60}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('accounts:dialog.type')}>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}
                className="input"
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {accountType(type)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('accounts:dialog.currency')}>
              <CurrencySelect
                value={form.currency}
                onChange={(currency) => setForm({ ...form, currency })}
              />
            </Field>
          </div>

          <Field label={t('accounts:dialog.institution')}>
            <input
              maxLength={80}
              value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('accounts:dialog.opening_balance')}>
              <input
                required
                inputMode="decimal"
                value={form.openingBalance}
                onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                className="input"
              />
            </Field>

            <Field label={t('accounts:dialog.opening_date')}>
              <input
                required
                type="date"
                value={form.openingBalanceDate}
                onChange={(e) => setForm({ ...form, openingBalanceDate: e.target.value })}
                className="input"
              />
            </Field>
          </div>

          <p className="text-xs text-[var(--color-content-muted)]">
            {t('accounts:dialog.liability_hint')}
          </p>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-negative)]">
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
