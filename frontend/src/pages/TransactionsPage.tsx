import { accountsApi } from '@/lib/accounts';
import { categoriesApi } from '@/lib/categories';
import { useEnumLabels, TRANSACTION_TYPE_KEYS } from '@/lib/enum-labels';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import {
  transactionsApi,
  type Transaction,
  type TransactionListParams,
  type TransactionType,
} from '@/lib/transactions';
import MoneyDisplay from '@/components/finance/MoneyDisplay';
import TransactionForm from '@/components/finance/TransactionForm';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function TransactionsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const { transactionType } = useEnumLabels();
  const [formOpen, setFormOpen] = useState(false);
  const [showVoided, setShowVoided] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
      toastSuccess(t('common:feedback.voided'));
      setDetail(null);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => transactionsApi.remove(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.deleted'));
      setDetail(null);
      // 余额、仪表盘与统计都由分录汇总而来，删除后必须一起重取
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    // 导入/匹配/组合生成的交易不能删，后端会说明该走哪个入口
    onError: (err) => toastError(translateError(err, t)),
  });

  const bulkCategorize = useMutation({
    mutationFn: (categoryId: string) =>
      transactionsApi.bulkCategorize([...selected], categoryId || null),
    onSuccess: () => {
      toastSuccess(t('common:feedback.updated'));
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const transactions = listQuery.data?.transactions ?? [];
  const pagination = listQuery.data?.pagination;

  async function confirmRowDelete(tx: Transaction) {
    const ok = await confirm({
      title: t('transactions:detail.delete'),
      // 两段并成一条：确认框只渲染 message，分段会丢失；\n 在 <p> 里不换行，所以用空格接
      message: `${t('transactions:detail.delete_confirm', { description: tx.description })} ${t('transactions:detail.delete_hint')}`,
      confirmLabel: t('transactions:detail.delete'),
      tone: 'danger',
    });
    if (ok) deleteMutation.mutate(tx.id);
  }
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
        <h1 className="text-xl font-semibold">{t('transactions:title')}</h1>
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
            {t('transactions:show_voided')}
          </label>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-1.5 rounded-lg btn-action px-3 py-2 text-sm font-medium"
          >
            <Plus className="size-4" />
            {t('transactions:new')}
          </button>
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value, page: 1 })}
            className="input"
            aria-label={t('transactions:filters.from')}
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value, page: 1 })}
            className="input"
            aria-label={t('transactions:filters.to')}
          />
          <select
            value={filters.accountId}
            onChange={(e) => setFilters({ ...filters, accountId: e.target.value, page: 1 })}
            className="input"
            aria-label={t('transactions:filters.account')}
          >
            <option value="">{t('transactions:filters.all_accounts')}</option>
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
            aria-label={t('transactions:filters.type')}
          >
            <option value="">{t('transactions:filters.all_types')}</option>
            {TRANSACTION_TYPE_KEYS.map((type) => (
              <option key={type} value={type}>
                {transactionType(type)}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-content-muted)]" />
            <input
              value={filters.keyword}
              onChange={(e) => setFilters({ ...filters, keyword: e.target.value, page: 1 })}
              placeholder={t('transactions:filters.keyword')}
              className="input pl-8"
              aria-label={t('transactions:filters.keyword_aria')}
            />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-accent)]/10 px-3 py-2 text-sm">
            <span>{t('transactions:bulk.selected', { count: selected.size })}</span>
            <select
              onChange={(e) => {
                if (e.target.value) bulkCategorize.mutate(e.target.value);
                e.target.value = '';
              }}
              className="input max-w-48"
              defaultValue=""
              aria-label={t('transactions:bulk.categorize_aria')}
            >
              <option value="">{t('transactions:bulk.categorize')}</option>
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
              {t('transactions:bulk.cancel')}
            </button>
          </div>
        )}
      </div>

      {listQuery.isLoading && <LoadingState />}
      {listQuery.isError && (
        <ErrorState message={t('transactions:load_failed')} onRetry={() => listQuery.refetch()} />
      )}

      {listQuery.data && transactions.length === 0 && (
        <div className="card">
          <EmptyState
            title={t('transactions:empty_title')}
            description={t('transactions:empty_description')}
            action={
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="rounded-lg btn-action px-4 py-2 text-sm font-medium"
              >
                {t('transactions:empty_action')}
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
                      aria-label={t('transactions:table.select_all')}
                    />
                  </th>
                  <th className="px-3 py-2">{t('transactions:table.date')}</th>
                  <th className="px-3 py-2">{t('transactions:table.description')}</th>
                  <th className="px-3 py-2">{t('transactions:table.source')}</th>
                  <th className="px-3 py-2">{t('transactions:table.category')}</th>
                  <th className="px-3 py-2">{t('transactions:table.account')}</th>
                  <th className="px-3 py-2 text-right">{t('transactions:table.amount')}</th>
                  <th className="w-16 px-3 py-2 text-right">{t('transactions:table.actions')}</th>
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
                        aria-label={t('transactions:table.select_row', { description: tx.description })}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
                      {formatDate(tx.occurredAt)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={tx.status === 'voided' ? 'line-through' : ''}>{tx.description}</span>
                      <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                        {transactionType(tx.type)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {tx.source === 'import' ? (
                        <Link
                          to={`/imports/${tx.importBatchId}`}
                          onClick={(event) => event.stopPropagation()}
                          className="rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-500"
                        >
                          {t('transactions:table.source_import')}
                        </Link>
                      ) : (
                        <span className="text-xs text-[var(--color-content-muted)]">
                          {t('transactions:table.source_manual')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-content-muted)]">
                      {tx.category?.name ?? t('transactions:table.uncategorized')}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-content-muted)]">
                      {tx.account?.name ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <MoneyDisplay amount={tx.amount} currency={tx.currency} colorize />
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {/* 行内删除按钮不打开详情：删除是独立动作，不该先被抽屉打断 */}
                      <button
                        type="button"
                        onClick={() => void confirmRowDelete(tx)}
                        disabled={deleteMutation.isPending && deleteMutation.variables === tx.id}
                        className="grid size-7 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-[var(--color-negative)]/10 hover:text-[var(--color-negative)] disabled:opacity-50"
                        aria-label={t('transactions:table.delete_row', { description: tx.description })}
                        title={t('transactions:detail.delete')}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && (
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPageChange={(next) => setFilters({ ...filters, page: next })}
            />
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
  const { t } = useTranslation();
  const { transactionType } = useEnumLabels();

  return (
    <Modal
      open
      title={transaction.description}
      description={
        <>
          {formatDate(transaction.occurredAt)} · {transactionType(transaction.type)}
          {transaction.status === 'voided' && t('transactions:detail.voided_suffix')}
        </>
      }
      variant="sheet"
      size="lg"
      busy={voiding}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('common:actions.close')}
          </button>
          {/* 删除只放在列表的操作列：详情里改变数量会让人以为还有第二个入口 */}
          {transaction.status === 'posted' &&
            (confirmVoid ? (
              <button
                type="button"
                onClick={onVoid}
                disabled={voiding}
                className="rounded-lg bg-[var(--color-negative)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {voiding ? t('transactions:detail.voiding') : t('transactions:detail.confirm_void')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmVoid(true)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-negative)] px-3 py-2 text-sm text-[var(--color-negative)]"
              >
                <RotateCcw className="size-4" />
                {t('transactions:detail.void')}
              </button>
            ))}
        </>
      }
    >
        <div className="mb-4">
          <MoneyDisplay
            amount={transaction.amount}
            currency={transaction.currency}
            colorize
            className="text-xl font-semibold"
          />
        </div>

        <dl className="space-y-2 text-sm">
          <Row
            label={t('transactions:detail.category')}
            value={transaction.category?.name ?? t('transactions:table.uncategorized')}
          />
          {transaction.merchant && (
            <Row label={t('transactions:detail.merchant')} value={transaction.merchant} />
          )}
          {transaction.note && <Row label={t('transactions:detail.note')} value={transaction.note} />}
          {transaction.tags.length > 0 && (
            <Row
              label={t('transactions:detail.tags')}
              value={transaction.tags.map((tag) => tag.name).join(t('common:list_separator'))}
            />
          )}
        </dl>

        <div className="mt-4">
          <h3 className="mb-2 text-xs font-medium text-[var(--color-content-muted)]">
            {t('transactions:detail.entries')}
          </h3>
          <ul className="divide-y divide-[var(--color-border-subtle)] rounded-lg border border-[var(--color-border-subtle)]">
            {transaction.entries.map((entry, index) => (
              <li key={index} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className={entry.accountId ? '' : 'text-[var(--color-content-muted)]'}>
                  {entry.accountName ?? t('transactions:detail.external_counterparty')}
                </span>
                <MoneyDisplay amount={entry.amount} currency={entry.currency} colorize />
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            {t('transactions:detail.entries_hint')}
          </p>
        </div>

        {confirmVoid && (
          <p className="mt-4 text-xs text-[var(--color-content-muted)]">
            {t('transactions:detail.void_hint')}
          </p>
        )}
    </Modal>
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
