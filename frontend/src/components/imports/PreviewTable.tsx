import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import type { ImportRow } from '@/lib/imports';

const STATUS_LABELS: Record<string, string> = {
  pending: '待校验',
  valid: '有效',
  invalid: '无效',
  duplicate: '重复',
  suspected: '疑似重复',
  skipped: '已跳过',
  imported: '已导入',
  failed: '失败',
};

const STATUS_TONES: Record<string, string> = {
  valid: 'text-emerald-500',
  imported: 'text-emerald-500',
  invalid: 'text-[var(--color-negative)]',
  failed: 'text-[var(--color-negative)]',
  duplicate: 'text-amber-500',
  suspected: 'text-amber-500',
  skipped: 'text-[var(--color-content-muted)]',
  pending: 'text-[var(--color-content-muted)]',
};

const ROW_HEIGHT = 40;

export default function PreviewTable({
  rows,
  height = 480,
}: {
  rows: ImportRow[];
  height?: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--color-content-muted)]">暂无预览数据</p>;
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)]">
      <div className="grid grid-cols-[70px_110px_120px_90px_1fr_90px] gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--color-content-muted)]">
        <span>行号</span>
        <span>日期</span>
        <span>金额</span>
        <span>方向</span>
        <span>摘要</span>
        <span>状态</span>
      </div>

      <div ref={parentRef} className="overflow-auto" style={{ height }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            const isProblem = row.errors.length > 0;

            return (
              <div
                key={row.id}
                className="absolute left-0 top-0 grid w-full grid-cols-[70px_110px_120px_90px_1fr_90px] items-center gap-2 border-b border-[var(--color-border-subtle)]/50 px-3 text-sm"
                style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                title={isProblem ? row.errors.map((err) => err.message).join('；') : undefined}
              >
                <span className="text-[var(--color-content-muted)]">{row.rowNumber}</span>
                <span className="truncate">{formatDate(row.occurredAt)}</span>
                <span className={Number(row.amount) < 0 ? 'text-[var(--color-negative)]' : 'text-emerald-500'}>
                  {formatAmount(row.amount)}
                </span>
                <span className="text-[var(--color-content-muted)]">
                  {row.direction === 'expense' ? '支出' : row.direction === 'income' ? '收入' : '—'}
                </span>
                <span className="truncate">{row.description ?? row.merchant ?? '—'}</span>
                <span className={STATUS_TONES[row.status] ?? ''}>
                  {STATUS_LABELS[row.status] ?? row.status}
                  {isProblem && <span className="ml-1">!</span>}
                </span>
              </div>
            );
          })}
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
