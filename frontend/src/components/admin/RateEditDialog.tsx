import Modal from '@/components/ui/Modal';
import type { AdminLatestExchangeRate } from '@/lib/admin';
import { currencyName, formatDateTime, formatRate, trimTrailingZeros } from '@/lib/format';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Row = AdminLatestExchangeRate;
type Source = 'manual' | 'provider';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 编辑单条汇率的弹窗。
 *
 * 与新建保持同一形态。币种对与生效日期是这条记录的身份，改动它们等于换一条
 * 记录，因此在这里只读展示；表单只负责数值与来源。来源是「人工覆盖」与
 * 「交还自动同步」的唯一入口。
 */
export default function RateEditDialog({
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

  if (!row) return null;

  const positive = rate.trim() !== '' && Number(rate) > 0;
  const dirty = trimTrailingZeros(row.rate) !== rate.trim() || row.source !== source;

  const sourceHint =
    source === 'provider'
      ? t('exchangeRates.editForm.source_provider_hint')
      : t('exchangeRates.editForm.source_manual_hint');

  return (
    <Modal
      open
      size="lg"
      title={t('exchangeRates.editForm.title')}
      description={t('exchangeRates.editForm.subtitle')}
      dirty={dirty}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('exchangeRates.cancel')}
          </button>
          <button
            type="submit"
            form="rate-edit-form"
            disabled={saving || !positive || !dirty}
            className="rounded-lg btn-action px-3 py-2 text-sm font-medium"
          >
            {saving ? t('exchangeRates.editForm.saving') : t('exchangeRates.save')}
          </button>
        </>
      }
    >
      <form
        id="rate-edit-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!positive || !dirty || saving) return;
          onSave({ id: row.id, rate: rate.trim(), source });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="text-xs text-[var(--color-content-muted)]">
            <span className="mb-1 block text-sm font-medium text-[var(--color-content)]">
              {t('exchangeRates.base_currency')}
            </span>
            <div className="input flex items-center justify-between gap-2 bg-black/5 dark:bg-white/5">
              <span className="font-mono">{row.baseCurrency}</span>
              <span className="truncate">{currencyName(row.baseCurrency)}</span>
            </div>
          </div>

          <div className="text-xs text-[var(--color-content-muted)]">
            <span className="mb-1 block text-sm font-medium text-[var(--color-content)]">
              {t('exchangeRates.quote_currency')}
            </span>
            <div className="input flex items-center justify-between gap-2 bg-black/5 dark:bg-white/5">
              <span className="font-mono">{row.quoteCurrency}</span>
              <span className="truncate">{currencyName(row.quoteCurrency)}</span>
            </div>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            {t('exchangeRates.editForm.rate_label', {
              base: row.baseCurrency,
              quote: row.quoteCurrency,
            })}
          </span>
          <input
            data-autofocus
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            className="input font-mono"
            placeholder="0.0000"
            aria-invalid={!positive}
          />
          {!positive ? (
            <span className="mt-1 block text-xs text-[var(--color-negative)]">
              {t('exchangeRates.editForm.rate_invalid')}
            </span>
          ) : (
            <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.editForm.current_value', { rate: formatRate(row.rate) })}
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t('exchangeRates.rate_date')}</span>
          <input
            type="date"
            value={row.rateDate.slice(0, 10)}
            max={today()}
            disabled
            className="input opacity-70"
          />
          <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
            {t('exchangeRates.editForm.date_locked')}
          </span>
        </label>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">
            {t('exchangeRates.editForm.source_label')}
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

        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
          <p className="text-xs text-[var(--color-content)]">
            {t('exchangeRates.editForm.updated_at_hint', {
              time: formatDateTime(row.updatedAt),
              decimals: CURRENCY_DECIMALS[row.quoteCurrency] ?? 2,
            })}
          </p>
        </div>
      </form>
    </Modal>
  );
}
