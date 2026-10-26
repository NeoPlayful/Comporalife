import type { AdminExchangeRate, AdminLatestExchangeRate } from '@/lib/admin';
import { currencyName, formatDate, formatDateTime, formatRate } from '@/lib/format';
import { AlertTriangle, LineChart, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type RateTableMode = 'latest' | 'records';

/** 两个视图共用的行形状：latest 多一个 daysLag，records 没有 */
type Row = AdminExchangeRate | AdminLatestExchangeRate;

function lagOf(row: Row): number | null {
  return 'daysLag' in row ? row.daysLag : null;
}

/**
 * 汇率表格与移动端卡片。
 *
 * 「当前汇率」和「同步记录」的数据形状几乎一致，只有滞后天数一列是当前视图
 * 专属，因此合成一个组件按 mode 打开对应列，两个视图的动作入口也保持一致。
 * 小屏改用卡片：汇率对本身很短，横向滚动的表格在手机上读不出上下文。
 */
export default function RateTable({
  mode,
  rows,
  staleDays,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onEdit,
  onViewHistory,
  onDelete,
}: {
  mode: RateTableMode;
  rows: Row[];
  staleDays: number;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onEdit: (row: Row) => void;
  onViewHistory: (row: Row) => void;
  onDelete: (row: Row) => void;
}) {
  const { t } = useTranslation('admin');

  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const showLag = mode === 'latest';

  const sourceLabel = (source: string) =>
    source === 'provider'
      ? t('exchangeRates.source_provider')
      : t('exchangeRates.source_manual');

  const pairLabel = (row: Row) => `1 ${row.baseCurrency} → ${row.quoteCurrency}`;

  return (
    <>
      {/* 小屏卡片 */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((row) => {
          const lag = lagOf(row);
          const stale = lag !== null && lag > staleDays;
          return (
            <li key={row.id} className="card space-y-1.5 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm">{pairLabel(row)}</p>
                  <p className="truncate text-xs text-[var(--color-content-muted)]">
                    {currencyName(row.baseCurrency)} → {currencyName(row.quoteCurrency)}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-[var(--color-content-muted)]">
                  {sourceLabel(row.source)}
                </span>
              </div>

              <p className="font-mono text-lg tabular-nums">{formatRate(row.rate)}</p>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-content-muted)]">
                <span>{formatDate(row.rateDate)}</span>
                {showLag && lag !== null && (
                  <span
                    className={
                      stale
                        ? 'flex items-center gap-1 text-amber-600 dark:text-amber-400'
                        : undefined
                    }
                  >
                    {stale && <AlertTriangle className="size-3" aria-hidden />}
                    {lag === 0
                      ? t('exchangeRates.lag.today')
                      : t('exchangeRates.lag.days', { days: lag })}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-1 text-xs">
                <button
                  type="button"
                  onClick={() => onEdit(row)}
                  className="flex items-center gap-1 hover:text-[var(--color-accent)]"
                >
                  <Pencil className="size-3.5" aria-hidden />
                  {t('exchangeRates.edit')}
                </button>
                <button
                  type="button"
                  onClick={() => onViewHistory(row)}
                  className="flex items-center gap-1 hover:text-[var(--color-accent)]"
                >
                  <LineChart className="size-3.5" aria-hidden />
                  {t('exchangeRates.history.open')}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(row)}
                  className="flex items-center gap-1 text-[var(--color-negative)]"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {t('exchangeRates.delete')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 桌面表格 */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
            <tr>
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => onToggleSelectAll(event.target.checked)}
                  aria-label={t('exchangeRates.bulk.select_all')}
                  className="size-4 rounded border-[var(--color-border-subtle)]"
                />
              </th>
              <th className="px-3 py-2">{t('exchangeRates.pair')}</th>
              <th className="px-3 py-2 text-right">{t('exchangeRates.rate')}</th>
              <th className="px-3 py-2">{t('exchangeRates.rate_date')}</th>
              {showLag && <th className="px-3 py-2">{t('exchangeRates.lag.column')}</th>}
              <th className="px-3 py-2">{t('exchangeRates.source')}</th>
              <th className="px-3 py-2">{t('exchangeRates.updated_at')}</th>
              <th className="px-3 py-2 text-right">{t('exchangeRates.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)]">
            {rows.map((row) => {
              const lag = lagOf(row);
              const stale = lag !== null && lag > staleDays;
              return (
                <tr
                  key={row.id}
                  className={`hover:bg-black/5 dark:hover:bg-white/5 ${
                    selected.has(row.id) ? 'bg-[var(--color-accent)]/5' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => onToggleSelect(row.id)}
                      aria-label={pairLabel(row)}
                      className="size-4 rounded border-[var(--color-border-subtle)]"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="font-mono">{pairLabel(row)}</span>
                    <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                      {currencyName(row.baseCurrency)} → {currencyName(row.quoteCurrency)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                    {formatRate(row.rate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
                    {formatDate(row.rateDate)}
                  </td>
                  {showLag && lag !== null && (
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <span
                        className={
                          stale
                            ? 'flex items-center gap-1 text-amber-600 dark:text-amber-400'
                            : 'text-[var(--color-content-muted)]'
                        }
                      >
                        {stale && <AlertTriangle className="size-3" aria-hidden />}
                        {lag === 0
                          ? t('exchangeRates.lag.today')
                          : t('exchangeRates.lag.days', { days: lag })}
                      </span>
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{sourceLabel(row.source)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--color-content-muted)]">
                    {formatDateTime(row.updatedAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        aria-label={t('exchangeRates.edit')}
                        onClick={() => onEdit(row)}
                        className="text-[var(--color-content-muted)] hover:text-[var(--color-accent)]"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t('exchangeRates.history.open')}
                        onClick={() => onViewHistory(row)}
                        className="text-[var(--color-content-muted)] hover:text-[var(--color-accent)]"
                      >
                        <LineChart className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={t('exchangeRates.delete')}
                        onClick={() => onDelete(row)}
                        className="text-[var(--color-content-muted)] hover:text-[var(--color-negative)]"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
