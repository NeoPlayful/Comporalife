import { accountsApi } from '@/lib/accounts';
import type { GoalDetail, GoalFundingSource, GoalInput, GoalType } from '@/lib/goals';
import { portfoliosApi } from '@/lib/portfolios';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const GOAL_TYPES: GoalType[] = [
  'savings',
  'purchase',
  'education',
  'retirement',
  'emergency_fund',
  'financial_independence',
  'custom',
];

const FUNDING_SOURCES: GoalFundingSource[] = ['net_worth', 'account', 'portfolio'];

interface Props {
  initial?: GoalDetail['goal'] & { targetAmount?: string };
  onSubmit: (body: GoalInput) => void;
  onCancel: () => void;
  submitting?: boolean;
  error?: string | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function GoalForm({ initial, onSubmit, onCancel, submitting, error }: Props) {
  const { t } = useTranslation('goals');

  const [form, setForm] = useState<GoalInput>({
    name: initial?.name ?? '',
    type: initial?.type ?? 'savings',
    targetAmount: initial?.targetAmount ?? '',
    currency: initial?.currency ?? 'CNY',
    targetDate: initial?.targetDate ?? null,
    startedAt: initial?.startedAt ?? today(),
    initialAmount: initial?.initialAmount ?? '0',
    inflationAdjusted: initial?.inflationAdjusted ?? false,
    inflationRate: initial?.inflationRate ?? '0.025',
    expectedAnnualReturn: initial?.expectedAnnualReturn ?? '',
    monthlyContribution: initial?.monthlyContribution ?? '',
    fundingSource: initial?.fundingSource ?? 'net_worth',
    accountId: initial?.accountId ?? null,
    portfolioId: initial?.portfolioId ?? null,
    priority: initial?.priority ?? 1,
    note: initial?.note ?? null,
  });

  const accountsQuery = useQuery({ queryKey: ['accounts', 'active'], queryFn: () => accountsApi.list({ status: 'active' as const }) });
  const portfoliosQuery = useQuery({ queryKey: ['portfolios', 'active'], queryFn: () => portfoliosApi.list('active') });

  const patch = (values: Partial<GoalInput>) => setForm((prev) => ({ ...prev, ...values }));

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({
      ...form,
      targetAmount: form.targetAmount || '0',
      targetDate: form.targetDate || null,
      inflationRate: form.inflationAdjusted ? form.inflationRate || null : null,
      expectedAnnualReturn: form.expectedAnnualReturn || null,
      monthlyContribution: form.monthlyContribution || null,
      accountId: form.fundingSource === 'account' ? form.accountId : null,
      portfolioId: form.fundingSource === 'portfolio' ? form.portfolioId : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-[var(--color-border-subtle)] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('form.name')}>
          <input
            required
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            maxLength={80}
            className="input"
          />
        </Field>

        <Field label={t('form.type')}>
          <select
            value={form.type}
            onChange={(event) => patch({ type: event.target.value as GoalType })}
            className="input"
          >
            {GOAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`enums:goal_type.${type}`, { defaultValue: type })}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('form.target_amount')}>
          <input
            required
            inputMode="decimal"
            value={form.targetAmount}
            onChange={(event) => patch({ targetAmount: event.target.value })}
            className="input tabular-nums"
          />
        </Field>

        <Field label={t('form.currency')}>
          <input
            value={form.currency}
            onChange={(event) => patch({ currency: event.target.value.toUpperCase().slice(0, 3) })}
            className="input uppercase"
            maxLength={3}
          />
        </Field>

        <Field label={t('form.started_at')}>
          <input
            type="date"
            value={form.startedAt}
            onChange={(event) => patch({ startedAt: event.target.value })}
            className="input"
          />
        </Field>

        <Field label={t('form.target_date')}>
          <input
            type="date"
            value={form.targetDate ?? ''}
            onChange={(event) => patch({ targetDate: event.target.value || null })}
            className="input"
          />
        </Field>

        <Field label={t('form.initial_amount')}>
          <input
            inputMode="decimal"
            value={form.initialAmount}
            onChange={(event) => patch({ initialAmount: event.target.value })}
            className="input tabular-nums"
          />
        </Field>

        <Field label={t('form.priority')}>
          <input
            type="number"
            min={1}
            max={999}
            value={form.priority}
            onChange={(event) => patch({ priority: Number(event.target.value) })}
            className="input"
          />
        </Field>
      </div>

      <fieldset className="space-y-3 rounded-lg border border-[var(--color-border-subtle)] p-3">
        <legend className="px-1 text-xs text-[var(--color-content-muted)]">{t('form.funding')}</legend>

        <div className="flex flex-wrap gap-3">
          {FUNDING_SOURCES.map((source) => (
            <label key={source} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="fundingSource"
                checked={form.fundingSource === source}
                onChange={() => patch({ fundingSource: source })}
              />
              {t(`enums:goal_funding_source.${source}`, { defaultValue: source })}
            </label>
          ))}
        </div>

        {form.fundingSource === 'account' && (
          <select
            value={form.accountId ?? ''}
            onChange={(event) => patch({ accountId: event.target.value || null })}
            className="input"
            required
          >
            <option value="">{t('form.select_account')}</option>
            {(accountsQuery.data?.accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
        )}

        {form.fundingSource === 'portfolio' && (
          <select
            value={form.portfolioId ?? ''}
            onChange={(event) => patch({ portfolioId: event.target.value || null })}
            className="input"
            required
          >
            <option value="">{t('form.select_portfolio')}</option>
            {(portfoliosQuery.data?.items ?? []).map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name} ({portfolio.currency})
              </option>
            ))}
          </select>
        )}

        <p className="text-xs text-[var(--color-content-muted)]">{t('form.funding_hint')}</p>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-[var(--color-border-subtle)] p-3">
        <legend className="px-1 text-xs text-[var(--color-content-muted)]">{t('form.assumptions')}</legend>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.inflationAdjusted}
            onChange={(event) => patch({ inflationAdjusted: event.target.checked })}
          />
          {t('form.inflation_adjusted')}
        </label>

        {form.inflationAdjusted && (
          <Field label={t('form.inflation_rate')}>
            <input
              inputMode="decimal"
              value={form.inflationRate ?? ''}
              onChange={(event) => patch({ inflationRate: event.target.value })}
              className="input tabular-nums"
            />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('form.expected_return')} hint={t('form.expected_return_hint')}>
            <input
              inputMode="decimal"
              value={form.expectedAnnualReturn ?? ''}
              onChange={(event) => patch({ expectedAnnualReturn: event.target.value })}
              className="input tabular-nums"
              placeholder="0.06"
            />
          </Field>

          <Field label={t('form.monthly_contribution')}>
            <input
              inputMode="decimal"
              value={form.monthlyContribution ?? ''}
              onChange={(event) => patch({ monthlyContribution: event.target.value })}
              className="input tabular-nums"
            />
          </Field>
        </div>
      </fieldset>

      <Field label={t('form.note')}>
        <textarea
          value={form.note ?? ''}
          onChange={(event) => patch({ note: event.target.value || null })}
          maxLength={500}
          rows={2}
          className="input"
        />
      </Field>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
          {t('common:actions.cancel', { ns: 'common' })}
        </button>
        <button type="submit" disabled={submitting} className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {submitting ? t('common:state.saving', { ns: 'common' }) : t('form.submit')}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs text-[var(--color-content-muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--color-content-muted)]">{hint}</span>}
    </label>
  );
}
