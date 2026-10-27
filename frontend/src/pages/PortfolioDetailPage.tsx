import AllocationPieChart from '@/components/portfolios/AllocationPieChart';
import HoldingTable from '@/components/portfolios/HoldingTable';
import PerformanceChart from '@/components/portfolios/PerformanceChart';
import PortfolioSummaryCards from '@/components/portfolios/PortfolioSummaryCards';
import TradeForm, { emptyTradeDraft, type TradeDraft } from '@/components/portfolios/TradeForm';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDate, formatNumber, formatPrice } from '@/lib/format';
import {
  instrumentsApi,
  portfoliosApi,
  tradesApi,
  type AllocationDimension,
  type AssetClass,
  type Instrument,
  type TargetItem,
} from '@/lib/portfolios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

type Tab = 'holdings' | 'performance' | 'allocation' | 'trades' | 'cashflows';

const TABS: Tab[] = ['holdings', 'performance', 'allocation', 'trades', 'cashflows'];
const DIMENSIONS: AllocationDimension[] = ['asset_class', 'instrument', 'currency'];

function pct(value: string | null): string {
  if (value === null) return '—';
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export default function PortfolioDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation('portfolios');
  const { t: tEnums } = useTranslation('enums');
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [tab, setTab] = useState<Tab>('holdings');
  const [dimension, setDimension] = useState<AllocationDimension>('asset_class');
  const [editingTargets, setEditingTargets] = useState(false);
  const [targetDraft, setTargetDraft] = useState<Record<string, string>>({});
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [tradeDraft, setTradeDraft] = useState<TradeDraft>(() => emptyTradeDraft());
  const [cashflowDraft, setCashflowDraft] = useState({
    kind: 'deposit' as 'deposit' | 'withdraw',
    flowDate: new Date().toISOString().slice(0, 10),
    amount: '',
  });
  const [showNewInstrument, setShowNewInstrument] = useState(false);
  const [instrumentDraft, setInstrumentDraft] = useState({
    symbol: '',
    name: '',
    assetClass: 'etf' as AssetClass,
  });
  const [priceDraft, setPriceDraft] = useState({ instrumentId: '', priceDate: '', price: '' });
  const priceFormRef = useRef<HTMLDivElement | null>(null);

  // 从持仓行跳过来时，表单就在同一屏下方：滚动 + 聚焦比让用户自己找更直接
  function focusPriceForm(instrumentId: string) {
    setTab('holdings');
    setPriceDraft({
      instrumentId,
      priceDate: new Date().toISOString().slice(0, 10),
      price: '',
    });
    requestAnimationFrame(() => {
      priceFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      priceFormRef.current?.querySelector<HTMLInputElement>('input[type="date"]')?.focus();
    });
  }

  const detailQuery = useQuery({
    queryKey: ['portfolio', id],
    queryFn: () => portfoliosApi.detail(id),
    enabled: id !== '',
  });

  const holdingsQuery = useQuery({
    queryKey: ['portfolio', id, 'holdings'],
    queryFn: () => portfoliosApi.holdings(id),
    enabled: id !== '',
  });

  // 总览卡需要 TWR/XIRR，因此不随 Tab 开关，进页面就加载
  const returnsQuery = useQuery({
    queryKey: ['portfolio', id, 'returns'],
    queryFn: () => portfoliosApi.returns(id),
    enabled: id !== '',
  });

  const performanceQuery = useQuery({
    queryKey: ['portfolio', id, 'performance'],
    queryFn: () => portfoliosApi.performance(id),
    enabled: id !== '' && tab === 'performance',
  });

  const allocationQuery = useQuery({
    queryKey: ['portfolio', id, 'allocation'],
    queryFn: () => portfoliosApi.allocation(id),
    enabled: id !== '' && tab === 'allocation',
  });

  const targetsQuery = useQuery({
    queryKey: ['portfolio', id, 'targets'],
    queryFn: () => portfoliosApi.targets(id),
    enabled: id !== '' && tab === 'allocation',
  });

  const driftQuery = useQuery({
    queryKey: ['portfolio', id, 'drift', dimension],
    queryFn: () => portfoliosApi.drift(id, dimension),
    enabled: id !== '' && tab === 'allocation',
  });

  const riskQuery = useQuery({
    queryKey: ['portfolio', id, 'risk'],
    queryFn: () => portfoliosApi.riskSummary(id),
    enabled: id !== '' && tab === 'allocation',
  });

  const tradesQuery = useQuery({
    queryKey: ['portfolio', id, 'trades'],
    queryFn: () => tradesApi.list({ portfolioId: id }),
    enabled: id !== '' && tab === 'trades',
  });

  const cashflowsQuery = useQuery({
    queryKey: ['portfolio', id, 'cashflows'],
    queryFn: () => portfoliosApi.cashflows(id),
    enabled: id !== '' && tab === 'cashflows',
  });

  const instrumentsQuery = useQuery({
    queryKey: ['instruments', 'all'],
    queryFn: () => instrumentsApi.list(),
  });

  const instruments: Instrument[] = instrumentsQuery.data?.items ?? [];
  const holdings = holdingsQuery.data?.holdings ?? [];
  const currency = detailQuery.data?.portfolio.currency ?? 'CNY';

  const invalidatePortfolio = () => {
    void queryClient.invalidateQueries({ queryKey: ['portfolio', id] });
    void queryClient.invalidateQueries({ queryKey: ['portfolios'] });
  };

  const createTradeMutation = useMutation({
    mutationFn: () => {
      const isTrade = tradeDraft.kind === 'buy' || tradeDraft.kind === 'sell';
      return tradesApi.create({
        portfolioId: id,
        kind: tradeDraft.kind,
        tradeDate: new Date(`${tradeDraft.tradeDate}T00:00:00.000Z`).toISOString(),
        instrumentId: tradeDraft.instrumentId || null,
        quantity: isTrade ? tradeDraft.quantity : null,
        price: isTrade ? tradeDraft.price : null,
        amount: isTrade ? undefined : tradeDraft.amount,
        fee: tradeDraft.fee || undefined,
        tax: tradeDraft.tax || undefined,
        categoryId: tradeDraft.categoryId || null,
        note: tradeDraft.note || null,
      });
    },
    onSuccess: () => {
      toastSuccess(t('common:feedback.created'));
      setShowTradeForm(false);
      setTradeDraft(emptyTradeDraft());
      invalidatePortfolio();
      void queryClient.invalidateQueries({ queryKey: ['portfolio', id, 'trades'] });
    },
  });

  const voidTradeMutation = useMutation({
    mutationFn: (tradeId: string) => tradesApi.remove(tradeId),
    onSuccess: () => {
      toastSuccess(t('common:feedback.voided'));
      invalidatePortfolio();
      void queryClient.invalidateQueries({ queryKey: ['portfolio', id, 'trades'] });
    },
  });

  const addCashflowMutation = useMutation({
    mutationFn: () =>
      portfoliosApi.addCashflow(id, {
        kind: cashflowDraft.kind,
        flowDate: new Date(`${cashflowDraft.flowDate}T00:00:00.000Z`).toISOString(),
        amount: cashflowDraft.amount,
      }),
    onSuccess: () => {
      toastSuccess(t('common:feedback.created'));
      setCashflowDraft({ ...cashflowDraft, amount: '' });
      invalidatePortfolio();
      void queryClient.invalidateQueries({ queryKey: ['portfolio', id, 'cashflows'] });
    },
  });

  const removeCashflowMutation = useMutation({
    mutationFn: (cashflowId: string) => portfoliosApi.removeCashflow(id, cashflowId),
    onSuccess: () => {
      toastSuccess(t('common:feedback.deleted'));
      invalidatePortfolio();
      void queryClient.invalidateQueries({ queryKey: ['portfolio', id, 'cashflows'] });
    },
  });

  const createInstrumentMutation = useMutation({
    mutationFn: () =>
      instrumentsApi.create({
        symbol: instrumentDraft.symbol.trim(),
        name: instrumentDraft.name.trim(),
        assetClass: instrumentDraft.assetClass,
        currency,
      }),
    onSuccess: () => {
      toastSuccess(t('common:feedback.created'));
      setShowNewInstrument(false);
      setInstrumentDraft({ symbol: '', name: '', assetClass: 'etf' });
      void queryClient.invalidateQueries({ queryKey: ['instruments'] });
    },
  });

  const addPriceMutation = useMutation({
    mutationFn: () =>
      instrumentsApi.addPrice(priceDraft.instrumentId, {
        priceDate: priceDraft.priceDate,
        price: priceDraft.price,
      }),
    onSuccess: () => {
      toastSuccess(t('common:feedback.saved'));
      setPriceDraft({ instrumentId: '', priceDate: '', price: '' });
      void queryClient.invalidateQueries({ queryKey: ['instruments'] });
      invalidatePortfolio();
    },
  });

  const saveTargetsMutation = useMutation({
    mutationFn: () => {
      const targets: TargetItem[] = Object.entries(targetDraft)
        .filter(([, weight]) => weight !== '')
        .map(([key, weight]) => ({ key, targetWeight: weight }));
      return portfoliosApi.saveTargets(id, { dimension, targets });
    },
    onSuccess: () => {
      toastSuccess(t('common:feedback.saved'));
      setEditingTargets(false);
      void queryClient.invalidateQueries({ queryKey: ['portfolio', id, 'targets'] });
      void queryClient.invalidateQueries({ queryKey: ['portfolio', id, 'drift'] });
    },
  });

  // 再平衡只算预览、不写数据，不给成功提示，否则每次切维度都会弹一条
  const rebalanceMutation = useMutation({
    mutationFn: () => portfoliosApi.rebalancePreview(id, { dimension }),
    onError: (err) => toastError(translateError(err, t)),
  });

  const allocationItems = useMemo(() => {
    if (!allocationQuery.data) return [];
    const source =
      dimension === 'asset_class'
        ? allocationQuery.data.assetClass
        : dimension === 'instrument'
          ? allocationQuery.data.instrument
          : allocationQuery.data.currency;
    return source.items.map((item) => ({
      key: item.key,
      label:
        dimension === 'asset_class' ? tEnums(`asset_class.${item.key}`) : item.label,
      value: item.value,
      weight: item.weight,
    }));
  }, [allocationQuery.data, dimension, tEnums]);

  if (detailQuery.isLoading) return <LoadingState />;

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="card">
        <EmptyState title={t('errors.no_portfolio')} description={t('errors.load_failed')} />
      </div>
    );
  }

  const detail = detailQuery.data;
  const targetItems = targetsQuery.data?.items.find((item) => item.dimension === dimension);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/portfolios"
            className="mb-1 flex items-center gap-1 text-xs text-[var(--color-content-muted)] hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t('list.title')}
          </Link>
          <h1 className="text-xl font-semibold">{detail.portfolio.name}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {detail.portfolio.accountName} · {detail.portfolio.currency}
          </p>
        </div>

        <div className="text-right text-xs text-[var(--color-content-muted)]">
          <p>
            {t('summary.price_date')} {formatDate(detail.priceDate)}
          </p>
          {detail.stale && (
            <p className="mt-1 flex items-center justify-end gap-1 text-[var(--color-warning)]">
              <AlertTriangle className="size-3.5" aria-hidden />
              {t('holdings.stale')}
            </p>
          )}
        </div>
      </div>

      <PortfolioSummaryCards detail={detail} returns={returnsQuery.data} />

      {!detail.isComplete && detail.missingPrices.length > 0 && (
        <p className="rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-sm">
          {t('basis.unpriced_hint', {
            symbols: detail.missingPrices.map((item) => item.symbol).join(', '),
          })}
        </p>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-subtle)]">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`whitespace-nowrap px-3 py-2 text-sm ${
              tab === item
                ? 'border-b-2 border-[var(--color-accent)] font-medium text-[var(--color-accent)]'
                : 'text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }`}
          >
            {t(`tabs.${item}`)}
          </button>
        ))}
      </div>

      {tab === 'holdings' && (
        <section className="card">
          {holdingsQuery.isLoading ? (
            <LoadingState />
          ) : (
            <HoldingTable
              holdings={holdings}
              currency={currency}
              onRecordPrice={focusPriceForm}
            />
          )}

          {/*
            交易、标的、价格、现金流刻意保持内联：这里是一条连续录入流，
            录一条立刻能在下方表格看到结果，弹窗会打断这个来回。
          */}
          <div className="mt-4 space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowTradeForm(true);
                  setTab('trades');
                }}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
              >
                <Plus className="size-4" aria-hidden />
                {t('trades.add')}
              </button>
              <button
                type="button"
                onClick={() => setShowNewInstrument((prev) => !prev)}
                className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
              >
                {t('instruments.add')}
              </button>
            </div>

            {showNewInstrument && (
              <div className="grid gap-2 sm:grid-cols-4">
                <input
                  placeholder={t('instruments.symbol')}
                  value={instrumentDraft.symbol}
                  onChange={(event) =>
                    setInstrumentDraft({ ...instrumentDraft, symbol: event.target.value })
                  }
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
                />
                <input
                  placeholder={t('instruments.name')}
                  value={instrumentDraft.name}
                  onChange={(event) =>
                    setInstrumentDraft({ ...instrumentDraft, name: event.target.value })
                  }
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
                />
                <select
                  value={instrumentDraft.assetClass}
                  onChange={(event) =>
                    setInstrumentDraft({
                      ...instrumentDraft,
                      assetClass: event.target.value as AssetClass,
                    })
                  }
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
                >
                  {(['stock', 'etf', 'fund', 'bond', 'cash', 'other'] as AssetClass[]).map((value) => (
                    <option key={value} value={value}>
                      {tEnums(`asset_class.${value}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={
                    !instrumentDraft.symbol.trim() ||
                    !instrumentDraft.name.trim() ||
                    createInstrumentMutation.isPending
                  }
                  onClick={() => createInstrumentMutation.mutate()}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {t('actions.save')}
                </button>
              </div>
            )}

            {instruments.length > 0 && (
              <div
                ref={priceFormRef}
                className="grid gap-2 sm:grid-cols-4"
              >
                <select
                  value={priceDraft.instrumentId}
                  onChange={(event) =>
                    setPriceDraft({ ...priceDraft, instrumentId: event.target.value })
                  }
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
                >
                  <option value="">{t('holdings.instrument')}</option>
                  {instruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {instrument.symbol}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={priceDraft.priceDate}
                  onChange={(event) =>
                    setPriceDraft({ ...priceDraft, priceDate: event.target.value })
                  }
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
                />
                <input
                  type="number"
                  min="0"
                  step="0.00000001"
                  placeholder={t('instruments.price')}
                  value={priceDraft.price}
                  onChange={(event) => setPriceDraft({ ...priceDraft, price: event.target.value })}
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm tabular-nums"
                />
                <button
                  type="button"
                  disabled={
                    !priceDraft.instrumentId ||
                    !priceDraft.priceDate ||
                    !priceDraft.price ||
                    addPriceMutation.isPending
                  }
                  onClick={() => addPriceMutation.mutate()}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {t('instruments.add_price')}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'performance' && (
        <div className="space-y-4">
          <section className="card space-y-4">
            {performanceQuery.isLoading || returnsQuery.isLoading ? (
              <LoadingState />
            ) : performanceQuery.data ? (
              <PerformanceChart
                performance={performanceQuery.data}
                returns={returnsQuery.data}
                currency={currency}
              />
            ) : (
              <EmptyState title={t('performance.empty')} />
            )}
          </section>

          <ValuationSnapshotPanel portfolioId={id} />
        </div>
      )}

      {tab === 'allocation' && (
        <div className="space-y-4">
          <section className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-content-muted)]">
                  {t('allocation.dimension')}
                </span>
                <select
                  value={dimension}
                  onChange={(event) => setDimension(event.target.value as AllocationDimension)}
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1 text-sm"
                >
                  {DIMENSIONS.map((value) => (
                    <option key={value} value={value}>
                      {tEnums(`allocation_dimension.${value}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const draft: Record<string, string> = {};
                    for (const item of targetItems?.targets ?? []) {
                      draft[item.key] = item.targetWeight;
                    }
                    setTargetDraft(draft);
                    setEditingTargets(true);
                  }}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm"
                >
                  {t('allocation.edit_targets')}
                </button>
                <button
                  type="button"
                  disabled={rebalanceMutation.isPending}
                  onClick={() => rebalanceMutation.mutate()}
                  className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {t('allocation.rebalance')}
                </button>
              </div>
            </div>

            {allocationQuery.isLoading ? (
              <LoadingState />
            ) : allocationItems.length === 0 ? (
              <EmptyState title={t('allocation.empty')} />
            ) : (
              <AllocationPieChart
                items={allocationItems}
                currency={currency}
                title={t('allocation.current')}
              />
            )}
          </section>

          {editingTargets && (
            <section className="card space-y-3">
              <h3 className="text-sm font-medium">{t('allocation.target')}</h3>
              <div className="space-y-2">
                {(dimension === 'asset_class'
                  ? (['stock', 'etf', 'fund', 'bond', 'cash', 'other'] as const).map((key) => ({
                      key,
                      label: tEnums(`asset_class.${key}`),
                    }))
                  : allocationItems.map((item) => ({ key: item.key, label: item.label }))
                ).map((option) => (
                  <label key={option.key} className="flex items-center gap-2 text-sm">
                    <span className="w-40 shrink-0">{option.label}</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={targetDraft[option.key] ?? ''}
                      onChange={(event) =>
                        setTargetDraft({ ...targetDraft, [option.key]: event.target.value })
                      }
                      className="w-28 rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1 tabular-nums"
                    />
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saveTargetsMutation.isPending}
                  onClick={() => saveTargetsMutation.mutate()}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  {t('allocation.save_targets')}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTargets(false)}
                  className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-content-muted)]"
                >
                  {t('actions.cancel')}
                </button>
              </div>
            </section>
          )}

          <section className="card space-y-3">
            <h3 className="text-sm font-medium">{t('allocation.drift')}</h3>
            {driftQuery.data && driftQuery.data.items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
                      <th className="pb-2 font-normal">{t('allocation.dimension')}</th>
                      <th className="pb-2 text-right font-normal">{t('allocation.target')}</th>
                      <th className="pb-2 text-right font-normal">{t('allocation.current')}</th>
                      <th className="pb-2 text-right font-normal">{t('allocation.drift')}</th>
                      <th className="pb-2 text-right font-normal">—</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driftQuery.data.items.map((item) => (
                      <tr key={item.key} className="border-b border-[var(--color-border-subtle)]/50">
                        <td className="py-2">
                          {dimension === 'asset_class'
                            ? tEnums(`asset_class.${item.key}`)
                            : item.label}
                        </td>
                        <td className="py-2 text-right tabular-nums">{pct(item.targetWeight)}</td>
                        <td className="py-2 text-right tabular-nums">{pct(item.currentWeight)}</td>
                        <td className="py-2 text-right tabular-nums">{pct(item.drift)}</td>
                        <td className="py-2 text-right text-xs text-[var(--color-content-muted)]">
                          {t(`allocation.action_${item.action}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-content-muted)]">{t('allocation.no_targets')}</p>
            )}
          </section>

          {rebalanceMutation.data && (
            <section className="card space-y-3">
              <h3 className="text-sm font-medium">{t('allocation.rebalance')}</h3>
              <p className="text-xs text-[var(--color-content-muted)]">{t('allocation.rebalance_hint')}</p>
              {rebalanceMutation.data.note === 'category_level' && (
                <p className="text-xs text-[var(--color-content-muted)]">
                  {t('allocation.rebalance_category_note')}
                </p>
              )}
              {rebalanceMutation.data.suggestions.length === 0 ? (
                <p className="text-sm text-[var(--color-content-muted)]">
                  {t('allocation.action_none')}
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {rebalanceMutation.data.suggestions.map((item) => (
                    <li key={item.key} className="flex flex-wrap justify-between gap-2">
                      <span>
                        {item.label} · {t(`allocation.action_${item.action}`)}
                      </span>
                      <span className="tabular-nums text-[var(--color-content-muted)]">
                        {formatNumber(item.amount)} {currency}
                        {item.quantity && ` · ${Number(item.quantity)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {riskQuery.data && (
            <section className="card space-y-2">
              <h3 className="text-sm font-medium">{t('allocation.risk_title')}</h3>
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-[var(--color-content-muted)]">
                    {t('allocation.max_weight')}
                  </dt>
                  <dd className="tabular-nums">
                    {pct(riskQuery.data.maxWeight)} {riskQuery.data.maxWeightLabel ?? ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-content-muted)]">
                    {t('allocation.top_three')}
                  </dt>
                  <dd className="tabular-nums">{pct(riskQuery.data.topThreeWeight)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--color-content-muted)]">
                    {t('allocation.concentration')}
                  </dt>
                  <dd
                    className={
                      riskQuery.data.concentrationWarning
                        ? 'text-[var(--color-warning)]'
                        : ''
                    }
                  >
                    {riskQuery.data.concentrationWarning
                      ? t('allocation.concentration_hint', {
                          keys: riskQuery.data.concentrationKeys
                            .map((key) => tEnums(`asset_class.${key}`))
                            .join(', '),
                        })
                      : '—'}
                  </dd>
                </div>
              </dl>
            </section>
          )}
        </div>
      )}

      {tab === 'trades' && (
        <div className="space-y-4">
          {showTradeForm ? (
            <TradeForm
              draft={tradeDraft}
              instruments={instruments}
              holdings={holdings}
              currency={currency}
              saving={createTradeMutation.isPending}
              onChange={setTradeDraft}
              onSubmit={() => createTradeMutation.mutate()}
              onCancel={() => setShowTradeForm(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowTradeForm(true)}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
            >
              <Plus className="size-4" aria-hidden />
              {t('trades.add')}
            </button>
          )}

          <section className="card">
            {tradesQuery.isLoading ? (
              <LoadingState />
            ) : (tradesQuery.data?.items ?? []).length === 0 ? (
              <EmptyState title={t('trades.empty')} description={t('trades.empty_hint')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs text-[var(--color-content-muted)]">
                      <th className="pb-2 font-normal">{t('trades.date')}</th>
                      <th className="pb-2 font-normal">{t('trades.kind')}</th>
                      <th className="pb-2 font-normal">{t('trades.instrument')}</th>
                      <th className="pb-2 text-right font-normal">{t('trades.quantity')}</th>
                      <th className="pb-2 text-right font-normal">{t('trades.price')}</th>
                      <th className="pb-2 text-right font-normal">{t('trades.amount')}</th>
                      <th className="pb-2 text-right font-normal">{t('trades.fee')}</th>
                      <th className="pb-2 text-right font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {(tradesQuery.data?.items ?? []).map((trade) => (
                      <tr
                        key={trade.id}
                        className={`border-b border-[var(--color-border-subtle)]/50 ${
                          trade.voided ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="py-2 tabular-nums">{trade.tradeDate}</td>
                        <td className="py-2">{tEnums(`trade_kind.${trade.kind}`)}</td>
                        <td className="py-2">
                          {trade.symbol ? `${trade.symbol} ${trade.instrumentName ?? ''}` : '—'}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {trade.quantity === null ? '—' : Number(trade.quantity)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {trade.price === null ? '—' : formatPrice(trade.price)}
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(trade.amount)}</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(trade.fee)}</td>
                        <td className="py-2 text-right">
                          {trade.voided ? (
                            <span className="text-xs text-[var(--color-content-muted)]">
                              {t('trades.voided')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-label={t('trades.void')}
                              disabled={voidTradeMutation.isPending}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: t('trades.void'),
                                  message: t('trades.confirm_void'),
                                  tone: 'danger',
                                });
                                if (ok) voidTradeMutation.mutate(trade.id);
                              }}
                              className="rounded-lg p-1 text-[var(--color-negative)] hover:bg-[var(--color-negative)]/10 disabled:opacity-50"
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'cashflows' && (
        <div className="space-y-4">
          <section className="card space-y-3">
            <h3 className="text-sm font-medium">{t('cashflows.add')}</h3>
            <p className="text-xs text-[var(--color-content-muted)]">{t('cashflows.hint')}</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <select
                value={cashflowDraft.kind}
                onChange={(event) =>
                  setCashflowDraft({
                    ...cashflowDraft,
                    kind: event.target.value as 'deposit' | 'withdraw',
                  })
                }
                className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
              >
                <option value="deposit">{tEnums('cashflow_kind.deposit')}</option>
                <option value="withdraw">{tEnums('cashflow_kind.withdraw')}</option>
              </select>
              <input
                type="date"
                value={cashflowDraft.flowDate}
                onChange={(event) =>
                  setCashflowDraft({ ...cashflowDraft, flowDate: event.target.value })
                }
                className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={t('cashflows.amount')}
                value={cashflowDraft.amount}
                onChange={(event) =>
                  setCashflowDraft({ ...cashflowDraft, amount: event.target.value })
                }
                className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm tabular-nums"
              />
              <button
                type="button"
                disabled={!cashflowDraft.amount || addCashflowMutation.isPending}
                onClick={() => addCashflowMutation.mutate()}
                className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {t('actions.save')}
              </button>
            </div>
          </section>

          <section className="card">
            {cashflowsQuery.isLoading ? (
              <LoadingState />
            ) : (cashflowsQuery.data?.items ?? []).length === 0 ? (
              <EmptyState
                title={t('cashflows.empty')}
                description={t('cashflows.empty_hint')}
              />
            ) : (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {(cashflowsQuery.data?.items ?? []).map((flow) => (
                  <li key={flow.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <p>
                        {tEnums(`cashflow_kind.${flow.kind}`)} · {formatDate(flow.flowDate)}
                      </p>
                      {flow.note && (
                        <p className="text-xs text-[var(--color-content-muted)]">{flow.note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">
                        {formatNumber(flow.amount)} {currency}
                      </span>
                      <button
                        type="button"
                        aria-label={t('cashflows.delete')}
                        disabled={removeCashflowMutation.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: t('cashflows.delete'),
                            message: t('cashflows.confirm_delete'),
                            tone: 'danger',
                          });
                          if (ok) removeCashflowMutation.mutate(flow.id);
                        }}
                        className="rounded-lg p-1 text-[var(--color-negative)] hover:bg-[var(--color-negative)]/10 disabled:opacity-50"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * 手工估值快照。
 *
 * 只在「该时点没有价格」时接管证券市值，是用户对整体市值的陈述，
 * 因此不可拆分到单个标的。列表与录入放在收益页下方，
 * 因为它的作用就是修复缺价时段的收益曲线。
 */
function ValuationSnapshotPanel({ portfolioId }: { portfolioId: string }) {
  const { t } = useTranslation('portfolios');
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [draft, setDraft] = useState({
    valuationDate: new Date().toISOString().slice(0, 10),
    marketValue: '',
    note: '',
  });
  const listQuery = useQuery({
    queryKey: ['portfolio', portfolioId, 'valuations'],
    queryFn: () => portfoliosApi.valuations(portfolioId),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] });
    void queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId, 'valuations'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

  const addMutation = useMutation({
    mutationFn: (overwrite: boolean) =>
      portfoliosApi.addValuation(portfolioId, {
        valuationDate: draft.valuationDate,
        marketValue: draft.marketValue.trim(),
        ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
        overwrite,
      }),
    onSuccess: () => {
      toastSuccess(t('common:feedback.saved'));
      setDraft({ valuationDate: new Date().toISOString().slice(0, 10), marketValue: '', note: '' });
      invalidate();
    },
    onError: async (err) => {
      // 同日已存在快照时后端要求显式覆盖，这里让用户确认后重试
      const ok = await confirm({
        title: t('valuations.overwrite_confirm'),
        message: t('valuations.overwrite_confirm'),
      });
      if (ok) {
        addMutation.mutate(true);
        return;
      }
      toastError(translateError(err, t));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (valuationId: string) => portfoliosApi.removeValuation(portfolioId, valuationId),
    onSuccess: () => {
      toastSuccess(t('common:feedback.deleted'));
      invalidate();
    },
  });

  const items = listQuery.data?.items ?? [];

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-sm font-medium">{t('valuations.title')}</h2>
        <p className="mt-1 text-xs text-[var(--color-content-muted)]">{t('valuations.hint')}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <input
          type="date"
          className="input"
          value={draft.valuationDate}
          onChange={(event) => setDraft({ ...draft, valuationDate: event.target.value })}
          aria-label={t('valuations.date')}
        />
        <input
          className="input font-mono"
          inputMode="decimal"
          placeholder={t('valuations.market_value')}
          value={draft.marketValue}
          onChange={(event) => setDraft({ ...draft, marketValue: event.target.value })}
          aria-label={t('valuations.market_value')}
        />
        <input
          className="input"
          placeholder={t('valuations.note')}
          value={draft.note}
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          aria-label={t('valuations.note')}
        />
        <button
          type="button"
          disabled={!draft.valuationDate || !draft.marketValue.trim() || addMutation.isPending}
          onClick={() => addMutation.mutate(false)}
          className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t('valuations.add')}
        </button>
      </div>

      {listQuery.isLoading && <LoadingState />}

      {listQuery.data && items.length === 0 && (
        <p className="py-2 text-sm text-[var(--color-content-muted)]">{t('valuations.empty')}</p>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-[var(--color-content-muted)]">{formatDate(item.valuationDate)}</span>
              <span className="font-mono tabular-nums">
                {formatNumber(item.marketValue, { maximumFractionDigits: 6 })}
              </span>
              <span className="flex-1 truncate text-xs text-[var(--color-content-muted)]">
                {item.note ?? ''}
              </span>
              <button
                type="button"
                onClick={async () => {
                  const ok = await confirm({
                    title: t('valuations.delete'),
                    message: t('valuations.delete_confirm'),
                    tone: 'danger',
                  });
                  if (ok) removeMutation.mutate(item.id);
                }}
                className="rounded-lg p-1 text-[var(--color-negative)] hover:bg-[var(--color-negative)]/10 disabled:opacity-50"
                aria-label={t('valuations.delete')}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
