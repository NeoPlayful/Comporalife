import type { AdminExchangeRate, AdminLatestExchangeRate } from '@/lib/admin';
import { currencyName, formatDate, formatDateTime, formatRate, trimTrailingZeros } from '@/lib/format';
import { CURRENCY_DECIMALS, CURRENCY_SYMBOLS } from '@/utils/constants';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Row = AdminExchangeRate | AdminLatestExchangeRate;
type Source = 'manual' | 'provider';

/**
 * 单条汇率的编辑抽屉。
 *
 * 房价式行内输入在表格里已经有七八列时挤不下，改数值时又看不到来源和日期，
 * 因此编辑挪到抽屉；来源在这里可改，是「人工覆盖」与「交还自动同步」的唯一入口。
 */
export default function RateEditDrawer({
  row,
  saving,
  onClose,
  onSave,
}: {
  row: Row | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: { id: string; rate: string; source: Source }) => void;
}) {
  const { t } = useTranslation('admin');

  const [rate, setRate] = useState('');
  const [source, setSource] = useState<Source>('manual');

  // 每次换行都重置草稿，避免上一条没保存的值漂到下一条
  useEffect(() => {
    if (!row) return;
    setRate(trimTrailingZeros(row.rate));
    setSource(row.source);
  }, [row]);

  // Esc 关闭：抽屉盖住整页，键盘用户不该只能去点遮罩
  useEffect(() => {
    if (!row) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [row, onClose]);

  if (!row) return null;

  const positive = Number(rate) > 0 && rate.trim() !== '';
  const dirty =
    trimTrailingZeros(row.rate) !== rate.trim() || row.source !== source;

  const sourceHint =
    source === 'provider'
      ? t('exchangeRates.editDrawer.source_provider_hint')
      : t('exchangeRates.editDrawer.source_manual_hint');

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t('exchangeRates.editDrawer.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('exchangeRates.editDrawer.title')}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t('exchangeRates.editDrawer.title')}</h2>
            <p className="mt-1 font-mono text-xs text-[var(--color-content-muted)]">
              1 {row.baseCurrency} → {row.quoteCurrency}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('exchangeRates.editDrawer.close')}
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* 只读信息：判断「这条值是什么时候的」比改数值本身更常用 */}
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5">
              <dt className="text-xs text-[var(--color-content-muted)]">
                {t('exchangeRates.rate_date')}
              </dt>
              <dd className="mt-1 text-xs font-medium">{formatDate(row.rateDate)}</dd>
            </div>
            <div className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5">
              <dt className="text-xs text-[var(--color-content-muted)]">
                {t('exchangeRates.updated_at')}
              </dt>
              <dd className="mt-1 text-xs font-medium">{formatDateTime(row.updatedAt)}</dd>
            </div>
          </dl>

          <div className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[var(--color-content-muted)]">
                {currencyName(row.baseCurrency)} → {currencyName(row.quoteCurrency)}
              </span>
              <span className="font-mono text-[var(--color-content-muted)]">
                {CURRENCY_SYMBOLS[row.baseCurrency] ?? row.baseCurrency} →{' '}
                {CURRENCY_SYMBOLS[row.quoteCurrency] ?? row.quoteCurrency} ·{' '}
                {t('exchangeRates.editDrawer.decimals', {
                  decimals: CURRENCY_DECIMALS[row.quoteCurrency] ?? 2,
                })}
              </span>
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              {t('exchangeRates.editDrawer.rate_label', {
                base: row.baseCurrency,
                quote: row.quoteCurrency,
              })}
            </span>
            <input
              autoFocus
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              className="input font-mono"
              aria-invalid={!positive}
            />
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.editDrawer.current_value', {
                rate: formatRate(row.rate),
              })}
            </span>
          </label>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">
              {t('exchangeRates.editDrawer.source_label')}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(['manual', 'provider'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSource(value)}
                  aria-pressed={source === value}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    source === value
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 font-medium text-[var(--color-accent)]'
                      : 'border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  {value === 'provider'
                    ? t('exchangeRates.source_provider')
                    : t('exchangeRates.source_manual')}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[var(--color-content-muted)]">{sourceHint}</p>
          </fieldset>

          {!positive && (
            <p className="text-xs text-[var(--color-negative)]">
              {t('exchangeRates.editDrawer.rate_invalid')}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('exchangeRates.cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !positive || !dirty}
            onClick={() => onSave({ id: row.id, rate: rate.trim(), source })}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t('exchangeRates.editDrawer.saving') : t('exchangeRates.save')}
          </button>
        </footer>
      </div>
    </div>
  );
}
