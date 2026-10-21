import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { ApiError } from '@/lib/client';
import { transferMatchApi, type TransferCandidate } from '@/lib/imports';

export default function UnmatchedPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['unmatched'], queryFn: () => transferMatchApi.unmatched({ limit: 200 }) });

  const match = useMutation({
    mutationFn: (candidate: TransferCandidate) =>
      transferMatchApi.match(candidate.outgoing.id, candidate.incoming.id),
    onSuccess: async () => {
      setError(null);
      setMessage('已合并为转账，两条原流水已冲正');
      await queryClient.invalidateQueries({ queryKey: ['unmatched'] });
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '匹配失败'),
  });

  if (query.isPending) return <LoadingState label="加载待匹配流水…" />;
  if (query.error) return <ErrorState message="加载失败" onRetry={() => void query.refetch()} />;

  const { candidates, transactions } = query.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">待匹配流水</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            同一笔资金在转出与转入账户各产生一条流水。合并为转账后，这笔资金不再计入收入或支出。
          </p>
        </div>
        <Link to="/imports" className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm">
          返回导入
        </Link>
      </div>

      {message && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">{message}</p>}
      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">候选配对（{candidates.length}）</h2>
        {candidates.length === 0 ? (
          <p className="text-sm text-[var(--color-content-muted)]">暂无可配对的流水。</p>
        ) : (
          candidates.map((candidate) => (
            <div key={`${candidate.outgoing.id}-${candidate.incoming.id}`} className="card space-y-2 p-3">
              <div className="flex items-center justify-between text-xs text-[var(--color-content-muted)]">
                <span>匹配度 {candidate.score}</span>
                <span>{candidate.reasons.join(' · ') || '金额与日期相近'}</span>
              </div>

              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <Side label="转出" tx={candidate.outgoing} />
                <Side label="转入" tx={candidate.incoming} />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={match.isPending}
                  onClick={() => match.mutate(candidate)}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  合并为转账
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">未匹配流水（{transactions.length}）</h2>
        {transactions.length === 0 ? (
          <EmptyState title="没有待匹配流水" description="画一笔转账或导入账单后，这里会显示可配对的流水。" />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)]">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">日期</th>
                  <th className="px-3 py-2 font-medium">账户</th>
                  <th className="px-3 py-2 font-medium">摘要</th>
                  <th className="px-3 py-2 text-right font-medium">金额</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-[var(--color-border-subtle)]/50 last:border-0">
                    <td className="px-3 py-2">{new Date(tx.occurredAt).toLocaleDateString('zh-CN')}</td>
                    <td className="px-3 py-2">{tx.accountName}</td>
                    <td className="max-w-[240px] truncate px-3 py-2">{tx.description}</td>
                    <td
                      className={`px-3 py-2 text-right ${
                        Number(tx.amount) < 0 ? 'text-[var(--color-negative)]' : 'text-emerald-500'
                      }`}
                    >
                      {Number(tx.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Side({ label, tx }: { label: string; tx: TransferCandidate['outgoing'] }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] p-2">
      <p className="text-xs text-[var(--color-content-muted)]">
        {label} · {tx.accountName}
      </p>
      <p className="mt-1 font-medium">
        {Number(tx.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })} {tx.currency}
      </p>
      <p className="truncate text-xs">{tx.description}</p>
      <p className="text-xs text-[var(--color-content-muted)]">
        {new Date(tx.occurredAt).toLocaleDateString('zh-CN')}
      </p>
    </div>
  );
}
