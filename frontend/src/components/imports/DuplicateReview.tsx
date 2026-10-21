import { useMemo, useState } from 'react';
import type { DuplicateRow } from '@/lib/imports';

export type DuplicateDecision = 'keep' | 'skip';

export default function DuplicateReview({
  exact,
  suspected,
  onSubmit,
  submitting,
}: {
  exact: DuplicateRow[];
  suspected: DuplicateRow[];
  onSubmit: (decisions: Array<{ rowId: string; action: DuplicateDecision }>) => void;
  submitting?: boolean;
}) {
  // 完全重复默认跳过，疑似重复必须逐条确认
  const [decisions, setDecisions] = useState<Record<string, DuplicateDecision>>(() =>
    Object.fromEntries(exact.map((row) => [row.id, 'skip' as DuplicateDecision])),
  );

  const unconfirmed = useMemo(
    () => suspected.filter((row) => decisions[row.id] === undefined).length,
    [suspected, decisions],
  );

  function setAll(rows: DuplicateRow[], action: DuplicateDecision) {
    setDecisions((current) => {
      const next = { ...current };
      for (const row of rows) next[row.id] = action;
      return next;
    });
  }

  function toggle(row: DuplicateRow) {
    setDecisions((current) => ({
      ...current,
      [row.id]: current[row.id] === 'keep' ? 'skip' : 'keep',
    }));
  }

  const allRows = [...exact, ...suspected];

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">完全重复（{exact.length}）</h3>
          {exact.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => setAll(exact, 'skip')} className="text-[var(--color-accent)]">
                全部跳过
              </button>
              <button type="button" onClick={() => setAll(exact, 'keep')} className="text-amber-500">
                全部保留
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--color-content-muted)]">
          这些行与已有交易完全一致，默认跳过。保留会造成重复记账。
        </p>
        <div className="space-y-2">
          {exact.map((row) => (
            <ComparisonCard key={row.id} row={row} decision={decisions[row.id]} onToggle={() => toggle(row)} />
          ))}
          {exact.length === 0 && <p className="text-xs text-[var(--color-content-muted)]">无</p>}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">疑似重复（{suspected.length}）</h3>
          {suspected.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => setAll(suspected, 'skip')} className="text-[var(--color-accent)]">
                全部跳过
              </button>
              <button type="button" onClick={() => setAll(suspected, 'keep')} className="text-amber-500">
                全部保留
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--color-content-muted)]">
          同账户、同金额、日期相近，但摘要不同。请逐条判断是否为同一笔交易。
        </p>
        <div className="space-y-2">
          {suspected.map((row) => (
            <ComparisonCard key={row.id} row={row} decision={decisions[row.id]} onToggle={() => toggle(row)} />
          ))}
          {suspected.length === 0 && <p className="text-xs text-[var(--color-content-muted)]">无</p>}
        </div>
      </section>

      {unconfirmed > 0 && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
          还有 {unconfirmed} 条疑似重复未确认，确认后才能提交。
        </p>
      )}

      <button
        type="button"
        disabled={submitting || unconfirmed > 0}
        onClick={() =>
          onSubmit(
            allRows
              .filter((row) => decisions[row.id] !== undefined)
              .map((row) => ({ rowId: row.id, action: decisions[row.id]! })),
          )
        }
        className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? '保存中…' : '保存确认结果'}
      </button>
    </div>
  );
}

function ComparisonCard({
  row,
  decision,
  onToggle,
}: {
  row: DuplicateRow;
  decision?: DuplicateDecision;
  onToggle: () => void;
}) {
  return (
    <div className="card space-y-2 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs text-[var(--color-content-muted)]">第 {row.rowNumber} 行</span>
        <button
          type="button"
          onClick={onToggle}
          className={`rounded-full px-3 py-0.5 text-xs ${
            decision === 'keep'
              ? 'bg-amber-500/15 text-amber-500'
              : decision === 'skip'
                ? 'bg-black/10 text-[var(--color-content-muted)] dark:bg-white/10'
                : 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
          }`}
        >
          {decision === 'keep' ? '保留' : decision === 'skip' ? '跳过' : '待确认'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--color-content-muted)]">本次导入</p>
          <p>{formatDate(row.occurredAt)}</p>
          <p className="font-medium">{formatAmount(row.amount)}</p>
          <p className="truncate">{row.description ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--color-content-muted)]">已有交易</p>
          {row.counterpart ? (
            <>
              <p>{formatDate(row.counterpart.occurredAt)}</p>
              <p className="font-medium">{formatAmount(row.amount)}</p>
              <p className="truncate">
                {row.counterpart.description}
                {row.counterpart.accountName ? ` · ${row.counterpart.accountName}` : ''}
              </p>
            </>
          ) : (
            <p className="text-[var(--color-content-muted)]">未找到对应交易</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('zh-CN');
}

function formatAmount(value: string | null): string {
  if (!value) return '—';
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
