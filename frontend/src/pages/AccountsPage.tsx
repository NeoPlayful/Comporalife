import {
  ACCOUNT_TYPE_LABELS,
  LIABILITY_TYPES,
  accountsApi,
  type Account,
  type AccountType,
} from '@/api/accounts';
import { ApiError } from '@/api/client';
import MoneyDisplay from '@/components/finance/MoneyDisplay';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const ACCOUNT_TYPES: AccountType[] = ['cash', 'bank', 'credit_card', 'brokerage', 'loan', 'other'];

export default function AccountsPage() {
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['accounts', showArchived],
    queryFn: () => accountsApi.list({ status: showArchived ? 'all' : 'active' }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => accountsApi.archive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : '归档失败'),
  });

  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => accountsApi.unarchive(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : '恢复失败'),
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
    return <ErrorState message="账户加载失败" onRetry={() => accountsQuery.refetch()} />;
  }

  const accounts = accountsQuery.data?.accounts ?? [];
  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const archivedAccounts = accounts.filter((a) => a.status === 'archived');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">财务账户</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--color-content-muted)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="size-4 rounded border-[var(--color-border-subtle)]"
            />
            显示已归档
          </label>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setDialogOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
          >
            <Plus className="size-4" />
            新建账户
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      {(assets.length > 0 || liabilities.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card p-4">
            <p className="text-xs text-[var(--color-content-muted)]">总资产</p>
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
            <p className="text-xs text-[var(--color-content-muted)]">总负债</p>
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
            title="还没有账户"
            description="先创建一个现金或银行账户，之后就能开始记账。"
            action={
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                创建第一个账户
              </button>
            }
          />
        </div>
      ) : (
        <AccountList
          accounts={showArchived ? accounts : activeAccounts}
          onArchive={(id) => archiveMutation.mutate(id)}
          onUnarchive={(id) => unarchiveMutation.mutate(id)}
        />
      )}

      {showArchived && archivedAccounts.length > 0 && (
        <p className="text-xs text-[var(--color-content-muted)]">
          已归档账户仍保留历史流水与余额，但不能再用于新交易。
        </p>
      )}

      {dialogOpen && (
        <AccountDialog
          onClose={() => setDialogOpen(false)}
          onCreated={() => {
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
}: {
  accounts: Account[];
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
}) {
  return (
    <div className="card divide-y divide-[var(--color-border-subtle)]">
      {accounts.map((account) => (
        <div key={account.id} className="flex items-center justify-between gap-3 p-4">
          <Link to={`/accounts/${account.id}`} className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{account.name}</p>
              <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-xs text-[var(--color-content-muted)] dark:bg-white/5">
                {ACCOUNT_TYPE_LABELS[account.type]}
              </span>
              {account.status === 'archived' && (
                <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-xs text-[var(--color-content-muted)] dark:bg-white/5">
                  已归档
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--color-content-muted)]">
              {account.institution ?? '未填写机构'}
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
              aria-label={account.status === 'active' ? '归档账户' : '恢复账户'}
              title={account.status === 'active' ? '归档账户' : '恢复账户'}
            >
              {account.status === 'active' ? (
                <Archive className="size-4" />
              ) : (
                <RotateCcw className="size-4" />
              )}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
    onError: (err) => setError(err instanceof ApiError ? err.message : '创建失败'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="card relative w-full max-w-md p-5">
        <h2 className="mb-4 text-base font-medium">新建账户</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          className="space-y-3"
        >
          <Field label="账户名称">
            <input
              required
              maxLength={60}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="账户类型">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as AccountType })}
                className="input"
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ACCOUNT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="币种">
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                className="input"
              >
                {Object.keys(CURRENCY_DECIMALS).map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="机构名称（可选）">
            <input
              maxLength={80}
              value={form.institution}
              onChange={(e) => setForm({ ...form, institution: e.target.value })}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="期初余额">
              <input
                required
                inputMode="decimal"
                value={form.openingBalance}
                onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                className="input"
              />
            </Field>

            <Field label="期初日期">
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
            信用卡与贷款账户的余额会计入负债，请填写欠款金额。
          </p>

          {error && (
            <p role="alert" className="text-sm text-[var(--color-negative)]">
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
              disabled={createMutation.isPending}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {createMutation.isPending ? '创建中…' : '创建'}
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
