import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { translateError } from '@/lib/error-message';
import { exchangeRatesApi, type ExchangeRateRecord } from '@/lib/dashboard';
import { formatDate } from '@/lib/format';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 10;
const CODES = Object.keys(CURRENCY_DECIMALS);

/**
 * 汇率指标维护页。
 *
 * 汇率的唯一作用是「把外币折算到基准币种」，因此这里只做三件事：
 * 查看全部币种对、补录新日期、修正录错的数值。删除会同时影响历史折算，
 * 必须二次确认。
 */
export default function ExchangeRatesPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    baseCurrency: 'USD',
    quoteCurrency: 'CNY',
    rate: '',
    rateDate: new Date().toISOString().slice(0, 10),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['exchange-rates', page, pageSize],
    queryFn: () => exchangeRatesApi.list({ page, pageSize }),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    // 汇率变动会影响净资产、现金流、分析与数据质量的全部统计
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    void queryClient.invalidateQueries({ queryKey: ['quality'] });
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
    void queryClient.invalidateQueries({ queryKey: ['liabilities'] });
    void queryClient.invalidateQueries({ queryKey: ['portfolio'] });
  }

  const saveRate = useMutation({
    mutationFn: (body: { baseCurrency: string; quoteCurrency: string; rate: string; rateDate: string }) =>
      exchangeRatesApi.create(body),
    onSuccess: () => {
      setDraft({ ...draft, rate: '' });
      setEditingId(null);
      setEditingRate('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const removeRate = useMutation({
    mutationFn: (id: string) => exchangeRatesApi.remove(id),
    onSuccess: () => {
      if ((listQuery.data?.exchangeRates.length ?? 0) === 1 && page > 1) setPage(page - 1);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const rates = listQuery.data?.exchangeRates ?? [];
  const pagination = listQuery.data?.pagination ?? null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('exchange_rates.page.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {t('exchange_rates.page.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((prev) => !prev)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="size-4" aria-hidden />
          {t('exchange_rates.page.new')}
        </button>
      </header>

      {creating && (
        <div className="card grid gap-2 p-3 sm:grid-cols-6">
          <label className="text-xs text-[var(--color-content-muted)]">
            <span className="mb-1 block">{t('exchange_rates.base_currency')}</span>
            <select
              className="input"
              value={draft.baseCurrency}
              onChange={(event) => setDraft({ ...draft, baseCurrency: event.target.value })}
            >
              {CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--color-content-muted)]">
            <span className="mb-1 block">{t('exchange_rates.quote_currency')}</span>
            <select
              className="input"
              value={draft.quoteCurrency}
              onChange={(event) => setDraft({ ...draft, quoteCurrency: event.target.value })}
            >
              {CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--color-content-muted)]">
            <span className="mb-1 block">{t('exchange_rates.rate')}</span>
            <input
              className="input font-mono"
              inputMode="decimal"
              value={draft.rate}
              onChange={(event) => setDraft({ ...draft, rate: event.target.value })}
            />
          </label>
          <label className="text-xs text-[var(--color-content-muted)]">
            <span className="mb-1 block">{t('exchange_rates.effective_date')}</span>
            <input
              type="date"
              className="input"
              value={draft.rateDate}
              onChange={(event) => setDraft({ ...draft, rateDate: event.target.value })}
            />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={!draft.rate.trim() || saveRate.isPending}
              onClick={() =>
                saveRate.mutate({
                  baseCurrency: draft.baseCurrency,
                  quoteCurrency: draft.quoteCurrency,
                  rate: draft.rate.trim(),
                  rateDate: draft.rateDate,
                })
              }
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('exchange_rates.page.save')}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('exchange_rates.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      {listQuery.isLoading && <LoadingState />}
      {listQuery.isError && <ErrorState onRetry={() => void listQuery.refetch()} />}

      {listQuery.data && rates.length === 0 && (
        <EmptyState
          title={t('exchange_rates.page.empty_title')}
          description={t('exchange_rates.page.empty_description')}
        />
      )}

      {rates.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
              <tr>
                <th className="px-3 py-2">{t('exchange_rates.page.pair')}</th>
                <th className="px-3 py-2">{t('exchange_rates.rate')}</th>
                <th className="px-3 py-2">{t('exchange_rates.effective_date')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {rates.map((row: ExchangeRateRecord) => {
                const editing = editingId === row.id;
                return (
                  <tr key={row.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-3 py-2">
                      1 {row.baseCurrency} → {row.quoteCurrency}
                    </td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <input
                          autoFocus
                          className="input w-32 py-1 font-mono"
                          inputMode="decimal"
                          value={editingRate}
                          onChange={(event) => setEditingRate(event.target.value)}
                          aria-label={t('exchange_rates.rate')}
                        />
                      ) : (
                        <span className="font-mono tabular-nums">{Number(row.rate).toFixed(6)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
                      {formatDate(row.rateDate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            disabled={!editingRate.trim() || saveRate.isPending}
                            onClick={() =>
                              // 同一币种对同一天为唯一的键，改值即覆盖
                              saveRate.mutate({
                                baseCurrency: row.baseCurrency,
                                quoteCurrency: row.quoteCurrency,
                                rate: editingRate.trim(),
                                rateDate: row.rateDate.slice(0, 10),
                              })
                            }
                            className="text-[var(--color-accent)] disabled:opacity-50"
                          >
                            {t('exchange_rates.save')}
                          </button>
                          <button
                            type="button"
                            className="ml-2"
                            onClick={() => {
                              setEditingId(null);
                              setEditingRate('');
                            }}
                          >
                            {t('exchange_rates.cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="hover:text-[var(--color-accent)]"
                            onClick={() => {
                              setEditingId(row.id);
                              setEditingRate(Number(row.rate).toString());
                            }}
                          >
                            {t('exchange_rates.edit')}
                          </button>
                          <button
                            type="button"
                            className="ml-2 hover:text-[var(--color-negative)]"
                            onClick={() => {
                              if (window.confirm(t('exchange_rates.page.delete_confirm'))) {
                                removeRate.mutate(row.id);
                              }
                            }}
                          >
                            {t('exchange_rates.delete')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={[10, 20, 50]}
        />
      )}
    </div>
  );
}
