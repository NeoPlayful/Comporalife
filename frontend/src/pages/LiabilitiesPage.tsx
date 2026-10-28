import CurrencySelect from '@/components/finance/CurrencySelect';
import MoneyDisplay from '@/components/finance/MoneyDisplay';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import { translateError } from '@/lib/error-message';
import { toastError, toastSuccess } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { liabilitiesApi, type Liability, type LiabilityKind } from '@/lib/liabilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const LIABILITY_KINDS: LiabilityKind[] = ['mortgage', 'consumer_loan', 'auto_loan', 'credit_line', 'other'];

function LiabilityForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('liabilities');
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    kind: 'mortgage' as LiabilityKind,
    currency: 'CNY',
    originalAmount: '',
    startDate: '',
    interestRate: '',
    note: '',
  });

  const create = useMutation({
    mutationFn: () =>
      liabilitiesApi.create({
        name: form.name.trim(),
        kind: form.kind,
        currency: form.currency,
        originalAmount: form.originalAmount || null,
        startDate: form.startDate || null,
        interestRate: form.interestRate || null,
        note: form.note || null,
      }),
    onSuccess: () => {
      toastSuccess(t('common:feedback.created'));
      void queryClient.invalidateQueries({ queryKey: ['liabilities'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const dirty =
    form.name.trim() !== '' ||
    form.originalAmount !== '' ||
    form.startDate !== '' ||
    form.interestRate !== '' ||
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
            form="liability-create-form"
            className="rounded-lg btn-action px-3 py-2 text-sm font-medium"
            disabled={create.isPending}
          >
            {create.isPending ? t('form.saving') : t('form.save')}
          </button>
        </>
      }
    >
      <form
        id="liability-create-form"
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.name.trim()) {
            toastError(t('common:validation.required', { field: t('form.name') }));
            return;
          }
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
            onChange={(event) => setForm({ ...form, kind: event.target.value as LiabilityKind })}
          >
            {LIABILITY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t('form.currency')}
          <CurrencySelect
            className="mt-1"
            value={form.currency}
            onChange={(currency) => setForm({ ...form, currency })}
          />
        </label>
        <label className="text-sm">
          {t('form.original_amount')}
          <input
            className="input mt-1"
            inputMode="decimal"
            value={form.originalAmount}
            onChange={(event) => setForm({ ...form, originalAmount: event.target.value })}
          />
          <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
            {t('form.reference_only')}
          </span>
        </label>
        <label className="text-sm">
          {t('form.start_date')}
          <input
            type="date"
            className="input mt-1"
            value={form.startDate}
            onChange={(event) => setForm({ ...form, startDate: event.target.value })}
          />
        </label>
        <label className="text-sm">
          {t('form.interest_rate')}
          <input
            className="input mt-1"
            inputMode="decimal"
            placeholder="0.049"
            value={form.interestRate}
            onChange={(event) => setForm({ ...form, interestRate: event.target.value })}
          />
          <span className="mt-1 block text-xs text-[var(--color-content-muted)]">
            {t('form.reference_only')}
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

function SnapshotRow({ liability }: { liability: Liability }) {
  const { t } = useTranslation('liabilities');
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    snapshotDate: new Date().toISOString().slice(0, 10),
    balance: '',
  });

  const detail = useQuery({
    queryKey: ['liabilities', liability.id, 'snapshots'],
    queryFn: () => liabilitiesApi.detail(liability.id),
    enabled: open,
  });

  const add = useMutation({
    mutationFn: (overwrite: boolean) =>
      liabilitiesApi.addSnapshot(liability.id, {
        snapshotDate: form.snapshotDate,
        balance: form.balance,
        overwrite,
      }),
    onSuccess: () => {
      toastSuccess(t('common:feedback.saved'));
      void queryClient.invalidateQueries({ queryKey: ['liabilities'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setForm({ ...form, balance: '' });
      setError(null);
    },
    onError: async (err) => {
      const message = translateError(err, t);
      if (message.includes('LIABILITY_SNAPSHOT_EXISTS') || message.includes('覆盖')) {
        const ok = await confirm({
          title: t('snapshot.overwrite_confirm'),
          message: t('snapshot.overwrite_confirm'),
        });
        if (ok) {
          add.mutate(true);
          return;
        }
      }
      setError(message);
    },
  });

  const removeSnapshot = useMutation({
    mutationFn: (snapshotId: string) => liabilitiesApi.removeSnapshot(liability.id, snapshotId),
    onSuccess: () => {
      toastSuccess(t('common:feedback.deleted'));
      void queryClient.invalidateQueries({ queryKey: ['liabilities'] });
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
        {t('snapshot.title', { count: liability.snapshotCount })}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              {t('snapshot.date')}
              <input
                type="date"
                className="input mt-1"
                value={form.snapshotDate}
                onChange={(event) => setForm({ ...form, snapshotDate: event.target.value })}
              />
            </label>
            <label className="text-xs">
              {t('snapshot.balance')}
              <input
                className="input mt-1 w-32"
                inputMode="decimal"
                value={form.balance}
                onChange={(event) => setForm({ ...form, balance: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-xs"
              disabled={add.isPending || !form.balance}
              onClick={() => add.mutate(false)}
            >
              {t('snapshot.add')}
            </button>
          </div>

          {detail.isLoading && <LoadingState />}
          {detail.data && detail.data.liability.snapshots.length === 0 && (
            <p className="text-xs text-[var(--color-content-muted)]">{t('snapshot.empty')}</p>
          )}
          {detail.data && detail.data.liability.snapshots.length > 0 && (
            <ul className="divide-y divide-[var(--color-border-subtle)] text-xs">
              {detail.data.liability.snapshots.map((item) => (
                <li key={item.id} className="flex items-center justify-between py-1.5">
                  <span>
                    {formatDate(item.snapshotDate)} ·{' '}
                    <MoneyDisplay amount={item.balance} currency={liability.currency} />
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSnapshot.mutate(item.id)}
                    className="text-[var(--color-content-muted)] hover:text-red-600"
                    aria-label={t('snapshot.remove')}
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

export default function LiabilitiesPage() {
  const { t } = useTranslation('liabilities');
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['liabilities', showArchived],
    queryFn: () => liabilitiesApi.list({ status: showArchived ? 'all' : 'active' }),
  });

  const summaryQuery = useQuery({
    queryKey: ['liabilities', 'summary'],
    queryFn: () => liabilitiesApi.summary(),
  });

  const archive = useMutation({
    mutationFn: (id: string) => liabilitiesApi.archive(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.archived'));
      void queryClient.invalidateQueries({ queryKey: ['liabilities'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg btn-action px-3 py-2 text-sm font-medium"
          onClick={() => setFormOpen(true)}
        >
          <Plus className="size-4" />
          {t('new_liability')}
        </button>
      </header>

      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
        {t('notice_no_account')}
      </p>

      {formOpen && <LiabilityForm onClose={() => setFormOpen(false)} />}

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
                  {t(`kinds.${item.kind}`)}{' '}
                  <MoneyDisplay amount={item.amount} currency={summaryQuery.data.baseCurrency} />
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
        />
        {t('show_archived')}
      </label>

      {listQuery.isLoading && <LoadingState />}
      {listQuery.isError && <ErrorState onRetry={() => void listQuery.refetch()} />}

      {listQuery.data && listQuery.data.liabilities.length === 0 && (
        <EmptyState
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <button
              type="button"
              className="rounded-lg btn-action px-4 py-2 text-sm font-medium"
              onClick={() => setFormOpen(true)}
            >
              {t('new_liability')}
            </button>
          }
        />
      )}

      {listQuery.data && listQuery.data.liabilities.length > 0 && (
        <ul className="space-y-2">
          {listQuery.data.liabilities.map((liability) => (
            <li key={liability.id} className="card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {liability.name}
                    <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                      {t(`kinds.${liability.kind}`)}
                    </span>
                    {liability.status === 'archived' && (
                      <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
                        {t('archived_badge')}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                    {liability.latestSnapshot
                      ? t('latest_snapshot', {
                          date: formatDate(liability.latestSnapshot.snapshotDate),
                          balance: liability.latestSnapshot.balance,
                          currency: liability.currency,
                        })
                      : t('never_snapshotted')}
                  </p>
                  {liability.interestRate && (
                    <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                      {t('interest_rate_ref', {
                        rate: (Number(liability.interestRate) * 100).toFixed(2),
                      })}
                    </p>
                  )}
                </div>

                {liability.status === 'active' && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] px-2 py-1 text-xs"
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('archive'),
                        message: t('archive_confirm', { name: liability.name }),
                        tone: 'danger',
                      });
                      if (ok) archive.mutate(liability.id);
                    }}
                  >
                    <Archive className="size-3.5" />
                    {t('archive')}
                  </button>
                )}
              </div>

              {liability.status === 'active' && <SnapshotRow liability={liability} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
