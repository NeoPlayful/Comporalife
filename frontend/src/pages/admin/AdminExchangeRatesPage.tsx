import RateBulkDrawer, { type BulkDraft } from '@/components/admin/RateBulkDrawer';
import RateCreateDialog from '@/components/admin/RateCreateDialog';
import RateEditDialog from '@/components/admin/RateEditDialog';
import RateHistoryDialog from '@/components/admin/RateHistoryDialog';
import RateStats from '@/components/admin/RateStats';
import RateSyncBar from '@/components/admin/RateSyncBar';
import RateSyncDrawer, { type SyncDrawerSave } from '@/components/admin/RateSyncDrawer';
import RateTable from '@/components/admin/RateTable';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import Pagination from '@/components/ui/Pagination';
import { adminApi, type AdminLatestExchangeRate } from '@/lib/admin';
import { ApiError } from '@/lib/client';
import { translateError } from '@/lib/error-message';
import { currencyName } from '@/lib/format';
import { sortedCurrencyCodes } from '@/components/finance/CurrencyFlag';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Settings2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const CODES = sortedCurrencyCodes();
const SEARCH_DEBOUNCE_MS = 300;

type RateRow = AdminLatestExchangeRate;

/** 筛选条件下拉即刻生效，只有搜索框走防抖 */
type Filter = {
  base: string;
  quote: string;
  source: string;
};

/**
 * 后台汇率管理。
 *
 * 汇率是全局系统参考数据，这里的每一次改动都会改变所有用户的折算结果，
 * 因此删除需要二次确认，且操作全部进后台审计。
 *
 * 页面骨架：头部三个动作 → 统计卡 → 一行工具栏（搜索/筛选/批量）→ 表格。
 * 同步状态压在头部第二行而不是单独一张卡：它是一句状态，不是内容。
 *
 * 表格每个币种对一行，回答「现在生效的是多少」；按日期的流水仍保留在后端
 * 接口里，只是页面不再提供入口，日常排查走单对走势图。
 */
export default function AdminExchangeRatesPage() {
  const { t } = useTranslation('admin');
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filter, setFilter] = useState<Filter>({ base: '', quote: '', source: '' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [creating, setCreating] = useState(false);
  // 弹窗打开时预填的币种对：同步失败项的「补录」会把失败的那一对带进来
  const [createSeed, setCreateSeed] = useState({ baseCurrency: 'USD', quoteCurrency: 'CNY' });

  const [editingRow, setEditingRow] = useState<RateRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyPair, setHistoryPair] = useState<{ from: string; to: string } | null>(null);
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<RateRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 搜索框每击键都换 queryKey 会让整张表被加载态顶掉，等停顿后再发请求
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const latestQuery = useQuery({
    queryKey: ['admin', 'exchange-rates-latest', page, pageSize, filter, search],
    queryFn: () =>
      adminApi.latestExchangeRates({
        page,
        pageSize,
        base: filter.base,
        quote: filter.quote,
        source: filter.source,
        q: search,
      }),
    // 换页或改筛选时保留上一份结果，避免表格闪成空白
    placeholderData: (previous) => previous,
  });

  const providerQuery = useQuery({
    queryKey: ['admin', 'rate-provider'],
    queryFn: () => adminApi.rateProviderStatus(),
  });

  const syncSettingsQuery = useQuery({
    queryKey: ['admin', 'rate-sync-settings'],
    queryFn: () => adminApi.rateSyncSettings(),
  });

  const providerConfigQuery = useQuery({
    queryKey: ['admin', 'rate-provider-config'],
    queryFn: () => adminApi.rateProvider(),
  });

  // 数据源写操作只对超管开放，前端隐藏入口只能算体验，真正的边界在服务端
  const settingsOverviewQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => adminApi.settingsOverview(),
  });
  const canEditProvider = settingsOverviewQuery.data?.capabilities.canManageAdmins ?? false;

  // 保持引用稳定：下面的选中集合与批量草稿都依赖它，每次渲染换新数组会让它们白算
  const rows: RateRow[] = useMemo(
    () => latestQuery.data?.data.exchangeRates ?? [],
    [latestQuery.data],
  );
  const stats = latestQuery.data?.data.stats ?? null;
  const pagination = latestQuery.data?.pagination ?? null;
  const provider = providerQuery.data ?? null;
  const staleDays = stats?.staleDays ?? 7;
  const staleFailures = provider?.lastRun?.failures ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'exchange-rates-latest'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'rate-provider'] });
    // 手动同步成功会顺带把开关重新打开，不同步刷新这里，抽屉就会拿着旧值把开关写回关闭
    void queryClient.invalidateQueries({ queryKey: ['admin', 'rate-sync-settings'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'exchange-rate-history'] });
    // 汇率变化影响所有用户的统计，本地缓存必须一起失效
    void queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    void queryClient.invalidateQueries({ queryKey: ['quality'] });
  }

  function resetSelection() {
    setSelected(new Set());
  }

  function updateFilter(patch: Partial<Filter>) {
    setFilter((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }

  const save = useMutation({
    mutationFn: (body: {
      baseCurrency: string;
      quoteCurrency: string;
      rate: string;
      rateDate: string;
    }) => adminApi.createExchangeRate(body),
    onSuccess: (result) => {
      setCreating(false);
      setError(null);
      setNotice(
        result.replaced
          ? t('exchangeRates.notice.created_replaced')
          : t('exchangeRates.notice.created'),
      );
      invalidate();
    },
    onError: (err) => {
      setNotice(null);
      setError(translateError(err, t));
    },
  });

  const update = useMutation({
    mutationFn: (input: { id: string; rate: string; source: 'manual' | 'provider' }) =>
      adminApi.updateExchangeRate(input.id, { rate: input.rate, source: input.source }),
    onSuccess: () => {
      setEditingRow(null);
      setError(null);
      setNotice(t('exchangeRates.notice.updated'));
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const bulk = useMutation({
    mutationFn: (body: {
      rateDate: string;
      rates: Array<{ baseCurrency: string; quoteCurrency: string; rate: string }>;
    }) => adminApi.bulkCreateExchangeRates(body),
    onSuccess: (result) => {
      setBulkOpen(false);
      resetSelection();
      setError(null);
      setNotice(t('exchangeRates.notice.bulk_saved', { count: result.writtenRows }));
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const remove = useMutation({
    mutationFn: async (targets: RateRow[]) => {
      for (const target of targets) {
        await adminApi.deleteExchangeRate(target.id);
      }
      return targets.length;
    },
    onSuccess: (count) => {
      setDeleteTargets(null);
      resetSelection();
      setError(null);
      setNotice(t('exchangeRates.notice.deleted', { count }));
      invalidate();
    },
    onError: (err) => {
      setDeleteTargets(null);
      setError(translateError(err, t));
    },
  });

  const saveSyncSettings = useMutation({
    mutationFn: async (input: SyncDrawerSave) => {
      // 数据源只在真的改过时才写：每次都 PATCH 会把「密钥保持不变」也当成一次改动，
      // 超管之外的管理员只改频率时会因此被 403 挡住。
      // 例外是「从未配置」：表单显示的都是服务端默认值，逐字段比较必然相等，
      // 但这一行确实还不存在，必须写一次才能把默认数据源落到库里。
      const sourceChanged =
        providerConfigQuery.data?.source === 'none' ||
        (providerConfigQuery.data?.provider ?? null) !== input.provider ||
        (providerConfigQuery.data?.anchorCurrency ?? null) !== input.anchorCurrency ||
        (providerConfigQuery.data?.customUrl ?? '') !== input.customUrl ||
        (providerConfigQuery.data?.ratesPath || 'rates') !== (input.ratesPath || 'rates') ||
        (providerConfigQuery.data?.datePath ?? '') !== input.datePath ||
        input.apiKey !== undefined;

      if (sourceChanged) {
        await adminApi.updateRateProvider({
          provider: input.provider,
          anchorCurrency: input.anchorCurrency,
          ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
          customUrl: input.customUrl,
          ratesPath: input.ratesPath,
          datePath: input.datePath,
        });
      }

      const settingsChanged =
        (syncSettingsQuery.data?.enabled ?? null) !== input.enabled ||
        (syncSettingsQuery.data?.frequency ?? null) !== input.frequency;
      if (settingsChanged) {
        await adminApi.updateRateSyncSettings({
          enabled: input.enabled,
          frequency: input.frequency,
        });
      }

      return { sourceChanged, settingsChanged };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'rate-sync-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'rate-provider-config'] });
      // 数据源或频率变更后调度器已重排，下次运行时间与可用性必须重新取
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

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(checked ? [] : prev);
      if (checked) for (const row of rows) next.add(row.id);
      else for (const row of rows) next.delete(row.id);
      return next;
    });
  }

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  const bulkDrafts: BulkDraft[] = useMemo(
    () =>
      selectedRows.map((row) => ({
        baseCurrency: row.baseCurrency,
        quoteCurrency: row.quoteCurrency,
        currentRate: row.rate,
      })),
    [selectedRows],
  );

  const canDelete = deleteTargets !== null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t('exchangeRates.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {t('exchangeRates.subtitle')}
          </p>
          <div className="mt-2">
            <RateSyncBar settings={syncSettingsQuery.data ?? null} provider={provider} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSyncDrawerOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Settings2 className="size-4" aria-hidden />
            {t('exchangeRates.sync.open_settings')}
          </button>
          <button
            type="button"
            onClick={() => syncNow.mutate()}
            disabled={!provider?.configured || syncNow.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
          >
            <RefreshCw
              className={`size-4 ${syncNow.isPending ? 'animate-spin' : ''}`}
              aria-hidden
            />
            {syncNow.isPending ? t('exchangeRates.sync.syncing') : t('exchangeRates.sync.sync_now')}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateSeed({ baseCurrency: 'USD', quoteCurrency: 'CNY' });
              setCreating(true);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
          >
            <Plus className="size-4" aria-hidden />
            {t('exchangeRates.new')}
          </button>
        </div>
      </header>

      <RateStats stats={stats} provider={provider} />

      {notice && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t('exchangeRates.dismiss')}
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

      {/* 工具栏：搜索筛选 + 刷新，批量条选中后才出现 */}
      <section className="card space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input sm:max-w-xs"
            value={searchInput}
            placeholder={t('exchangeRates.search_placeholder')}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
            aria-label={t('exchangeRates.search_placeholder')}
          />

          <select
            className="input sm:w-auto"
            value={filter.base}
            onChange={(event) => updateFilter({ base: event.target.value })}
            aria-label={t('exchangeRates.filter_base')}
          >
            <option value="">{t('exchangeRates.filter_base')}</option>
            {CODES.map((code) => (
              <option key={code} value={code}>
                {code} · {currencyName(code)}
              </option>
            ))}
          </select>

          <select
            className="input sm:w-auto"
            value={filter.quote}
            onChange={(event) => updateFilter({ quote: event.target.value })}
            aria-label={t('exchangeRates.filter_quote')}
          >
            <option value="">{t('exchangeRates.filter_quote')}</option>
            {CODES.map((code) => (
              <option key={code} value={code}>
                {code} · {currencyName(code)}
              </option>
            ))}
          </select>

          <select
            className="input sm:w-auto"
            value={filter.source}
            onChange={(event) => updateFilter({ source: event.target.value })}
            aria-label={t('exchangeRates.filter_source')}
          >
            <option value="">{t('exchangeRates.filter_source')}</option>
            <option value="manual">{t('exchangeRates.source_manual')}</option>
            <option value="provider">{t('exchangeRates.source_provider')}</option>
          </select>

          <button
            type="button"
            onClick={() => void latestQuery.refetch()}
            aria-label={t('exchangeRates.refresh')}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            <RefreshCw
              className={`size-4 ${latestQuery.isFetching ? 'animate-spin' : ''}`}
              aria-hidden
            />
            <span className="hidden sm:inline">{t('exchangeRates.refresh')}</span>
          </button>
        </div>

        {selectedRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-3 py-2">
            <span className="text-sm font-medium">
              {t('exchangeRates.bulk.selected', { count: selectedRows.length })}
            </span>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
            >
              {t('exchangeRates.bulk.open')}
            </button>
            <button
              type="button"
              onClick={() => setDeleteTargets(selectedRows)}
              className="rounded-lg border border-[var(--color-negative)]/40 px-3 py-1.5 text-xs text-[var(--color-negative)]"
            >
              {t('exchangeRates.bulk.delete')}
            </button>
            <button
              type="button"
              onClick={resetSelection}
              className="ml-auto text-xs text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
            >
              {t('exchangeRates.bulk.clear')}
            </button>
          </div>
        )}
      </section>

      {latestQuery.isLoading && <LoadingState />}
      {latestQuery.isError && <ErrorState onRetry={() => void latestQuery.refetch()} />}

      {!latestQuery.isLoading && !latestQuery.isError && rows.length === 0 && (
        <EmptyState
          title={t('exchangeRates.empty_title')}
          description={t('exchangeRates.empty_description')}
          action={
            <button
              type="button"
              onClick={() => {
                setCreateSeed({ baseCurrency: 'USD', quoteCurrency: 'CNY' });
                setCreating(true);
              }}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
            >
              {t('exchangeRates.new')}
            </button>
          }
        />
      )}

      {rows.length > 0 && (
        <RateTable
          rows={rows}
          staleDays={staleDays}
          selected={selected}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onEdit={setEditingRow}
          onViewHistory={(row) => setHistoryPair({ from: row.baseCurrency, to: row.quoteCurrency })}
          onDelete={(row) => setDeleteTargets([row])}
        />
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

      {/* 同步失败项：给管理员一条直接补录的路径，而不是只报错 */}
      <section className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">{t('exchangeRates.sync_title')}</h2>
          {staleFailures.length > 0 && (
            <span className="rounded-full bg-[var(--color-negative)] px-2 py-0.5 text-xs text-white">
              {staleFailures.length}
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--color-content-muted)]">{t('exchangeRates.sync_hint')}</p>

        {provider && staleFailures.length === 0 && (
          <p className="text-sm text-[var(--color-content-muted)]">{t('exchangeRates.sync_empty')}</p>
        )}

        {staleFailures.length > 0 && (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {staleFailures.map((failure) => {
              const [from, to] = failure.pair.split('->');
              return (
                <li key={failure.pair} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-mono">
                    1 {from} → {to}
                  </span>
                  <span className="text-xs text-[var(--color-content-muted)]">{failure.code}</span>
                  <span className="min-w-0 flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setCreateSeed({
                        baseCurrency: from ?? 'USD',
                        quoteCurrency: to ?? 'CNY',
                      });
                      setCreating(true);
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

      <RateCreateDialog
        open={creating}
        seed={createSeed}
        saving={save.isPending}
        onClose={() => setCreating(false)}
        onSubmit={(input) => save.mutate(input)}
      />

      <RateHistoryDialog pair={historyPair} onClose={() => setHistoryPair(null)} />

      <RateEditDialog
        row={editingRow}
        saving={update.isPending}
        onClose={() => setEditingRow(null)}
        onSave={(input) => update.mutate(input)}
      />

      <RateBulkDrawer
        open={bulkOpen}
        drafts={bulkDrafts}
        saving={bulk.isPending}
        onClose={() => setBulkOpen(false)}
        onSubmit={(input) => bulk.mutate(input)}
      />

      <RateSyncDrawer
        open={syncDrawerOpen}
        settings={syncSettingsQuery.data ?? null}
        provider={provider}
        config={providerConfigQuery.data ?? null}
        canEdit={canEditProvider}
        saving={saveSyncSettings.isPending}
        onClose={() => setSyncDrawerOpen(false)}
        onSave={(next) => saveSyncSettings.mutate(next)}
      />

      <Modal
        open={canDelete}
        size="sm"
        title={
          deleteTargets && deleteTargets.length > 1
            ? t('exchangeRates.bulk.delete_title', { count: deleteTargets.length })
            : t('exchangeRates.delete')
        }
        description={t('exchangeRates.delete_confirm')}
        busy={remove.isPending}
        onClose={() => setDeleteTargets(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteTargets(null)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('exchangeRates.cancel')}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => deleteTargets && remove.mutate(deleteTargets)}
              className="rounded-lg bg-[var(--color-negative)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('exchangeRates.delete')}
            </button>
          </>
        }
      >
        <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs">
          {(deleteTargets ?? []).slice(0, 10).map((target) => (
            <li key={target.id}>
              1 {target.baseCurrency} → {target.quoteCurrency} ({target.rateDate.slice(0, 10)})
            </li>
          ))}
          {(deleteTargets?.length ?? 0) > 10 && <li>… +{(deleteTargets?.length ?? 0) - 10}</li>}
        </ul>
      </Modal>
    </div>
  );
}
