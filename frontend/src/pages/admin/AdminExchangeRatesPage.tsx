import RateHistoryDialog from '@/components/admin/RateHistoryDialog';
import RateStats from '@/components/admin/RateStats';
import RateSyncBar from '@/components/admin/RateSyncBar';
import RateSyncDrawer from '@/components/admin/RateSyncDrawer';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Pagination from '@/components/ui/Pagination';
import {
  adminApi,
  type AdminExchangeRate,
  type AdminLatestExchangeRate,
  type RateSyncFrequency,
} from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { formatDate, formatDateTime, formatRate, trimTrailingZeros } from '@/lib/format';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LineChart, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 20;
const CODES = Object.keys(CURRENCY_DECIMALS);

type View = 'latest' | 'records';

/**
 * 后台汇率管理。
 *
 * 汇率是全局系统参考数据，这里的每一次改动都会改变所有用户的折算结果，
 * 因此删除需要二次确认，且操作全部进后台审计。
 *
 * 两个视图：「当前汇率」每个币种对一行，回答「现在生效的是多少」；
 * 「同步记录」保留按日期的流水，用于查某天的明细。
 */
export default function AdminExchangeRatesPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();

  const [view, setView] = useState<View>('latest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [filter, setFilter] = useState({ base: '', quote: '', source: '', from: '', to: '', q: '' });
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    baseCurrency: 'USD',
    quoteCurrency: 'CNY',
    rate: '',
    rateDate: new Date().toISOString().slice(0, 10),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState('');
  const [historyPair, setHistoryPair] = useState<{ from: string; to: string } | null>(null);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestQuery = useQuery({
    queryKey: ['admin', 'exchange-rates-latest', page, pageSize, filter],
    queryFn: () =>
      adminApi.latestExchangeRates({
        page,
        pageSize,
        base: filter.base,
        quote: filter.quote,
        source: filter.source,
        q: filter.q,
      }),
    enabled: view === 'latest',
  });

  const listQuery = useQuery({
    queryKey: ['admin', 'exchange-rates', page, pageSize, filter],
    queryFn: () =>
      adminApi.exchangeRates({
        page,
        pageSize,
        base: filter.base,
        quote: filter.quote,
        source: filter.source,
        from: filter.from,
        to: filter.to,
      }),
    enabled: view === 'records',
  });

  const providerQuery = useQuery({
    queryKey: ['admin', 'rate-provider'],
    queryFn: () => adminApi.rateProviderStatus(),
  });

  const syncSettingsQuery = useQuery({
    queryKey: ['admin', 'rate-sync-settings'],
    queryFn: () => adminApi.rateSyncSettings(),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'exchange-rates'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'exchange-rates-latest'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'rate-provider'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'exchange-rate-history'] });
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
      setNotice(null);
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
      setNotice(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteExchangeRate(id),
    onSuccess: () => {
      setDeleteTarget(null);
      setError(null);
      setNotice(null);
      invalidate();
    },
    onError: (err) => {
      setDeleteTarget(null);
      setError(translateError(err, t));
    },
  });

  const saveSyncSettings = useMutation({
    mutationFn: (input: { enabled: boolean; frequency: RateSyncFrequency }) =>
      adminApi.updateRateSyncSettings(input),
    onSuccess: (next) => {
      queryClient.setQueryData(['admin', 'rate-sync-settings'], next);
      // 频率变更后调度器已按新间隔重排，下次运行时间必须重新取
      void queryClient.invalidateQueries({ queryKey: ['admin', 'rate-provider'] });
      setSyncDrawerOpen(false);
      setError(null);
      setNotice(t('exchangeRates.syncDrawer.saved'));
    },
    onError: (err) => {
      setNotice(null);
      setError(translateError(err, t));
    },
  });

  const syncNow = useMutation({
    mutationFn: () => adminApi.refreshRates(),
    onSuccess: (summary) => {
      setError(null);
      setNotice(
        t('exchangeRates.syncDrawer.last_result', {
          written: summary.writtenRows,
          skipped: summary.skippedManual,
        }),
      );
      invalidate();
    },
    onError: (err) => {
      setNotice(null);
      // 同步进行中不是错误状态，单独给一句提示更准确
      setError(
        err instanceof ApiError && err.code === 'RATE_SYNC_IN_PROGRESS'
          ? t('exchangeRates.sync.busy')
          : translateError(err, t),
      );
    },
  });

  const latestRows: AdminLatestExchangeRate[] =
    latestQuery.data?.data.exchangeRates ?? [];
  const recordRows: AdminExchangeRate[] = listQuery.data?.data.exchangeRates ?? [];
  const stats = latestQuery.data?.data.stats ?? null;
  const pagination =
    view === 'latest'
      ? latestQuery.data?.pagination ?? null
      : listQuery.data?.pagination ?? null;
  const provider = providerQuery.data ?? null;
  const syncFailures = provider?.lastRun?.failures ?? [];

  // 切换视图/筛选后页码可能越界，交给 Pagination 之前先收敛一次
  const activeLoading = view === 'latest' ? latestQuery.isLoading : listQuery.isLoading;
  const activeError = view === 'latest' ? latestQuery.isError : listQuery.isError;

  function updateFilter(patch: Partial<typeof filter>) {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  const viewTab = (value: View, key: string) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setView(value);
        setPage(1);
      }}
      className={`rounded-lg px-3 py-1.5 text-sm ${
        view === value
          ? 'bg-[var(--color-accent)] text-white'
          : 'border border-[var(--color-border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'
      }`}
    >
      {t(key)}
    </button>
  );

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

      <RateStats stats={stats} provider={provider} />

      <RateSyncBar
        settings={syncSettingsQuery.data ?? null}
        provider={provider}
        syncing={syncNow.isPending}
        onOpenSettings={() => setSyncDrawerOpen(true)}
        onSync={() => syncNow.mutate()}
      />

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
              disabled={!draft.rate.trim() || save.isPending || draft.baseCurrency === draft.quoteCurrency}
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

      {notice && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {viewTab('latest', 'exchangeRates.tab.latest')}
        {viewTab('records', 'exchangeRates.tab.records')}
      </div>

      {/* 筛选 */}
      <div className="card grid gap-2 p-3 sm:grid-cols-5">
        <select
          className="input"
          value={filter.base}
          onChange={(event) => updateFilter({ base: event.target.value })}
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
          onChange={(event) => updateFilter({ quote: event.target.value })}
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
          onChange={(event) => updateFilter({ source: event.target.value })}
          aria-label={t('exchangeRates.filter_source')}
        >
          <option value="">{t('exchangeRates.filter_source')}</option>
          <option value="manual">{t('exchangeRates.source_manual')}</option>
          <option value="provider">{t('exchangeRates.source_provider')}</option>
        </select>
        {view === 'latest' ? (
          <input
            className="input sm:col-span-2"
            value={filter.q}
            placeholder={t('exchangeRates.search_placeholder')}
            onChange={(event) => updateFilter({ q: event.target.value })}
            aria-label={t('exchangeRates.search_placeholder')}
          />
        ) : (
          <>
            <input
              type="date"
              className="input"
              value={filter.from}
              onChange={(event) => updateFilter({ from: event.target.value })}
              aria-label={t('exchangeRates.filter_from')}
            />
            <input
              type="date"
              className="input"
              value={filter.to}
              onChange={(event) => updateFilter({ to: event.target.value })}
              aria-label={t('exchangeRates.filter_to')}
            />
          </>
        )}
      </div>

      {activeLoading && <LoadingState />}
      {activeError && (
        <ErrorState
          onRetry={() =>
            void (view === 'latest' ? latestQuery.refetch() : listQuery.refetch())
          }
        />
      )}

      {/* 当前汇率：每个币种对一行 */}
      {view === 'latest' && latestQuery.data && latestRows.length === 0 && (
        <EmptyState
          title={t('exchangeRates.empty_title')}
          description={t('exchangeRates.empty_description')}
        />
      )}

      {view === 'latest' && latestRows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
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
              {latestRows.map((row) => {
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
                            className="ml-2 hover:text-[var(--color-accent)]"
                            aria-label={t('exchangeRates.history.open')}
                            onClick={() =>
                              setHistoryPair({ from: row.baseCurrency, to: row.quoteCurrency })
                            }
                          >
                            <LineChart className="inline size-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={t('exchangeRates.delete')}
                            className="ml-2 text-[var(--color-negative)]"
                            onClick={() =>
                              setDeleteTarget({
                                id: row.id,
                                label: `${row.baseCurrency}→${row.quoteCurrency} (${row.rateDate})`,
                              })
                            }
                          >
                            <Trash2 className="inline size-3.5" aria-hidden />
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

      {/* 同步记录：按日期的流水 */}
      {view === 'records' && listQuery.data && recordRows.length === 0 && (
        <EmptyState
          title={t('exchangeRates.empty_title')}
          description={t('exchangeRates.empty_description')}
        />
      )}

      {view === 'records' && recordRows.length > 0 && (
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
              {recordRows.map((row) => {
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
                            onClick={() =>
                              setDeleteTarget({
                                id: row.id,
                                label: `${row.baseCurrency}→${row.quoteCurrency} (${row.rateDate})`,
                              })
                            }
                          >
                            <Trash2 className="inline size-3.5" aria-hidden />
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

      {pagination && pagination.total > 0 && (
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

      <section className="card space-y-3 p-3">
        <div>
          <h2 className="text-sm font-medium">
            {t('exchangeRates.sync_title')}
            {syncFailures.length > 0 && (
              <span className="ml-2 rounded-full bg-[var(--color-negative)] px-2 py-0.5 text-xs text-white">
                {syncFailures.length}
              </span>
            )}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-content-muted)]">
            {t('exchangeRates.sync_hint')}
          </p>
        </div>

        {providerQuery.isLoading && <LoadingState />}

        {provider && syncFailures.length === 0 && (
          <p className="text-sm text-[var(--color-content-muted)]">{t('exchangeRates.sync_empty')}</p>
        )}

        {syncFailures.length > 0 && (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {syncFailures.map((failure) => {
              const [from, to] = failure.pair.split('->');
              return (
                <li key={failure.pair} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-mono">1 {from} → {to}</span>
                  <span className="text-xs text-[var(--color-content-muted)]">{failure.code}</span>
                  <span className="min-w-0 flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(true);
                      setDraft({
                        baseCurrency: from ?? 'USD',
                        quoteCurrency: to ?? 'CNY',
                        rate: '',
                        rateDate: new Date().toISOString().slice(0, 10),
                      });
                    }}
                    className="rounded border border-[var(--color-border-subtle)] px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    {t('exchangeRates.sync_fill')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <RateHistoryDialog pair={historyPair} onClose={() => setHistoryPair(null)} />

      <RateSyncDrawer
        open={syncDrawerOpen}
        settings={syncSettingsQuery.data ?? null}
        provider={provider}
        saving={saveSyncSettings.isPending}
        onClose={() => setSyncDrawerOpen(false)}
        onSave={(next) => saveSyncSettings.mutate(next)}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-sm space-y-4 p-4">
            <div>
              <p className="text-sm font-semibold">{t('exchangeRates.delete')}</p>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                {t('exchangeRates.delete_confirm')}
              </p>
              <p className="mt-2 font-mono text-xs">{deleteTarget.label}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
              >
                {t('exchangeRates.cancel')}
              </button>
              <button
                type="button"
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleteTarget.id)}
                className="rounded-lg bg-[var(--color-negative)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {t('exchangeRates.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
