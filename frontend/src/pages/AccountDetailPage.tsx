import {
  ACCOUNT_TYPE_LABELS,
  LIABILITY_TYPES,
  accountsApi,
  type Reconciliation,
} from '@/lib/accounts';
import { ApiError } from '@/lib/client';
import MoneyDisplay from '@/components/finance/MoneyDisplay';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  income: '收入',
  expense: '支出',
  transfer: '转账',
  adjustment: '调整',
};

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 3);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function AccountDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [range] = useState(defaultRange);

  const accountQuery = useQuery({
    queryKey: ['account', id],
    queryFn: () => accountsApi.detail(id),
  });

  const historyQuery = useQuery({
    queryKey: ['account', id, 'history', range],
    queryFn: () => accountsApi.balanceHistory(id, range.from, range.to),
  });

  const txQuery = useQuery({
    queryKey: ['account', id, 'transactions'],
    queryFn: () => accountsApi.transactions(id),
  });

  const reconciliationQuery = useQuery({
    queryKey: ['account', id, 'reconciliations'],
    queryFn: () => accountsApi.reconciliations(id),
  });

  if (accountQuery.isLoading) return <LoadingState />;
  if (accountQuery.isError) return <ErrorState message="账户加载失败" />;

  const account = accountQuery.data!.account;
  const isLiability = LIABILITY_TYPES.includes(account.type);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          to="/accounts"
          className="grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
          aria-label="返回账户列表"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-semibold">{account.name}</h1>
        <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs text-[var(--color-content-muted)] dark:bg-white/5">
          {ACCOUNT_TYPE_LABELS[account.type]}
        </span>
        {account.status === 'archived' && (
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs text-[var(--color-content-muted)] dark:bg-white/5">
            已归档
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-[var(--color-content-muted)]">
            {isLiability ? '当前欠款' : '当前余额'}
          </p>
          <MoneyDisplay
            amount={account.balance}
            currency={account.currency}
            className="mt-1 block text-xl font-semibold"
          />
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            期初 + 已入账分录 · 共 {account.entryCount ?? 0} 条分录
          </p>
        </div>

        <div className="card p-4">
          <p className="text-xs text-[var(--color-content-muted)]">期初余额</p>
          <MoneyDisplay
            amount={account.openingBalance}
            currency={account.currency}
            className="mt-1 block text-lg font-medium"
          />
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            基准日 {account.openingBalanceDate.slice(0, 10)}
          </p>
        </div>

        <div className="card p-4">
          <p className="text-xs text-[var(--color-content-muted)]">机构</p>
          <p className="mt-1 text-lg font-medium">{account.institution ?? '—'}</p>
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">币种 {account.currency}</p>
        </div>
      </div>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-medium">余额走势</h2>
        {historyQuery.isLoading && <LoadingState label="加载余额历史…" />}
        {historyQuery.data && <BalanceSparkline series={historyQuery.data.series} />}
        <p className="mt-2 text-xs text-[var(--color-content-muted)]">
          {historyQuery.data?.basis} · 区间 {range.from} 至 {range.to} ·{' '}
          {historyQuery.data?.granularity === 'day' ? '按日' : '按月'}
        </p>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-[var(--color-border-subtle)] px-4 py-3 text-sm font-medium">
          账户流水
        </h2>

        {txQuery.isLoading && <LoadingState />}
        {txQuery.data && txQuery.data.transactions.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-[var(--color-content-muted)]">
            暂无流水。记账后这里会显示该账户的资金变动。
          </p>
        )}
        {txQuery.data && txQuery.data.transactions.length > 0 && (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {txQuery.data.transactions.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={`truncate text-sm ${tx.status === 'voided' ? 'line-through opacity-60' : ''}`}>
                    {tx.description}
                  </p>
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {tx.occurredAt.slice(0, 10)} · {TRANSACTION_TYPE_LABELS[tx.type] ?? tx.type}
                    {tx.category && ` · ${tx.category.name}`}
                    {tx.status === 'voided' && ' · 已冲正'}
                  </p>
                </div>
                <MoneyDisplay
                  amount={tx.amount}
                  currency={tx.currency}
                  colorize
                  className="shrink-0 text-sm font-medium"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReconcileSection
        accountId={id}
        currency={account.currency}
        reconciliations={reconciliationQuery.data?.reconciliations ?? []}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['account', id] });
        }}
      />
    </div>
  );
}

function BalanceSparkline({ series }: { series: Array<{ period: string; balance: string }> }) {
  if (series.length < 2) {
    return <p className="text-sm text-[var(--color-content-muted)]">数据不足以绘制趋势</p>;
  }

  const values = series.map((point) => Number(point.balance));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const width = 600;
  const height = 120;
  const step = width / (series.length - 1);

  const path = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 12) - 6;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full min-w-[320px]" role="img" aria-label="余额走势图">
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-xs text-[var(--color-content-muted)]">
        <span>{series[0]!.period}</span>
        <span>{series[series.length - 1]!.period}</span>
      </div>
    </div>
  );
}

function ReconcileSection({
  accountId,
  currency,
  reconciliations,
  onChanged,
}: {
  accountId: string;
  currency: string;
  reconciliations: Reconciliation[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [statementBalance, setStatementBalance] = useState('');
  const [reconciledAt, setReconciledAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      accountsApi.reconcile(accountId, {
        statementBalance,
        reconciledAt,
        note: note || undefined,
      }),
    onSuccess: (data) => {
      setOpen(false);
      setStatementBalance('');
      setNote('');
      setError(null);
      setResult(
        data.suggestion
          ? `对账已记录，差异 ${data.reconciliation.difference}。${data.suggestion}`
          : '对账一致，差异为 0。',
      );
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '对账失败'),
  });

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">对账记录</h2>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-sm text-[var(--color-accent)]"
        >
          {open ? '取消' : '新建对账'}
        </button>
      </div>

      {result && (
        <p role="status" className="mb-3 rounded-lg bg-[var(--color-positive)]/10 px-3 py-2 text-sm text-[var(--color-positive)]">
          {result}
        </p>
      )}

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="mb-4 space-y-3 rounded-lg border border-[var(--color-border-subtle)] p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--color-content-muted)]">对账单余额</span>
              <input
                required
                inputMode="decimal"
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value)}
                className="input"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--color-content-muted)]">对账日期</span>
              <input
                required
                type="date"
                value={reconciledAt}
                onChange={(e) => setReconciledAt(e.target.value)}
                className="input"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-[var(--color-content-muted)]">备注（可选）</span>
            <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="input" />
          </label>

          <p className="text-xs text-[var(--color-content-muted)]">
            对账只记录差异，不会自动修改账户余额。如需修正，请创建一笔余额调整交易。
          </p>

          {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {mutation.isPending ? '提交中…' : '保存对账'}
          </button>
        </form>
      )}

      {reconciliations.length === 0 ? (
        <p className="text-sm text-[var(--color-content-muted)]">暂无对账记录</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {reconciliations.map((record) => (
            <li key={record.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-[var(--color-content-muted)]">{record.reconciledAt.slice(0, 10)}</span>
              <span className="text-[var(--color-content-muted)]">
                对账单 <MoneyDisplay amount={record.statementBalance} currency={currency} />
              </span>
              <span className={Number(record.difference) === 0 ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]'}>
                差异 <MoneyDisplay amount={record.difference} currency={currency} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
