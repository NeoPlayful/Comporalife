import { accountsApi } from '@/api/accounts';
import { categoriesApi } from '@/api/categories';
import { ApiError } from '@/api/client';
import {
  TRANSACTION_TYPE_LABELS,
  transactionsApi,
  type Transaction,
  type TransactionListParams,
  type TransactionType,
} from '@/api/transactions';
import MoneyDisplay from '@/components/finance/MoneyDisplay';
import TransactionForm from '@/components/finance/TransactionForm';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { useState } from 'react';

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [showVoided, setShowVoided] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Transaction | null>(null);

  const [filters, setFilters] = useState<{
    from: string;
    to: string;
    accountId: string;
    categoryId: string;
    type: '' | TransactionType;
    keyword: string;
    page: number;
  }>({ from: '', to: '', accountId: '', categoryId: '', type: '', keyword: '', page: 1 });

  const params: TransactionListParams = {
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.keyword ? { keyword: filters.keyword } : {}),
    status: showVoided ? 'all' : 'posted',
    page: filters.page,
    pageSize: 20,
  };

  const listQuery = useQuery({
    queryKey: ['transactions', params],
    queryFn: () => transactionsApi.list(params),
  });

  const accountsQuery = useQuery({
    queryKey: ['accounts', 'all-active'],
    queryFn: () => accountsApi.list({ status: 'all' }),
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => categoriesApi.tree(),
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) => transactionsApi.void(id),
    onSuccess: () => {
      setError(null);
      setDetail(null);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '冲正失败'),
  });

  const bulkCategorize = useMutation({
    mutationFn: (categoryId: string) =>
      transactionsApi.bulkCategorize([...selected], categoryId || null),
    onSuccess: () => {
      setSelected(new Set());
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '批量分类失败'),
  });

  const transactions = listQuery.data?.transactions ?? [];
  const pagination = listQuery.data?.pagination;
  const allChecked = transactions.length > 0 && transactions.every((tx) => selected.has(tx.id));

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(transactions.map((tx) => tx.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">交易流水</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--color-content-muted)]">
            <input
              type="checkbox"
              checked={showVoided}
              onChange={(e) => {
                setShowVoided(e.target.checked);
                setFilters({ ...filters, page: 1 });
              }}
              className="size-4 rounded border-[var(--color-border-subtle)]"
            />
            显示已冲正
          </label>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
          >
            <Plus className="size-4" />
            新增交易
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      <div className="card space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value, page: 1 })}
            className="input"
            aria-label="起始日期"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value, page: 1 })}
            className="input"
            aria-label="结束日期"
          />
          <select
            value={filters.accountId}
            onChange={(e) => setFilters({ ...filters, accountId: e.target.value, page: 1 })}
            className="input"
            aria-label="账户筛选"
          >
            <option value="">全部账户</option>
            {accountsQuery.data?.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <select
            value={filters.type}
            onChange={(e) =>
              setFilters({ ...filters, type: e.target.value as '' | TransactionType, page: 1 })
            }
            className="input"
            aria-label="类型筛选"
          >
            <option value="">全部类型</option>
            {(Object.keys(TRANSACTION_TYPE_LABELS) as TransactionType[]).map((type) => (
              <option key={type} value={type}>
                {TRANSACTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-content-muted)]" />
            <input
              value={filters.keyword}
              onChange={(e) => setFilters({ ...filters, keyword: e.target.value, page: 1 })}
              placeholder="搜索摘要或商户"
              className="input pl-8"
              aria-label="关键词搜索"
            />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-accent)]/10 px-3 py-2 text-sm">
            <span>已选择 {selected.size} 条</span>
            <select
              onChange={(e) => {
                if (e.target.value) bulkCategorize.mutate(e.target.value);
                e.target.value = '';
              }}
              className="input max-w-48"
              defaultValue=""
              aria-label="批量设置分类"
            >
              <option value="">批量设置分类…</option>
              {categoriesQuery.data?.flat.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.parentId ? '　' : ''}
                  {category.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[var(--color-content-muted)]"
            >
              取消选择
            </button>
          </div>
        )}
      </div>

      {listQuery.isLoading && <LoadingState />}
      {listQuery.isError && <ErrorState message="流水加载失败" onRetry={() => listQuery.refetch()} />}

      {listQuery.data && transactions.length === 0 && (
        <div className="card">
          <EmptyState
            title="暂无流水"
            description="新增一笔支出或收入后，这里会显示完整的交易记录。"
            action={
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                新增第一笔交易
              </button>
            }
          />
        </div>
      )}

      {transactions.length > 0 && (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      className="size-4 rounded border-[var(--color-border-subtle)]"
                      aria-label="全选"
                    />
                  </th>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">摘要</th>
                  <th className="px-3 py-2">分类</th>
                  <th className="px-3 py-2">账户</th>
                  <th className="px-3 py-2 text-right">金额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={`cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 ${
                      tx.status === 'voided' ? 'opacity-60' : ''
                    }`}
                    onClick={() => setDetail(tx)}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(tx.id)}
                        onChange={() => toggleOne(tx.id)}
                        className="size-4 rounded border-[var(--color-border-subtle)]"
                        aria-label={`选择 ${tx.description}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
                      {tx.occurredAt.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={tx.status === 'voided' ? 'line-through' : ''}>{tx.description}</span>
                      <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                        {TRANSACTION_TYPE_LABELS[tx.type]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[var(--color-content-muted)]">
                      {tx.category?.name ?? '未分类'}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-content-muted)]">
                      {tx.account?.name ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <MoneyDisplay amount={tx.amount} currency={tx.currency} colorize />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--color-content-muted)]">
                共 {pagination.total} 条 · 第 {pagination.page}/{pagination.totalPages} 页
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => setFilters({ ...filters, page: pagination.page - 1 })}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setFilters({ ...filters, page: pagination.page + 1 })}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {formOpen && (
        <TransactionForm onClose={() => setFormOpen(false)} onSaved={() => setFormOpen(false)} />
      )}

      {detail && (
        <TransactionDetail
          transaction={detail}
          onClose={() => setDetail(null)}
          onVoid={() => voidMutation.mutate(detail.id)}
          voiding={voidMutation.isPending}
        />
      )}
    </div>
  );
}

function TransactionDetail({
  transaction,
  onClose,
  onVoid,
  voiding,
}: {
  transaction: Transaction;
  onClose: () => void;
  onVoid: () => void;
  voiding: boolean;
}) {
  const [confirmVoid, setConfirmVoid] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="关闭" />
      <div className="card relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">{transaction.description}</h2>
            <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
              {transaction.occurredAt.slice(0, 10)} · {TRANSACTION_TYPE_LABELS[transaction.type]}
              {transaction.status === 'voided' && ' · 已冲正'}
            </p>
          </div>
          <MoneyDisplay
            amount={transaction.amount}
            currency={transaction.currency}
            colorize
            className="text-base font-semibold"
          />
        </div>

        <dl className="space-y-2 text-sm">
          <Row label="分类" value={transaction.category?.name ?? '未分类'} />
          {transaction.merchant && <Row label="商户" value={transaction.merchant} />}
          {transaction.note && <Row label="备注" value={transaction.note} />}
          {transaction.tags.length > 0 && (
            <Row label="标签" value={transaction.tags.map((tag) => tag.name).join('、')} />
          )}
        </dl>

        <div className="mt-4">
          <h3 className="mb-2 text-xs font-medium text-[var(--color-content-muted)]">复式分录</h3>
          <ul className="divide-y divide-[var(--color-border-subtle)] rounded-lg border border-[var(--color-border-subtle)]">
            {transaction.entries.map((entry, index) => (
              <li key={index} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className={entry.accountId ? '' : 'text-[var(--color-content-muted)]'}>
                  {entry.accountName ?? '外部对手方'}
                </span>
                <MoneyDisplay amount={entry.amount} currency={entry.currency} colorize />
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            两条分录求和为零，表示资金只是从一方转移到另一方。
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm"
          >
            关闭
          </button>
          {transaction.status === 'posted' &&
            (confirmVoid ? (
              <button
                type="button"
                onClick={onVoid}
                disabled={voiding}
                className="rounded-lg bg-[var(--color-negative)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {voiding ? '冲正中…' : '确认冲正'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmVoid(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-negative)] px-4 py-2 text-sm text-[var(--color-negative)]"
              >
                <RotateCcw className="size-4" />
                冲正
              </button>
            ))}
        </div>

        {confirmVoid && (
          <p className="mt-2 text-xs text-[var(--color-content-muted)]">
            冲正会保留记录但撤销其对余额的影响，历史仍可追溯。
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-[var(--color-content-muted)]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
