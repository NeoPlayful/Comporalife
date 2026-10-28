import Modal from '@/components/ui/Modal';
import { currencyName, formatRate } from '@/lib/format';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** 一排可批量录入的币种对：已有值时预填当前值，方便只改其中几个 */
export interface BulkDraft {
  baseCurrency: string;
  quoteCurrency: string;
  currentRate: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 批量录入抽屉：统一生效日期，逐对填写后一次提交。
 *
 * 后端在单事务里写完整批，任一校验失败就整批回滚，因此这里不需要处理
 * 「部分成功」——失败时表单原样保留，改完再提交即可。
 */
export default function RateBulkDrawer({
  open,
  drafts,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  drafts: BulkDraft[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: {
    rateDate: string;
    rates: Array<{ baseCurrency: string; quoteCurrency: string; rate: string }>;
  }) => void;
}) {
  const { t } = useTranslation('admin');

  const [rateDate, setRateDate] = useState(today());
  const [values, setValues] = useState<Record<string, string>>({});

  // 每次打开都以传入的选中行为准，上次没提交的草稿不应该残留
  useEffect(() => {
    if (!open) return;
    setRateDate(today());
    setValues(
      Object.fromEntries(
        drafts.map((draft) => [
          `${draft.baseCurrency}->${draft.quoteCurrency}`,
          draft.currentRate ?? '',
        ]),
      ),
    );
  }, [open, drafts]);

  const rows = useMemo(
    () =>
      drafts.map((draft) => {
        const key = `${draft.baseCurrency}->${draft.quoteCurrency}`;
        const value = values[key] ?? '';
        return {
          key,
          draft,
          value,
          valid: value.trim() !== '' && Number(value) > 0,
        };
      }),
    [drafts, values],
  );

  const filledCount = rows.filter((row) => row.valid).length;
  const canSubmit = filledCount > 0 && !saving;

  // 预填的是已有值，只有改过某个数字或日期才算脏
  const dirty =
    rateDate !== today() ||
    rows.some((row) => row.value !== (row.draft.currentRate ?? ''));

  return (
    <Modal
      open={open}
      variant="drawer"
      size="lg"
      title={t('exchangeRates.bulk.title')}
      description={t('exchangeRates.bulk.subtitle', { count: drafts.length })}
      dirty={dirty}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-[var(--color-content-muted)]">
            {t('exchangeRates.bulk.filled', { filled: filledCount, total: rows.length })}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('exchangeRates.cancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onSubmit({
                rateDate,
                rates: rows
                  .filter((row) => row.valid)
                  .map((row) => ({
                    baseCurrency: row.draft.baseCurrency,
                    quoteCurrency: row.draft.quoteCurrency,
                    rate: row.value.trim(),
                  })),
              })
            }
            className="rounded-lg btn-action px-3 py-2 text-sm font-medium"
          >
            {saving ? t('exchangeRates.bulk.saving') : t('exchangeRates.bulk.submit')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t('exchangeRates.rate_date')}</span>
          <input
            data-autofocus
            type="date"
            value={rateDate}
            onChange={(event) => setRateDate(event.target.value)}
            className="input"
          />
        </label>

        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-lg border border-[var(--color-border-subtle)]">
          {rows.map(({ key, draft, value, valid }) => (
            <li key={key} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">
                  1 {draft.baseCurrency} → {draft.quoteCurrency}
                </p>
                <p className="truncate text-xs text-[var(--color-content-muted)]">
                  {currencyName(draft.baseCurrency)} → {currencyName(draft.quoteCurrency)}
                  {draft.currentRate !== null &&
                    ` · ${t('exchangeRates.bulk.current', {
                      rate: formatRate(draft.currentRate),
                    })}`}
                </p>
              </div>
              <input
                inputMode="decimal"
                value={value}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [key]: event.target.value }))
                }
                placeholder={t('exchangeRates.bulk.placeholder')}
                aria-label={`1 ${draft.baseCurrency} → ${draft.quoteCurrency}`}
                aria-invalid={value.trim() !== '' && !valid}
                className={`input w-32 py-1 font-mono ${
                  value.trim() !== '' && !valid ? 'border-[var(--color-negative)]' : ''
                }`}
              />
            </li>
          ))}
        </ul>

        {drafts.length === 0 && (
          <p className="text-sm text-[var(--color-content-muted)]">{t('exchangeRates.bulk.empty')}</p>
        )}
      </div>
    </Modal>
  );
}
