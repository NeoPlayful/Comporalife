import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { authApi, type Preferences } from '@/lib/auth';
import { exchangeRatesApi, type ExchangeRateRecord, type RatePairRequestRecord } from '@/lib/dashboard';
import { translateError } from '@/lib/error-message';
import { formatDate, formatRate } from '@/lib/format';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 20;
const CODES = Object.keys(CURRENCY_DECIMALS);

/**
 * 汇率指标（只读）。
 *
 * 汇率是全局共享的系统参考数据，由后台统一维护，用户不能新增或修改。
 * 这里只做三件事：查看、选择想看的币种对、对缺失的币种对提交申请。
 *
 * 展示偏好只影响这张表显示什么，不影响任何折算结果——折算需要哪些币种
 * 由账户、资产、负债的实际币种自动决定。
 */
export default function ExchangeRatesPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [requesting, setRequesting] = useState(false);
  const [draft, setDraft] = useState({ baseCurrency: 'EUR', quoteCurrency: 'CNY', reason: '' });
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['exchange-rates', page, pageSize],
    queryFn: () => exchangeRatesApi.list({ page, pageSize }),
  });

  const requestsQuery = useQuery({
    queryKey: ['exchange-rates', 'pair-requests'],
    queryFn: () => exchangeRatesApi.pairRequests(),
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => authApi.preferences(),
  });

  const preferences: Preferences | null = settingsQuery.data?.preferences ?? null;
  const displayPairs = preferences?.rateDisplayPairs ?? null;

  // 用户没设置过就是「展示全部」，而不是「什么都不展示」
  const visibleRows = useMemo(() => {
    const rows = listQuery.data?.exchangeRates ?? [];
    if (!displayPairs || displayPairs.length === 0) return rows;
    const allowed = new Set(displayPairs);
    return rows.filter((row) => allowed.has(`${row.baseCurrency}->${row.quoteCurrency}`));
  }, [listQuery.data, displayPairs]);

  const savePreference = useMutation({
    mutationFn: (pairs: string[] | null) => authApi.updatePreferences({ rateDisplayPairs: pairs }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const createRequest = useMutation({
    mutationFn: () =>
      exchangeRatesApi.createPairRequest({
        baseCurrency: draft.baseCurrency,
        quoteCurrency: draft.quoteCurrency,
        ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
      }),
    onSuccess: () => {
      setRequesting(false);
      setDraft({ baseCurrency: 'EUR', quoteCurrency: 'CNY', reason: '' });
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['exchange-rates', 'pair-requests'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const removeRequest = useMutation({
    mutationFn: (id: string) => exchangeRatesApi.removePairRequest(id),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['exchange-rates', 'pair-requests'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const requests: RatePairRequestRecord[] = requestsQuery.data?.requests ?? [];
  const pagination = listQuery.data?.pagination ?? null;

  useEffect(() => {
    // 筛选后当前页可能超出范围，回退到最后一页而不是停在空白页
    if (pagination && pagination.totalPages > 0 && page > pagination.totalPages) {
      setPage(pagination.totalPages);
    }
  }, [pagination, page]);

  function togglePair(pair: string) {
    const current = displayPairs ?? [];
    const next = current.includes(pair)
      ? current.filter((item) => item !== pair)
      : [...current, pair];
    // 取消全部等于「展示全部」，因此全不选时存 null
    savePreference.mutate(next.length === 0 ? null : next);
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('exchange_rates.page.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {t('exchange_rates.page.readonly_hint')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRequesting((prev) => !prev)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
        >
          <Plus className="size-4" aria-hidden />
          {t('exchange_rates.page.request_new')}
        </button>
      </header>

      {requesting && (
        <div className="card grid gap-2 p-3 sm:grid-cols-4">
          <select
            className="input"
            value={draft.baseCurrency}
            onChange={(event) => setDraft({ ...draft, baseCurrency: event.target.value })}
            aria-label={t('exchange_rates.base_currency')}
          >
            {CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={draft.quoteCurrency}
            onChange={(event) => setDraft({ ...draft, quoteCurrency: event.target.value })}
            aria-label={t('exchange_rates.quote_currency')}
          >
            {CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder={t('exchange_rates.page.request_reason')}
            value={draft.reason}
            onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={draft.baseCurrency === draft.quoteCurrency || createRequest.isPending}
              onClick={() => createRequest.mutate()}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('exchange_rates.page.submit_request')}
            </button>
            <button
              type="button"
              onClick={() => setRequesting(false)}
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

      {listQuery.data && visibleRows.length === 0 && (
        <EmptyState
          title={t('exchange_rates.page.empty_title')}
          description={
            listQuery.data.exchangeRates.length === 0
              ? t('exchange_rates.page.empty_description')
              : t('exchange_rates.page.filter_empty')
          }
        />
      )}

      {visibleRows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
              <tr>
                <th className="px-3 py-2">{t('exchange_rates.page.pair')}</th>
                <th className="px-3 py-2">{t('exchange_rates.rate')}</th>
                <th className="px-3 py-2">{t('exchange_rates.effective_date')}</th>
                <th className="px-3 py-2">{t('exchange_rates.page.source')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {visibleRows.map((row: ExchangeRateRecord) => {
                const pair = `${row.baseCurrency}->${row.quoteCurrency}`;
                return (
                  <tr key={row.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                    <td className="whitespace-nowrap px-3 py-2">
                      1 {row.baseCurrency} → {row.quoteCurrency}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatRate(row.rate)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
                      {formatDate(row.rateDate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {row.source === 'provider'
                        ? t('exchange_rates.page.source_provider')
                        : t('exchange_rates.page.source_manual')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                      <button
                        type="button"
                        onClick={() => togglePair(pair)}
                        disabled={savePreference.isPending}
                        className="text-[var(--color-content-muted)] hover:text-[var(--color-negative)] disabled:opacity-50"
                        aria-label={t('exchange_rates.page.hide_pair')}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
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
          pageSizeOptions={[20, 50, 100]}
        />
      )}

      {displayPairs !== null && displayPairs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-content-muted)]">
          <span>{t('exchange_rates.page.filtered_hint', { count: displayPairs.length })}</span>
          <button
            type="button"
            onClick={() => savePreference.mutate(null)}
            className="text-[var(--color-accent)] underline"
          >
            {t('exchange_rates.page.show_all')}
          </button>
        </div>
      )}

      <section className="card space-y-3">
        <div>
          <h2 className="text-sm font-medium">{t('exchange_rates.page.requests_title')}</h2>
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            {t('exchange_rates.page.requests_hint')}
          </p>
        </div>

        {requestsQuery.isLoading && <LoadingState />}

        {requestsQuery.data && requests.length === 0 && (
          <p className="text-sm text-[var(--color-content-muted)]">
            {t('exchange_rates.page.requests_empty')}
          </p>
        )}

        {requests.length > 0 && (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {requests.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-mono">
                  1 {item.baseCurrency} → {item.quoteCurrency}
                </span>
                <span className="text-xs text-[var(--color-content-muted)]">
                  {t(`exchange_rates.page.request_status.${item.status}`)} ·{' '}
                  {formatDate(item.createdAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-content-muted)]">
                  {item.reviewNote ?? item.reason ?? ''}
                </span>
                {item.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => removeRequest.mutate(item.id)}
                    className="text-xs text-[var(--color-negative)]"
                  >
                    {t('exchange_rates.page.cancel_request')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
