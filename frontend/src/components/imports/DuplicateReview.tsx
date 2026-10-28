import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DuplicateRow } from '@/lib/imports';
import { formatDate, formatNumber } from '@/lib/format';

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
  const { t } = useTranslation('imports');

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
          <h3 className="text-sm font-medium">{t('duplicates.exact', { count: exact.length })}</h3>
          {exact.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => setAll(exact, 'skip')} className="text-[var(--color-accent)]">
                {t('duplicates.skip_all')}
              </button>
              <button type="button" onClick={() => setAll(exact, 'keep')} className="text-amber-500">
                {t('duplicates.keep_all')}
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--color-content-muted)]">{t('duplicates.exact_hint')}</p>
        <div className="space-y-2">
          {exact.map((row) => (
            <ComparisonCard key={row.id} row={row} decision={decisions[row.id]} onToggle={() => toggle(row)} />
          ))}
          {exact.length === 0 && (
            <p className="text-xs text-[var(--color-content-muted)]">{t('duplicates.none')}</p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t('duplicates.suspected', { count: suspected.length })}</h3>
          {suspected.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => setAll(suspected, 'skip')} className="text-[var(--color-accent)]">
                {t('duplicates.skip_all')}
              </button>
              <button type="button" onClick={() => setAll(suspected, 'keep')} className="text-amber-500">
                {t('duplicates.keep_all')}
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--color-content-muted)]">{t('duplicates.suspected_hint')}</p>
        <div className="space-y-2">
          {suspected.map((row) => (
            <ComparisonCard key={row.id} row={row} decision={decisions[row.id]} onToggle={() => toggle(row)} />
          ))}
          {suspected.length === 0 && (
            <p className="text-xs text-[var(--color-content-muted)]">{t('duplicates.none')}</p>
          )}
        </div>
      </section>

      {unconfirmed > 0 && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
          {t('duplicates.unconfirmed', { count: unconfirmed })}
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
        className="rounded-lg btn-action px-4 py-2 text-sm font-medium"
      >
        {submitting ? t('duplicates.saving') : t('duplicates.save')}
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
  const { t } = useTranslation('imports');

  return (
    <div className="card space-y-2 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs text-[var(--color-content-muted)]">
          {t('duplicates.row_label', { row: row.rowNumber })}
        </span>
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
          {decision === 'keep'
            ? t('duplicates.keep')
            : decision === 'skip'
              ? t('duplicates.skip')
              : t('duplicates.pending')}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--color-content-muted)]">
            {t('duplicates.this_import')}
          </p>
          <p>{formatDate(row.occurredAt)}</p>
          <p className="font-medium">
            {formatNumber(row.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="truncate">{row.description ?? '—'}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--color-content-muted)]">
            {t('duplicates.existing')}
          </p>
          {row.counterpart ? (
            <>
              <p>{formatDate(row.counterpart.occurredAt)}</p>
              <p className="font-medium">
                {formatNumber(row.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="truncate">
                {row.counterpart.description}
                {row.counterpart.accountName ? ` · ${row.counterpart.accountName}` : ''}
              </p>
            </>
          ) : (
            <p className="text-[var(--color-content-muted)]">{t('duplicates.no_counterpart')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
