import { currencyName } from '@/lib/format';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const CODES = Object.keys(CURRENCY_DECIMALS);
const today = () => new Date().toISOString().slice(0, 10);

export interface RateCreateInput {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  rateDate: string;
}

/**
 * 新建汇率的弹窗。
 *
 * 表单原本铺在页面里，会长期占据表格上方的空间；一次性动作收进弹窗后，
 * 列表页的主体始终是数据本身。同一币种对同一天已有记录时后端是覆盖写入，
 * 因此这里明确提示，避免管理员以为自己在新增。
 */
export default function RateCreateDialog({
  open,
  seed,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** 从同步失败项「补录」进来时预填的币种对 */
  seed: { baseCurrency: string; quoteCurrency: string };
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: RateCreateInput) => void;
}) {
  const { t } = useTranslation('admin');

  const [baseCurrency, setBaseCurrency] = useState(seed.baseCurrency);
  const [quoteCurrency, setQuoteCurrency] = useState(seed.quoteCurrency);
  const [rate, setRate] = useState('');
  const [rateDate, setRateDate] = useState(today());

  // 每次打开都以入口传进来的币种对为准，上次没提交的值不残留
  useEffect(() => {
    if (!open) return;
    setBaseCurrency(seed.baseCurrency);
    setQuoteCurrency(seed.quoteCurrency);
    setRate('');
    setRateDate(today());
  }, [open, seed.baseCurrency, seed.quoteCurrency]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sameCurrency = baseCurrency === quoteCurrency;
  const positive = rate.trim() !== '' && Number(rate) > 0;
  const canSubmit = positive && !sameCurrency && !saving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('exchangeRates.create.title')}
        className="card flex w-full max-w-lg flex-col"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{t('exchangeRates.create.title')}</h2>
            <p className="mt-1 text-xs text-[var(--color-content-muted)]">
              {t('exchangeRates.create.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('exchangeRates.create.close')}
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <form
          className="space-y-4 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onSubmit({
              baseCurrency,
              quoteCurrency,
              rate: rate.trim(),
              rateDate,
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--color-content-muted)]">
              <span className="mb-1 block text-sm font-medium text-[var(--color-content)]">
                {t('exchangeRates.base_currency')}
              </span>
              <select
                className="input"
                value={baseCurrency}
                onChange={(event) => setBaseCurrency(event.target.value)}
              >
                {CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} · {currencyName(code)}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-[var(--color-content-muted)]">
              <span className="mb-1 block text-sm font-medium text-[var(--color-content)]">
                {t('exchangeRates.quote_currency')}
              </span>
              <select
                className="input"
                value={quoteCurrency}
                onChange={(event) => setQuoteCurrency(event.target.value)}
              >
                {CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} · {currencyName(code)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {sameCurrency && (
            <p className="text-xs text-[var(--color-negative)]">
              {t('exchangeRates.create.same_currency')}
            </p>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              {t('exchangeRates.create.rate_label', {
                base: baseCurrency,
                quote: quoteCurrency,
              })}
            </span>
            <input
              autoFocus
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              className="input font-mono"
              placeholder="0.0000"
              aria-invalid={rate.trim() !== '' && !positive}
            />
            {rate.trim() !== '' && !positive && (
              <span className="mt-1 block text-xs text-[var(--color-negative)]">
                {t('exchangeRates.editDrawer.rate_invalid')}
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">{t('exchangeRates.rate_date')}</span>
            <input
              type="date"
              value={rateDate}
              max={today()}
              onChange={(event) => setRateDate(event.target.value)}
              className="input"
            />
          </label>

          <div className="flex items-start gap-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-2.5">
            <Info className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
            <p className="text-xs text-[var(--color-content)]">
              {t('exchangeRates.create.overwrite_hint')}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('exchangeRates.cancel')}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? t('exchangeRates.create.saving') : t('exchangeRates.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
