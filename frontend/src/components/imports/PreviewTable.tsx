import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImportRow } from '@/lib/imports';
import { formatDate, formatNumber } from '@/lib/format';

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
  const { t } = useTranslation('imports');
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--color-content-muted)]">{t('preview.empty')}</p>;
  }

  return (
    <div className="rounded-xl border border-[var(--color-border-subtle)]">
      <div className="grid grid-cols-[70px_110px_120px_90px_1fr_90px] gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--color-content-muted)]">
        <span>{t('preview.columns.row')}</span>
        <span>{t('preview.columns.date')}</span>
        <span>{t('preview.columns.amount')}</span>
        <span>{t('preview.columns.direction')}</span>
        <span>{t('preview.columns.description')}</span>
        <span>{t('preview.columns.status')}</span>
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
                title={
                  isProblem
                    ? row.errors.map((err) => err.message).join(t('common:list_separator'))
                    : undefined
                }
              >
                <span className="text-[var(--color-content-muted)]">{row.rowNumber}</span>
                <span className="truncate">{formatDate(row.occurredAt)}</span>
                <span className={Number(row.amount) < 0 ? 'text-[var(--color-negative)]' : 'text-emerald-500'}>
                  {formatNumber(row.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[var(--color-content-muted)]">
                  {row.direction === 'expense'
                    ? t('preview.direction.expense')
                    : row.direction === 'income'
                      ? t('preview.direction.income')
                      : '—'}
                </span>
                <span className="truncate">{row.description ?? row.merchant ?? '—'}</span>
                <span className={STATUS_TONES[row.status] ?? ''}>
                  {t(`preview.row_status.${row.status}`, { defaultValue: row.status })}
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
