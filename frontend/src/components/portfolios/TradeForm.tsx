import { categoriesApi } from '@/lib/categories';
import { formatNumber } from '@/lib/format';
import type { Holding, Instrument, TradeKind } from '@/lib/portfolios';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const KINDS: TradeKind[] = ['buy', 'sell', 'dividend', 'interest', 'fee', 'tax'];

export interface TradeDraft {
  kind: TradeKind;
  tradeDate: string;
  instrumentId: string;
  quantity: string;
  price: string;
  amount: string;
  fee: string;
  tax: string;
  categoryId: string;
  note: string;
}

function today(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function emptyTradeDraft(kind: TradeKind = 'buy'): TradeDraft {
  return {
    kind,
    tradeDate: today(),
    instrumentId: '',
    quantity: '',
    price: '',
    amount: '',
    fee: '',
    tax: '',
    categoryId: '',
    note: '',
  };
}

export default function TradeForm({
  draft,
  instruments,
  holdings,
  currency,
  saving,
  error,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: TradeDraft;
  instruments: Instrument[];
  holdings: Holding[];
  currency: string;
  saving: boolean;
  error: string | null;
  onChange: (draft: TradeDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('portfolios');
  const { t: tEnums } = useTranslation('enums');
  const [touched, setTouched] = useState(false);

  const isTrade = draft.kind === 'buy' || draft.kind === 'sell';
  const needsCategory = !isTrade;

  const categoriesQuery = useQuery({
    queryKey: ['categories', 'flat', needsCategory ? 'both' : 'none'],
    queryFn: async () => {
      const [income, expense] = await Promise.all([
        categoriesApi.tree('income'),
        categoriesApi.tree('expense'),
      ]);
      // 直接用接口返回的扁平列表，避免再递归一次树
      const pick = (nodes: Array<{ id: string; name: string; archived?: boolean }>) =>
        nodes.filter((node) => !node.archived).map((node) => ({ id: node.id, name: node.name }));
      return {
        income: pick(income.flat ?? []),
        expense: pick(expense.flat ?? []),
      };
    },
    enabled: needsCategory,
  });

  const expectedKind = draft.kind === 'dividend' || draft.kind === 'interest' ? 'income' : 'expense';
  const categoryOptions =
    expectedKind === 'income' ? categoriesQuery.data?.income ?? [] : categoriesQuery.data?.expense ?? [];

  const availableHolding = holdings.find((holding) => holding.instrumentId === draft.instrumentId);
  const available = availableHolding ? availableHolding.quantity : '0';

  const estimated =
    isTrade && draft.quantity && draft.price
      ? Number(draft.quantity) * Number(draft.price)
      : draft.amount
        ? Number(draft.amount)
        : null;

  const sellExceeds =
    draft.kind === 'sell' &&
    draft.quantity !== '' &&
    Number(draft.quantity) > Number(available);

  const set = (patch: Partial<TradeDraft>) => onChange({ ...draft, ...patch });

  return (
    <section className="card space-y-3">
      <h3 className="text-base font-medium">{t('trade_form.title')}</h3>

      {error && (
        <p className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-content-muted)]">{t('trade_form.kind')}</span>
          <select
            value={draft.kind}
            onChange={(event) => set({ kind: event.target.value as TradeKind, categoryId: '' })}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5"
          >
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {tEnums(`trade_kind.${kind}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-content-muted)]">{t('trade_form.date')}</span>
          <input
            type="date"
            value={draft.tradeDate}
            onChange={(event) => set({ tradeDate: event.target.value })}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-[var(--color-content-muted)]">{t('trade_form.instrument')}</span>
          <select
            value={draft.instrumentId}
            onChange={(event) => {
              set({ instrumentId: event.target.value });
              setTouched(true);
            }}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5"
          >
            <option value="">—</option>
            {instruments.map((instrument) => (
              <option key={instrument.id} value={instrument.id}>
                {instrument.symbol} {instrument.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isTrade ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-content-muted)]">{t('trade_form.quantity')}</span>
            <input
              type="number"
              min="0"
              step="0.00000001"
              value={draft.quantity}
              onChange={(event) => {
                set({ quantity: event.target.value });
                setTouched(true);
              }}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 tabular-nums"
            />
            {draft.kind === 'sell' && (
              <span className="block text-xs text-[var(--color-content-muted)]">
                {t('trade_form.available', { quantity: Number(available) })}
              </span>
            )}
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-content-muted)]">{t('trade_form.price')}</span>
            <input
              type="number"
              min="0"
              step="0.00000001"
              value={draft.price}
              onChange={(event) => set({ price: event.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 tabular-nums"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-content-muted)]">{t('trade_form.fee')}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.fee}
              onChange={(event) => set({ fee: event.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 tabular-nums"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-content-muted)]">{t('trade_form.tax')}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.tax}
              onChange={(event) => set({ tax: event.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 tabular-nums"
            />
          </label>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-content-muted)]">{t('trade_form.amount')}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.amount}
              onChange={(event) => set({ amount: event.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 tabular-nums"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-content-muted)]">{t('trade_form.category')}</span>
            <select
              value={draft.categoryId}
              onChange={(event) => set({ categoryId: event.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5"
            >
              <option value="">—</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <span className="block text-xs text-[var(--color-content-muted)]">
              {t('trade_form.category_hint')}
            </span>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-[var(--color-content-muted)]">{t('trade_form.note')}</span>
            <input
              value={draft.note}
              onChange={(event) => set({ note: event.target.value })}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5"
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {estimated !== null && (
          <p className="text-xs text-[var(--color-content-muted)]">
            {t('trade_form.estimated_amount', {
              amount: `${formatNumber(estimated)} ${currency}`,
            })}
          </p>
        )}
        {sellExceeds && touched && (
          <p className="text-xs text-[var(--color-negative)]">
            {t('trade_form.sell_exceeds', { available: Number(available) })}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || sellExceeds}
          onClick={onSubmit}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? t('trade_form.saving') : t('trade_form.submit')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/10"
        >
          {t('trade_form.cancel')}
        </button>
      </div>
    </section>
  );
}
