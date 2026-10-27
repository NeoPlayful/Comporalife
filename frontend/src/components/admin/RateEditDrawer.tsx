import Modal from '@/components/ui/Modal';
import type { AdminExchangeRate, AdminLatestExchangeRate } from '@/lib/admin';
import { currencyName, formatDate, formatDateTime, formatRate, trimTrailingZeros } from '@/lib/format';
import { CURRENCY_DECIMALS, CURRENCY_SYMBOLS } from '@/utils/constants';
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

  if (!row) return null;

  const positive = Number(rate) > 0 && rate.trim() !== '';
  const dirty =
    trimTrailingZeros(row.rate) !== rate.trim() || row.source !== source;

  const sourceHint =
    source === 'provider'
      ? t('exchangeRates.editDrawer.source_provider_hint')
      : t('exchangeRates.editDrawer.source_manual_hint');

  return (
    <Modal
      open
      variant="drawer"
      size="md"
      title={t('exchangeRates.editDrawer.title')}
      description={
        <span className="font-mono">
          1 {row.baseCurrency} → {row.quoteCurrency}
        </span>
      }
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
            type="button"
            disabled={saving || !positive || !dirty}
            onClick={() => onSave({ id: row.id, rate: rate.trim(), source })}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t('exchangeRates.editDrawer.saving') : t('exchangeRates.save')}
          </button>
        </>
      }
    >
      <div className="space-y-5">
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
          {/* 不加 step：step 只对 type="number" 生效，而数字框会把 6.683751
              这类非整步长的合法汇率判为 stepMismatch，反而挡住精确录入 */}
          <input
            data-autofocus
            inputMode="decimal"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            className="input font-mono"
            placeholder="0.0000"
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
    </Modal>
  );
}
