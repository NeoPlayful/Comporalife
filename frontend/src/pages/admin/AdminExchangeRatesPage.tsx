import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import { adminApi, type AdminExchangeRate, type AdminRatePairRequest } from '@/lib/admin';
import { translateError } from '@/lib/error-message';
import { formatDate, formatDateTime, formatRate, trimTrailingZeros } from '@/lib/format';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 20;
const CODES = Object.keys(CURRENCY_DECIMALS);

/**
 * 后台汇率管理。
 *
 * 汇率是全局系统参考数据，这里的每一次改动都会改变所有用户的折算结果，
 * 因此删除需要二次确认，且操作全部进后台审计。
 */
export default function AdminExchangeRatesPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [filter, setFilter] = useState({ base: '', quote: '', source: '', from: '', to: '' });
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
    queryKey: ['admin', 'exchange-rates', page, pageSize, filter],
    queryFn: () => adminApi.exchangeRates({ page, pageSize, ...filter }),
  });

  const requestsQuery = useQuery({
    queryKey: ['admin', 'rate-pair-requests', 'pending'],
    queryFn: () => adminApi.ratePairRequests({ status: 'pending', pageSize: 20 }),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'exchange-rates'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'rate-pair-requests'] });
    // 汇率变化影响所有用户的统计，本地缓存必须一起失效
    void queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    void queryClient.invalidateQueries({ queryKey: ['quality'] });
  }

  const save = useMutation({
    mutationFn: (body: {
      baseCurrency: string;
      quoteCurrency: string;
      rate: string;
      rateDate: string;
    }) => adminApi.createExchangeRate(body),
    onSuccess: () => {
      setDraft({ ...draft, rate: '' });
      setEditingId(null);
      setEditingRate('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const update = useMutation({
    mutationFn: (input: { id: string; rate: string }) =>
      adminApi.updateExchangeRate(input.id, input.rate),
    onSuccess: () => {
      setEditingId(null);
      setEditingRate('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteExchangeRate(id),
    onSuccess: () => {
      if ((listQuery.data?.data.exchangeRates.length ?? 0) === 1 && page > 1) setPage(page - 1);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const review = useMutation({
    mutationFn: (input: { id: string; status: 'approved' | 'rejected' }) =>
      adminApi.reviewRatePairRequest(input.id, { status: input.status }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const rows: AdminExchangeRate[] = listQuery.data?.data.exchangeRates ?? [];
  const pagination = listQuery.data?.pagination ?? null;
  const pending: AdminRatePairRequest[] = requestsQuery.data?.data.requests ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('exchangeRates.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {t('exchangeRates.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((prev) => !prev)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="size-4" aria-hidden />
          {t('exchangeRates.new')}
        </button>
      </header>

      {creating && (
        <div className="card grid gap-2 p-3 sm:grid-cols-6">
          <label className="text-xs text-[var(--color-content-muted)]">
            <span className="mb-1 block">{t('exchangeRates.base_currency')}</span>
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
            <span className="mb-1 block">{t('exchangeRates.quote_currency')}</span>
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
            <span className="mb-1 block">{t('exchangeRates.rate')}</span>
            <input
              className="input font-mono"
              inputMode="decimal"
              value={draft.rate}
              onChange={(event) => setDraft({ ...draft, rate: event.target.value })}
            />
          </label>
          <label className="text-xs text-[var(--color-content-muted)]">
            <span className="mb-1 block">{t('exchangeRates.rate_date')}</span>
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
              disabled={!draft.rate.trim() || save.isPending}
              onClick={() =>
                save.mutate({
                  baseCurrency: draft.baseCurrency,
                  quoteCurrency: draft.quoteCurrency,
                  rate: draft.rate.trim(),
                  rateDate: draft.rateDate,
                })
              }
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('exchangeRates.save')}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('exchangeRates.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      {/* 筛选 */}
      <div className="card grid gap-2 p-3 sm:grid-cols-5">
        <select
          className="input"
          value={filter.base}
          onChange={(event) => {
            setFilter({ ...filter, base: event.target.value });
            setPage(1);
          }}
          aria-label={t('exchangeRates.filter_base')}
        >
          <option value="">{t('exchangeRates.filter_base')}</option>
          {CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={filter.quote}
          onChange={(event) => {
            setFilter({ ...filter, quote: event.target.value });
            setPage(1);
          }}
          aria-label={t('exchangeRates.filter_quote')}
        >
          <option value="">{t('exchangeRates.filter_quote')}</option>
          {CODES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={filter.source}
          onChange={(event) => {
            setFilter({ ...filter, source: event.target.value });
            setPage(1);
          }}
          aria-label={t('exchangeRates.filter_source')}
        >
          <option value="">{t('exchangeRates.filter_source')}</option>
          <option value="manual">{t('exchangeRates.source_manual')}</option>
          <option value="provider">{t('exchangeRates.source_provider')}</option>
        </select>
        <input
          type="date"
          className="input"
          value={filter.from}
          onChange={(event) => {
            setFilter({ ...filter, from: event.target.value });
            setPage(1);
          }}
          aria-label={t('exchangeRates.filter_from')}
        />
        <input
          type="date"
          className="input"
          value={filter.to}
          onChange={(event) => {
            setFilter({ ...filter, to: event.target.value });
            setPage(1);
          }}
          aria-label={t('exchangeRates.filter_to')}
        />
      </div>

      {listQuery.isLoading && <LoadingState />}

      {listQuery.data && rows.length === 0 && (
        <EmptyState
          title={t('exchangeRates.empty_title')}
          description={t('exchangeRates.empty_description')}
        />
      )}

      {rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
              <tr>
                <th className="px-3 py-2">{t('exchangeRates.pair')}</th>
                <th className="px-3 py-2">{t('exchangeRates.rate')}</th>
                <th className="px-3 py-2">{t('exchangeRates.rate_date')}</th>
                <th className="px-3 py-2">{t('exchangeRates.source')}</th>
                <th className="px-3 py-2">{t('exchangeRates.updated_at')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {rows.map((row) => {
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
                          className="input w-36 py-1 font-mono"
                          inputMode="decimal"
                          value={editingRate}
                          onChange={(event) => setEditingRate(event.target.value)}
                          aria-label={t('exchangeRates.rate')}
                        />
                      ) : (
                        <span className="font-mono tabular-nums">{formatRate(row.rate)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
                      {formatDate(row.rateDate)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {row.source === 'provider'
                        ? t('exchangeRates.source_provider')
                        : t('exchangeRates.source_manual')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--color-content-muted)]">
                      {formatDateTime(row.updatedAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            disabled={!editingRate.trim() || update.isPending}
                            onClick={() => update.mutate({ id: row.id, rate: editingRate.trim() })}
                            className="text-[var(--color-accent)] disabled:opacity-50"
                          >
                            {t('exchangeRates.save')}
                          </button>
                          <button
                            type="button"
                            className="ml-2"
                            onClick={() => {
                              setEditingId(null);
                              setEditingRate('');
                            }}
                          >
                            {t('exchangeRates.cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="hover:text-[var(--color-accent)]"
                            onClick={() => {
                              setEditingId(row.id);
                              setEditingRate(trimTrailingZeros(row.rate));
                            }}
                          >
                            {t('exchangeRates.edit')}
                          </button>
                          <button
                            type="button"
                            aria-label={t('exchangeRates.delete')}
                            className="ml-2 text-[var(--color-negative)]"
                            onClick={() => {
                              if (window.confirm(t('exchangeRates.delete_confirm'))) {
                                remove.mutate(row.id);
                              }
                            }}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
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
          pageSizeOptions={[20, 50, 100]}
        />
      )}

      <section className="card space-y-3">
        <div>
          <h2 className="text-sm font-medium">
            {t('exchangeRates.requests_title')}
            {pending.length > 0 && (
              <span className="ml-2 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-xs text-white">
                {pending.length}
              </span>
            )}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            {t('exchangeRates.requests_hint')}
          </p>
        </div>

        {requestsQuery.isLoading && <LoadingState />}

        {requestsQuery.data && pending.length === 0 && (
          <p className="text-sm text-[var(--color-content-muted)]">
            {t('exchangeRates.requests_empty')}
          </p>
        )}

        {pending.length > 0 && (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {pending.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-mono">
                  1 {item.baseCurrency} → {item.quoteCurrency}
                </span>
                <span className="text-xs text-[var(--color-content-muted)]">
                  {item.user.nickname} · {formatDate(item.createdAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-content-muted)]">
                  {item.reason ?? ''}
                </span>
                <button
                  type="button"
                  onClick={() => review.mutate({ id: item.id, status: 'approved' })}
                  className="rounded border border-[var(--color-border-subtle)] px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {t('exchangeRates.approve')}
                </button>
                <button
                  type="button"
                  onClick={() => review.mutate({ id: item.id, status: 'rejected' })}
                  className="rounded border border-[var(--color-border-subtle)] px-2 py-1 text-xs text-[var(--color-negative)]"
                >
                  {t('exchangeRates.reject')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
