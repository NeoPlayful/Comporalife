import BudgetCarryoverNote from '@/components/budgets/BudgetCarryoverNote';
import BudgetItemEditor, { type DraftItem } from '@/components/budgets/BudgetItemEditor';
import BudgetProgressBar from '@/components/budgets/BudgetProgressBar';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import { budgetsApi, type BudgetProgressResponse, type BudgetPeriodType } from '@/lib/budgets';
import { categoriesApi, type CategoryNode } from '@/lib/categories';
import { translateError } from '@/lib/error-message';
import { toastSuccess } from '@/lib/toast';
import { formatNumber } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

interface Period {
  periodType: BudgetPeriodType;
  year: number;
  month: number;
}

function shiftPeriod(period: Period, delta: number): Period {
  if (period.periodType === 'yearly') {
    return { ...period, year: period.year + delta, month: 0 };
  }

  const index = period.year * 12 + (period.month - 1) + delta;
  return {
    periodType: 'monthly',
    year: Math.floor(index / 12),
    month: (index % 12 + 12) % 12 + 1,
  };
}

function currentPeriod(periodType: BudgetPeriodType): Period {
  const now = new Date();
  return {
    periodType,
    year: now.getFullYear(),
    month: periodType === 'yearly' ? 0 : now.getMonth() + 1,
  };
}

function periodLabel(period: Period): string {
  if (period.periodType === 'yearly') return String(period.year);
  return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

interface FormState {
  totalAmount: string;
  rollover: boolean;
  note: string;
  items: DraftItem[];
}

export default function BudgetsPage() {
  const { t } = useTranslation('budgets');
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [period, setPeriod] = useState<Period>(() => currentPeriod('monthly'));
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>({ totalAmount: '', rollover: false, note: '', items: [] });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['budgets', period],
    queryFn: () => budgetsApi.summary(period),
    retry: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', 'tree', 'expense'],
    queryFn: () => categoriesApi.tree('expense'),
    enabled: editing || creating,
  });

  // 当前周期的超支与接近超支项：接口早已存在，这里补上入口
  const alertsQuery = useQuery({
    queryKey: ['budgets', 'alerts'],
    queryFn: () => budgetsApi.alerts(),
  });

  const expenseCategories: CategoryNode[] = categoriesQuery.data?.flat
    ? categoriesQuery.data.flat
        .filter((item) => !item.archived)
        .map((item) => ({ ...item, children: [] }))
    : [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['budgets'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      budgetsApi.create({
        ...period,
        totalAmount: form.totalAmount || null,
        rollover: form.rollover,
        note: form.note || null,
        items: form.items
          .filter((item) => item.categoryId && item.amount)
          .map((item) => ({ categoryId: item.categoryId, amount: item.amount })),
      }),
    onSuccess: () => {
      toastSuccess(t('common:feedback.created'));
      setCreating(false);
      setEditing(false);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      budgetsApi.update(data!.budget.id, {
        version: data!.budget.version,
        totalAmount: form.totalAmount || null,
        rollover: form.rollover,
        note: form.note || null,
        items: form.items
          .filter((item) => item.categoryId && item.amount)
          .map((item) => ({ categoryId: item.categoryId, amount: item.amount })),
      }),
    onSuccess: () => {
      toastSuccess(t('common:feedback.saved'));
      setEditing(false);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const copyMutation = useMutation({
    mutationFn: () => budgetsApi.copy(data!.budget.id),
    onSuccess: (response) => {
      setPeriod({
        periodType: response.budget.periodType,
        year: response.budget.year,
        month: response.budget.month,
      });
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => budgetsApi.remove(data!.budget.id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.deleted'));
      invalidate();
      void refetch();
    },
  });

  function startEdit(budget: BudgetProgressResponse) {
    setForm({
      totalAmount: budget.budget.totalAmount ? String(Number(budget.budget.totalAmount)) : '',
      rollover: budget.budget.rollover,
      note: budget.budget.note ?? '',
      items: budget.items.map((item) => ({
        categoryId: item.categoryId,
        amount: String(Number(item.amount)),
      })),
    });
    setError(null);
    setEditing(true);
  }

  function startCreate() {
    setForm({ totalAmount: '', rollover: false, note: '', items: [] });
    setError(null);
    setCreating(true);
  }

  function closeForm() {
    setEditing(false);
    setCreating(false);
    setError(null);
  }

  // 编辑态从已有数据起步，打开即「有内容」，只有新建时才把填过的字段当作脏数据
  const hasFormInput =
    !editing &&
    (form.totalAmount !== '' ||
      form.note !== '' ||
      form.rollover ||
      form.items.some((item) => item.categoryId !== '' || item.amount !== ''));

  const currency = data?.basis.baseCurrency ?? 'CNY';
  const label = periodLabel(period);
  const alerts = alertsQuery.data?.alerts ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('description')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('period.label')}
            value={period.periodType}
            onChange={(event) => setPeriod(currentPeriod(event.target.value as BudgetPeriodType))}
            className="rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="monthly">{t('period.monthly')}</option>
            <option value="yearly">{t('period.yearly')}</option>
          </select>

          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t('period.previous')}
              onClick={() => setPeriod(shiftPeriod(period, -1))}
              className="rounded-lg p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span className="min-w-20 text-center text-sm tabular-nums">{label}</span>
            <button
              type="button"
              aria-label={t('period.next')}
              onClick={() => setPeriod(shiftPeriod(period, 1))}
              className="rounded-lg p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {/* 无预警时不渲染整块，避免留下空白占位 */}
      {alerts.length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-medium">{t('alerts.title')}</h2>
          <ul className="space-y-1.5 text-sm">
            {alerts.map((alert) => (
              <li
                key={`${alert.budgetId}:${alert.scope}:${alert.categoryId ?? 'total'}`}
                className={
                  alert.level === 'exceeded'
                    ? 'text-[var(--color-negative)]'
                    : 'text-amber-600 dark:text-amber-400'
                }
              >
                {alert.scope === 'total'
                  ? t(alert.level === 'exceeded' ? 'alerts.total_exceeded' : 'alerts.total_warning', {
                      spent: formatNumber(alert.spent),
                      available: formatNumber(alert.available),
                      currency,
                    })
                  : t(alert.level === 'exceeded' ? 'alerts.category_exceeded' : 'alerts.category_warning', {
                      name: alert.categoryName ?? '',
                      spent: formatNumber(alert.spent),
                      available: formatNumber(alert.available),
                      currency,
                    })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        // 该周期没有预算时给出创建引导，而不是报错页
        <div className="card">
          <EmptyState
            title={t('not_found_title')}
            description={t('not_found_description')}
            action={
              <button
                type="button"
                onClick={startCreate}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                {t('empty_action')}
              </button>
            }
          />
        </div>
      ) : !data ? (
        <div className="card">
          <EmptyState title={t('empty_title')} description={t('empty_description')} action={
            <button
              type="button"
              onClick={startCreate}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
            >
              {t('empty_action')}
            </button>
          } />
        </div>
      ) : (
        <>
          <section className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs text-[var(--color-content-muted)]">{t('summary.available')}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {data.budget.totalAmount
                    ? `${formatNumber(data.total.available)} ${currency}`
                    : t('summary.no_total')}
                </p>
                {!data.budget.totalAmount && (
                  <p className="mt-1 text-xs text-[var(--color-content-muted)]">{t('summary.no_total_hint')}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(data)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Pencil className="size-4" aria-hidden />
                  {t('form.edit')}
                </button>
                <button
                  type="button"
                  disabled={copyMutation.isPending}
                  onClick={() => copyMutation.mutate()}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--color-content-muted)] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
                >
                  <Copy className="size-4" aria-hidden />
                  {t('copy.action')}
                </button>
                <button
                  type="button"
                  disabled={deleteMutation.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('form.confirm_delete'),
                      message: t('form.delete_hint'),
                      tone: 'danger',
                    });
                    if (ok) deleteMutation.mutate();
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--color-negative)] hover:bg-[var(--color-negative)]/10 disabled:opacity-50"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            {data.budget.totalAmount && (
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-[var(--color-content-muted)]">{t('items.amount')}</p>
                  <p className="mt-1 tabular-nums">{formatNumber(data.total.amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-content-muted)]">{t('summary.carry_in')}</p>
                  <p className="mt-1 tabular-nums">{formatNumber(data.total.carryIn)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-content-muted)]">{t('summary.spent')}</p>
                  <p className="mt-1 tabular-nums">{formatNumber(data.total.spent)}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--color-content-muted)]">{t('summary.remaining')}</p>
                  <p className="mt-1 tabular-nums">{formatNumber(data.total.remaining)}</p>
                </div>
              </div>
            )}

            {data.budget.totalAmount && (
              <BudgetProgressBar usageRatio={data.total.usageRatio} level={data.total.level} />
            )}

            <BudgetCarryoverNote
              rollover={data.budget.rollover}
              chain={Number(data.basis.rolloverChain ?? 0)}
              truncated={data.total.carryoverTruncated}
            />

            {Number(data.uncategorizedSpent) > 0 && (
              <p className="rounded-lg bg-[var(--color-warning)]/10 px-3 py-2 text-sm">
                <span className="font-medium">
                  {t('uncategorized.title', { amount: `${formatNumber(data.uncategorizedSpent)} ${currency}` })}
                </span>
                <span className="ml-1 text-[var(--color-content-muted)]">{t('uncategorized.hint')}</span>{' '}
                <Link to="/transactions?uncategorized=true" className="underline">
                  {t('uncategorized.action')}
                </Link>
              </p>
            )}
          </section>

          <section className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-medium">{t('items.title')}</h2>
              <button
                type="button"
                onClick={() => startEdit(data)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
              >
                <Plus className="size-4" aria-hidden />
                {t('items.add')}
              </button>
            </div>

            {data.items.length === 0 ? (
              <EmptyState title={t('items.empty')} description={t('items.empty_hint')} />
            ) : (
              <ul className="space-y-4">
                {data.items.map((item) => (
                  <li key={item.itemId} className="space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">
                        {item.categoryName}
                        {item.childCategoryIds.length > 0 && (
                          <span className="ml-2 text-xs font-normal text-[var(--color-content-muted)]">
                            {t('items.child_note', { count: item.childCategoryIds.length })}
                          </span>
                        )}
                      </p>
                      <p className="text-sm tabular-nums text-[var(--color-content-muted)]">
                        {formatNumber(item.spent)} / {formatNumber(item.available)} {currency}
                        {Number(item.carryIn) > 0 && (
                          <span className="ml-2">
                            {t('summary.carry_in')} {formatNumber(item.carryIn)}
                          </span>
                        )}
                      </p>
                    </div>
                    <BudgetProgressBar usageRatio={item.usageRatio} level={item.level} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Modal
        open={creating || editing}
        title={editing ? t('form.edit') : t('form.create')}
        description={editing ? undefined : periodLabel(period)}
        size="xl"
        dirty={editing ? false : hasFormInput}
        busy={createMutation.isPending || updateMutation.isPending}
        onClose={closeForm}
        footer={
          <>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('form.cancel')}
            </button>
            <button
              type="button"
              disabled={createMutation.isPending || updateMutation.isPending}
              onClick={() => (editing ? updateMutation.mutate() : createMutation.mutate())}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {createMutation.isPending || updateMutation.isPending
                ? t('form.saving')
                : t('form.save')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <p className="text-sm text-[var(--color-negative)]">{error}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-[var(--color-content-muted)]">{t('form.total_amount')}</span>
              <input
                data-autofocus
                type="number"
                min="0"
                step="0.01"
                value={form.totalAmount}
                onChange={(event) => setForm({ ...form, totalAmount: event.target.value })}
                className="input tabular-nums"
              />
              <span className="block text-xs text-[var(--color-content-muted)]">
                {t('form.total_amount_hint')}
              </span>
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-[var(--color-content-muted)]">{t('form.note')}</span>
              <input
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                className="input"
              />
            </label>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.rollover}
              disabled={period.periodType === 'yearly'}
              onChange={(event) => setForm({ ...form, rollover: event.target.checked })}
              className="mt-0.5"
            />
            <span>
              {t('form.rollover')}
              <span className="block text-xs text-[var(--color-content-muted)]">
                {period.periodType === 'yearly'
                  ? t('form.rollover_yearly_disabled')
                  : t('form.rollover_hint')}
              </span>
            </span>
          </label>

          <BudgetItemEditor
            items={form.items}
            categories={expenseCategories}
            onChange={(items) => setForm({ ...form, items })}
          />
        </div>
      </Modal>
    </div>
  );
}
