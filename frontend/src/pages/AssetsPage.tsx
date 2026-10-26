import MoneyDisplay from '@/components/finance/MoneyDisplay';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import { assetsApi, type Asset, type AssetKind, type ValuationBasis } from '@/lib/assets';
import { translateError } from '@/lib/error-message';
import { formatDate } from '@/lib/format';
import { CURRENCY_DECIMALS } from '@/utils/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const ASSET_KINDS: AssetKind[] = ['property', 'vehicle', 'collectible', 'other'];
const VALUATION_BASES: ValuationBasis[] = ['manual', 'appraised', 'market'];

/** 资产与账户的分界必须写清楚：建错地方会导致净资产重复计算 */
function DuplicateGuardNotice() {
  const { t } = useTranslation('assets');
  return (
    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
      {t('notice_no_account')}
    </p>
  );
}

function AssetForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('assets');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    kind: 'property' as AssetKind,
    currency: 'CNY',
    purchaseDate: '',
    purchasePrice: '',
    note: '',
  });

  const create = useMutation({
    mutationFn: () =>
      assetsApi.create({
        name: form.name.trim(),
        kind: form.kind,
        currency: form.currency,
        purchaseDate: form.purchaseDate || null,
        purchasePrice: form.purchasePrice || null,
        note: form.note || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  // 只要动过任何一个字段就算脏，关闭前需要确认，避免误触遮罩把填好的内容丢掉
  const dirty =
    form.name.trim() !== '' ||
    form.purchaseDate !== '' ||
    form.purchasePrice !== '' ||
    form.note !== '';

  return (
    <Modal
      open
      title={t('form.title')}
      dirty={dirty}
      busy={create.isPending}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
          >
            {t('form.cancel')}
          </button>
          <button
            type="submit"
            form="asset-create-form"
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={create.isPending || !form.name.trim()}
          >
            {create.isPending ? t('form.saving') : t('form.save')}
          </button>
        </>
      }
    >
      <form
        id="asset-create-form"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.name.trim()) return;
          create.mutate();
        }}
      >
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          {t('form.name')}
          <input
            className="input mt-1"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            maxLength={80}
          />
        </label>
        <label className="text-sm">
          {t('form.kind')}
          <select
            className="input mt-1"
            value={form.kind}
            onChange={(event) => setForm({ ...form, kind: event.target.value as AssetKind })}
          >
            {ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t('form.currency')}
          <select
            className="input mt-1"
            value={form.currency}
            onChange={(event) => setForm({ ...form, currency: event.target.value })}
          >
            {Object.keys(CURRENCY_DECIMALS).map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t('form.purchase_date')}
          <input
            type="date"
            className="input mt-1"
            value={form.purchaseDate}
            onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })}
          />
        </label>
        <label className="text-sm">
          {t('form.purchase_price')}
          <input
            className="input mt-1"
            inputMode="decimal"
            value={form.purchasePrice}
            onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })}
          />
          <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
            {t('form.purchase_price_hint')}
          </span>
        </label>
        <label className="text-sm sm:col-span-2">
          {t('form.note')}
          <input
            className="input mt-1"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
            maxLength={500}
          />
        </label>
        </div>
      </form>
    </Modal>
  );
}

function ValuationRow({ asset }: { asset: Asset }) {
  const { t } = useTranslation('assets');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    valuationDate: new Date().toISOString().slice(0, 10),
    value: '',
    basis: 'manual' as ValuationBasis,
    note: '',
  });

  const detail = useQuery({
    queryKey: ['assets', asset.id, 'valuations'],
    queryFn: () => assetsApi.detail(asset.id),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: (overwrite: boolean) =>
      assetsApi.addValuation(asset.id, {
        valuationDate: form.valuationDate,
        value: form.value,
        basis: form.basis,
        note: form.note || null,
        overwrite,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setForm({ ...form, value: '' });
      setError(null);
    },
    onError: (err) => {
      const message = translateError(err, t);
      // 同日已存在时提示用户可以覆盖，而不是让用户猜
      if (message.includes('ASSET_VALUATION_EXISTS') || message.includes('覆盖')) {
        if (window.confirm(t('valuation.overwrite_confirm'))) {
          add.mutate(true);
          return;
        }
      }
      setError(message);
    },
  });

  const removeValuation = useMutation({
    mutationFn: (valuationId: string) => assetsApi.removeValuation(asset.id, valuationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <div className="mt-2 border-t border-[var(--color-border-subtle)] pt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-[var(--color-content-muted)]"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {t('valuation.title', { count: asset.valuationCount })}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              {t('valuation.date')}
              <input
                type="date"
                className="input mt-1"
                value={form.valuationDate}
                onChange={(event) => setForm({ ...form, valuationDate: event.target.value })}
              />
            </label>
            <label className="text-xs">
              {t('valuation.value')}
              <input
                className="input mt-1 w-32"
                inputMode="decimal"
                value={form.value}
                onChange={(event) => setForm({ ...form, value: event.target.value })}
              />
            </label>
            <label className="text-xs">
              {t('valuation.basis')}
              <select
                className="input mt-1"
                value={form.basis}
                onChange={(event) => setForm({ ...form, basis: event.target.value as ValuationBasis })}
              >
                {VALUATION_BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {t(`bases.${basis}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs"
              disabled={add.isPending || !form.value}
              onClick={() => add.mutate(false)}
            >
              {t('valuation.add')}
            </button>
          </div>

          {detail.isLoading && <LoadingState />}
          {detail.data && detail.data.asset.valuations.length === 0 && (
            <p className="text-xs text-[var(--color-content-muted)]">{t('valuation.empty')}</p>
          )}
          {detail.data && detail.data.asset.valuations.length > 0 && (
            <ul className="divide-y divide-[var(--color-border-subtle)] text-xs">
              {detail.data.asset.valuations.map((item) => (
                <li key={item.id} className="flex items-center justify-between py-1.5">
                  <span>
                    {formatDate(item.valuationDate)} ·{' '}
                    <MoneyDisplay amount={item.value} currency={asset.currency} /> · {t(`bases.${item.basis}`)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeValuation.mutate(item.id)}
                    className="text-[var(--color-content-muted)] hover:text-red-600"
                    aria-label={t('valuation.remove')}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function AssetsPage() {
  const { t } = useTranslation('assets');
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['assets', showArchived],
    queryFn: () => assetsApi.list({ status: showArchived ? 'all' : 'active' }),
  });

  const summaryQuery = useQuery({ queryKey: ['assets', 'summary'], queryFn: () => assetsApi.summary() });

  const archive = useMutation({
    mutationFn: (id: string) => assetsApi.archive(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
        </div>
        <button type="button" className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white" onClick={() => setFormOpen(true)}>
          <Plus className="size-4" />
          {t('new_asset')}
        </button>
      </header>

      <DuplicateGuardNotice />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {formOpen && <AssetForm onClose={() => setFormOpen(false)} />}

      {/* 汇总分三栏：未录估值与缺汇率的资产必须显式列出 */}
      {summaryQuery.data && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm text-[var(--color-content-muted)]">{t('summary.total')}</span>
            <MoneyDisplay
              amount={summaryQuery.data.total}
              currency={summaryQuery.data.baseCurrency}
              className="text-lg font-semibold"
            />
          </div>

          {summaryQuery.data.byKind.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-content-muted)]">
              {summaryQuery.data.byKind.map((item) => (
                <span key={item.kind}>
                  {t(`kinds.${item.kind}`)} <MoneyDisplay amount={item.amount} currency={summaryQuery.data.baseCurrency} />
                </span>
              ))}
            </div>
          )}

          {summaryQuery.data.unpriced.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('summary.unpriced', {
                names: summaryQuery.data.unpriced.map((item) => item.name).join('、'),
              })}
            </p>
          )}
          {summaryQuery.data.missingRate.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('summary.missing_rate', {
                currencies: [...new Set(summaryQuery.data.missingRate.map((item) => item.currency))].join('、'),
              })}
            </p>
          )}

          <p className="text-xs text-[var(--color-content-muted)]">
            {t('summary.basis', {
              currency: summaryQuery.data.baseCurrency,
              date: formatDate(summaryQuery.data.basis.asOf),
            })}
          </p>
        </section>
      )}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          {t('show_archived')}
        </label>
      </div>

      {listQuery.isLoading && <LoadingState />}
      {listQuery.isError && <ErrorState onRetry={() => void listQuery.refetch()} />}

      {listQuery.data && listQuery.data.assets.length === 0 && (
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <button type="button" className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white" onClick={() => setFormOpen(true)}>
              {t('new_asset')}
            </button>
          }
        />
      )}

      {listQuery.data && listQuery.data.assets.length > 0 && (
        <ul className="space-y-2">
          {listQuery.data.assets.map((asset) => (
            <li key={asset.id} className="card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {asset.name}
                    <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                      {t(`kinds.${asset.kind}`)}
                    </span>
                    {asset.status === 'archived' && (
                      <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                        {t('archived_badge')}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                    {asset.latestValuation
                      ? t('latest_valuation', {
                          date: formatDate(asset.latestValuation.valuationDate),
                          value: asset.latestValuation.value,
                          currency: asset.currency,
                        })
                      : t('never_valued')}
                  </p>
                  {asset.stale && asset.latestValuation && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('stale_hint')}</p>
                  )}
                </div>

                {asset.status === 'active' && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                    onClick={() => {
                      if (window.confirm(t('archive_confirm', { name: asset.name }))) {
                        archive.mutate(asset.id);
                      }
                    }}
                  >
                    <Archive className="size-3.5" />
                    {t('archive')}
                  </button>
                )}
              </div>

              {asset.status === 'active' && <ValuationRow asset={asset} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
