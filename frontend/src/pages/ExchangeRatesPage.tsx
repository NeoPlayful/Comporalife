import CurrencyPair from '@/components/finance/CurrencyPair';
import RateTrendDialog from '@/components/finance/RateTrendDialog';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import { exchangeRatesApi, type WatchlistEntry } from '@/lib/dashboard';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { currencyName, formatDate, formatRate } from '@/lib/format';
import { sortedCurrencyCodes } from '@/components/finance/CurrencyFlag';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const CODES = sortedCurrencyCodes();

/**
 * 汇率指标（自选）。
 *
 * 汇率本身由后台维护，用户只能决定列表里显示哪些币种对——与自选股票同理。
 * 可添加范围由服务端给出：只包含当前真能折算的币种对，因此不会出现
 * 「加进来却永远没有值」的行。折算逻辑完全不读这个列表。
 */
export default function ExchangeRatesPage() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();

  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState({ from: 'USD', to: 'CNY' });
  // 正在查看走势的币种对；null 表示抽屉关闭
  const [trendPair, setTrendPair] = useState<{ from: string; to: string } | null>(null);

  const queryKey = ['exchange-rates', 'watchlist'];
  const viewQuery = useQuery({
    queryKey,
    queryFn: () => exchangeRatesApi.watchlist(),
  });

  const view = viewQuery.data;
  const entries = view?.entries ?? [];
  const candidates = useMemo(() => view?.candidates ?? [], [view]);

  // 只有出现在候选里的组合才能添加：服务端已按「可折算 + 自己需要」裁剪过
  const draftAddable = candidates.some(
    (item) => item.from === draft.from && item.to === draft.to,
  );
  const draftSameCurrency = draft.from === draft.to;

  function onWriteSuccess(next: typeof view) {
    if (next) queryClient.setQueryData(queryKey, next);
    // 汇率变化会影响诊断与统计，缓存一并失效
    void queryClient.invalidateQueries({ queryKey: ['market-data', 'status'] });
  }

  const add = useMutation({
    mutationFn: (body: { from: string; to: string }) => exchangeRatesApi.addPair(body),
    onSuccess: (next) => {
      toastSuccess(t('common:feedback.created'));
      onWriteSuccess(next);
      // 加入成功后关闭面板：列表本身已经给出结果，留着面板反而挡住内容
      setPicking(false);
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  const remove = useMutation({
    mutationFn: (body: { from: string; to: string }) => exchangeRatesApi.removePair(body),
    onSuccess: (next) => {
      toastSuccess(t('common:feedback.deleted'));
      onWriteSuccess(next);
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  const reset = useMutation({
    mutationFn: () => exchangeRatesApi.resetWatchlist(),
    onSuccess: (next) => {
      toastSuccess(t('common:feedback.done'));
      onWriteSuccess(next);
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  const busy = add.isPending || remove.isPending || reset.isPending;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('exchange_rates.page.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {t('exchange_rates.page.watchlist_hint')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view?.custom && (
            <button
              type="button"
              onClick={() => reset.mutate()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm disabled:opacity-50"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t('exchange_rates.page.restore_default')}
            </button>
          )}
          <button
            type="button"
            onClick={() => setPicking((prev) => !prev)}
            className="flex items-center gap-1.5 rounded-lg btn-action px-3 py-2 text-sm font-medium"
          >
            <Plus className="size-4" aria-hidden />
            {t('exchange_rates.page.add_pair')}
          </button>
        </div>
      </header>

      <Modal
        open={picking}
        title={t('exchange_rates.page.add_title')}
        description={t('exchange_rates.page.add_hint')}
        dirty={draft.from !== 'USD' || draft.to !== 'CNY'}
        busy={busy}
        onClose={() => setPicking(false)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('exchange_rates.page.cancel')}
            </button>
            <button
              type="button"
              disabled={busy || draftSameCurrency || !draftAddable}
              onClick={() => add.mutate({ from: draft.from, to: draft.to })}
              className="rounded-lg btn-action px-3 py-2 text-sm font-medium"
            >
              {t('exchange_rates.page.confirm_add')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-[var(--color-content-muted)]">
              <span className="mb-1 block">{t('exchange_rates.base_currency')}</span>
              <select
                data-autofocus
                className="input"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              >
                {CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} · {currencyName(code)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--color-content-muted)]">
              <span className="mb-1 block">{t('exchange_rates.quote_currency')}</span>
              <select
                className="input"
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              >
                {CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} · {currencyName(code)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="text-xs">
            {draftSameCurrency ? (
              <span className="text-[var(--color-negative)]">
                {t('exchange_rates.page.same_currency')}
              </span>
            ) : draftAddable ? (
              <span className="text-[var(--color-content-muted)]">
                {t('exchange_rates.page.draft_ready')}
              </span>
            ) : (
              <span className="text-[var(--color-content-muted)]">
                {t('exchange_rates.page.draft_unavailable')}
              </span>
            )}
          </p>

          <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
            <p className="text-xs font-medium text-[var(--color-content-muted)]">
              {t('exchange_rates.page.candidates_title')}
            </p>
            {candidates.length === 0 ? (
              <p className="text-sm text-[var(--color-content-muted)]">
                {t('exchange_rates.page.no_candidates')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {candidates.map((item) => {
                  const selected = item.from === draft.from && item.to === draft.to;
                  return (
                    <button
                      key={`${item.from}->${item.to}`}
                      type="button"
                      disabled={busy}
                      // 点候选只填入上面的选择框，真正的写入由「确定添加」完成
                      onClick={() => setDraft({ from: item.from, to: item.to })}
                      className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs disabled:opacity-50 ${
                        selected
                          ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                          : 'border-[var(--color-border-subtle)] hover:border-[var(--color-accent)]'
                      }`}
                    >
                      <CurrencyPair from={item.from} to={item.to} />
                      {item.required && (
                        <span className="text-[var(--color-accent)]">
                          {t('exchange_rates.page.required_badge')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {viewQuery.isLoading && <LoadingState />}
      {viewQuery.isError && <ErrorState onRetry={() => void viewQuery.refetch()} />}

      {view && entries.length === 0 && (
        <EmptyState
          title={t('exchange_rates.page.empty_title')}
          description={t('exchange_rates.page.empty_description')}
          action={
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="rounded-lg btn-action px-3 py-2 text-sm font-medium"
            >
              {t('exchange_rates.page.add_pair')}
            </button>
          }
        />
      )}

      {entries.length > 0 && (
        <>
          {/* 移动端卡片：自选行数少，逐张可读优于横向滚动表格 */}
          <ul className="space-y-2 sm:hidden">
            {entries.map((entry) => (
              <li key={`${entry.from}->${entry.to}`}>
                <button
                  type="button"
                  onClick={() => setTrendPair({ from: entry.from, to: entry.to })}
                  aria-label={t('exchange_rates.page.view_trend', {
                    from: entry.from,
                    to: entry.to,
                  })}
                  className="card w-full space-y-1 p-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <CurrencyPair from={entry.from} to={entry.to} className="text-sm" />
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        // 删除是卡片内的独立操作：阻止冒泡，避免顺带打开走势
                        event.stopPropagation();
                        remove.mutate({ from: entry.from, to: entry.to });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation();
                          event.preventDefault();
                          remove.mutate({ from: entry.from, to: entry.to });
                        }
                      }}
                      aria-label={t('exchange_rates.page.remove_pair')}
                      aria-disabled={busy || undefined}
                      className={`text-[var(--color-content-muted)] hover:text-[var(--color-negative)] ${
                        busy ? 'pointer-events-none opacity-50' : ''
                      }`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </span>
                  </div>
                  <p className="font-mono text-lg tabular-nums">
                    {entry.rate ? formatRate(entry.rate) : '—'}
                  </p>
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {entry.rate
                      ? `${formatDate(entry.rateDate!)} · ${t(`exchange_rates.page.state.${entry.state}`)}`
                      : t('exchange_rates.page.state.missing_hint')}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
                <tr>
                  <th className="px-3 py-2">{t('exchange_rates.page.pair')}</th>
                  <th className="px-3 py-2">{t('exchange_rates.rate')}</th>
                  <th className="px-3 py-2">{t('exchange_rates.effective_date')}</th>
                  <th className="px-3 py-2">{t('exchange_rates.page.source')}</th>
                  <th className="px-3 py-2">{t('exchange_rates.page.status')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {entries.map((entry: WatchlistEntry) => (
                  <tr
                    key={`${entry.from}->${entry.to}`}
                    onClick={() => setTrendPair({ from: entry.from, to: entry.to })}
                    className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setTrendPair({ from: entry.from, to: entry.to });
                        }}
                        className="text-left"
                      >
                        <CurrencyPair from={entry.from} to={entry.to} />
                      </button>
                      {entry.required && (
                        <span className="ml-2 text-xs text-[var(--color-accent)]">
                          {t('exchange_rates.page.required_badge')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {entry.rate ? formatRate(entry.rate) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--color-content-muted)]">
                      {entry.rateDate ? formatDate(entry.rateDate) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {entry.source === 'provider'
                        ? t('exchange_rates.page.source_provider')
                        : entry.source === 'manual'
                          ? t('exchange_rates.page.source_manual')
                          : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      <span
                        className={
                          entry.state === 'missing'
                            ? 'text-[var(--color-negative)]'
                            : 'text-[var(--color-content-muted)]'
                        }
                      >
                        {t(`exchange_rates.page.state.${entry.state}`)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                      <button
                        type="button"
                        onClick={(event) => {
                          // 行本身可点开走势，删除按钮要挡住冒泡
                          event.stopPropagation();
                          remove.mutate({ from: entry.from, to: entry.to });
                        }}
                        disabled={busy}
                        className="text-[var(--color-content-muted)] hover:text-[var(--color-negative)] disabled:opacity-50"
                        aria-label={t('exchange_rates.page.remove_pair')}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {entries.some((entry) => entry.state === 'missing') && (
        <p className="text-xs text-[var(--color-content-muted)]">
          {t('exchange_rates.page.missing_hint')}
        </p>
      )}

      <RateTrendDialog pair={trendPair} onClose={() => setTrendPair(null)} />
    </div>
  );
}
