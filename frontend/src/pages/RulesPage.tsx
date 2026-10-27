import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import Modal from '@/components/ui/Modal';
import { accountsApi } from '@/lib/accounts';
import { useEnumLabels } from '@/lib/enum-labels';
import { translateError } from '@/lib/error-message';
import { toastError } from '@/lib/toast';
import { toastSuccess } from '@/lib/toast';
import { categoriesApi } from '@/lib/categories';
import {
  classificationRulesApi,
  type ClassificationRule,
  type RuleActions,
  type RuleConditions,
} from '@/lib/imports';

export default function RulesPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { t } = useTranslation('imports');
  const [editing, setEditing] = useState<ClassificationRule | 'new' | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [testResult, setTestResult] = useState<{ rule: ClassificationRule; matched: number } | null>(null);

  const rulesQuery = useQuery({ queryKey: ['rules'], queryFn: () => classificationRulesApi.list() });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.tree() });
  const accountsQuery = useQuery({
    queryKey: ['accounts', 'all-for-rules'],
    queryFn: () => accountsApi.list({ status: 'all' }),
  });

  const saveRule = useMutation({
    mutationFn: (input: { rule: ClassificationRule | 'new'; payload: RulePayload }) =>
      input.rule === 'new'
        ? classificationRulesApi.create(input.payload)
        : classificationRulesApi.update(input.rule.id, input.payload),
    onSuccess: async () => {
      toastSuccess(t('common:feedback.saved'));
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  const toggleRule = useMutation({
    mutationFn: (rule: ClassificationRule) => classificationRulesApi.update(rule.id, { enabled: !rule.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });

  const removeRule = useMutation({
    mutationFn: (id: string) => classificationRulesApi.remove(id),
    onSuccess: () => {
      toastSuccess(t('common:feedback.deleted'));
      queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const testRule = useMutation({
    mutationFn: (rule: ClassificationRule) => classificationRulesApi.test(rule.id),
    onSuccess: (result, rule) => setTestResult({ rule, matched: result.matched }),
    onError: (err) => toastError(translateError(err, t)),
  });

  const applyRules = useMutation({
    mutationFn: () => classificationRulesApi.apply({ onlyUncategorized: true }),
    onSuccess: async (result) => {
      setTestResult(null);
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toastSuccess(t('rules.applied', { matched: result.matched, categorized: result.categorized }));
    },
    onError: (err) => toastError(translateError(err, t)),
  });

  if (rulesQuery.isPending) return <LoadingState label={t('rules.loading')} />;
  if (rulesQuery.error) {
    return <ErrorState message={t('rules.load_failed')} onRetry={() => void rulesQuery.refetch()} />;
  }

  const rules = rulesQuery.data.rules;
  const flatCategories = categoriesQuery.data?.flat ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('rules.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">{t('rules.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/imports" className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm">
            {t('rules.back')}
          </Link>
          <button
            type="button"
            disabled={applyRules.isPending || rules.length === 0}
            onClick={() => applyRules.mutate()}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {t('rules.apply_uncategorized')}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing('new');
              setEditorDirty(false);
            }}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            {t('rules.new')}
          </button>
        </div>
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? t('rules.editor.title_new') : t('rules.editor.title_edit')}
        size="xl"
        dirty={editorDirty}
        busy={saveRule.isPending}
        onClose={() => {
          setEditing(null);
          setEditorDirty(false);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setEditorDirty(false);
              }}
              className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
            >
              {t('rules.editor.cancel')}
            </button>
            <button
              type="submit"
              form="rule-editor-form"
              disabled={saveRule.isPending}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saveRule.isPending ? t('rules.editor.saving') : t('rules.editor.save')}
            </button>
          </>
        }
      >
        {editing && (
          <RuleEditor
            rule={editing === 'new' ? null : editing}
            categories={flatCategories}
            accounts={accounts}
            onSave={(payload) => saveRule.mutate({ rule: editing, payload })}
            onDirtyChange={setEditorDirty}
          />
        )}
      </Modal>

      {testResult && (
        <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-sm text-sky-500">
          {t('rules.test_result', { name: testResult.rule.name, count: testResult.matched })}
        </p>
      )}

      {rules.length === 0 ? (
        <EmptyState title={t('rules.empty_title')} description={t('rules.empty_description')} />
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="card flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{rule.name}</span>
                  <span className="rounded bg-black/10 px-1.5 py-0.5 text-xs dark:bg-white/10">
                    {t('rules.priority_badge', { priority: rule.priority })}
                  </span>
                  {!rule.enabled && (
                    <span className="text-xs text-[var(--color-content-muted)]">{t('rules.disabled')}</span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-content-muted)]">{describeRule(rule, t)}</p>
                <p className="text-xs text-[var(--color-content-muted)]">
                  {t('rules.match_count', { count: rule.matchCount })}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                <button type="button" onClick={() => toggleRule.mutate(rule)} className="text-[var(--color-accent)]">
                  {rule.enabled ? t('rules.toggle_disable') : t('rules.toggle_enable')}
                </button>
                <button type="button" onClick={() => testRule.mutate(rule)} className="text-[var(--color-accent)]">
                  {t('rules.test')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(rule);
                    setEditorDirty(false);
                  }}
                  className="text-[var(--color-accent)]"
                >
                  {t('rules.edit_action')}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      title: t('rules.delete'),
                      message: t('rules.delete_confirm'),
                      tone: 'danger',
                    });
                    if (ok) removeRule.mutate(rule.id);
                  }}
                  className="text-[var(--color-negative)]"
                >
                  {t('rules.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface RulePayload {
  name: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
}

function RuleEditor({
  rule,
  categories,
  accounts,
  onSave,
  onDirtyChange,
}: {
  rule: ClassificationRule | null;
  categories: Array<{ id: string; name: string; kind: string; parentId: string | null }>;
  accounts: Array<{ id: string; name: string }>;
  onSave: (payload: RulePayload) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation('imports');
  const { categoryKind } = useEnumLabels();
  const [name, setName] = useState(rule?.name ?? '');
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [merchant, setMerchant] = useState(rule?.conditions.merchant?.value ?? '');
  const [description, setDescription] = useState(rule?.conditions.description?.value ?? '');
  const [categoryId, setCategoryId] = useState(rule?.actions.categoryId ?? '');
  const [minAmount, setMinAmount] = useState(rule?.conditions.amount?.min ?? '');
  const [maxAmount, setMaxAmount] = useState(rule?.conditions.amount?.max ?? '');
  const [accountId, setAccountId] = useState(rule?.conditions.accountIds?.[0] ?? '');

  // 字段多且分散，逐个 setter 埋 onDirtyChange 容易漏；统一在渲染后比对初值
  useEffect(() => {
    const initial = rule;
    onDirtyChange(
      name !== (initial?.name ?? '') ||
        priority !== (initial?.priority ?? 100) ||
        merchant !== (initial?.conditions.merchant?.value ?? '') ||
        description !== (initial?.conditions.description?.value ?? '') ||
        categoryId !== (initial?.actions.categoryId ?? '') ||
        minAmount !== (initial?.conditions.amount?.min ?? '') ||
        maxAmount !== (initial?.conditions.amount?.max ?? '') ||
        accountId !== (initial?.conditions.accountIds?.[0] ?? ''),
    );
  }, [name, priority, merchant, description, categoryId, minAmount, maxAmount, accountId, rule, onDirtyChange]);

  function submit(event: React.FormEvent) {
    event.preventDefault();

    const conditions: RuleConditions = { logic: 'all' };
    if (merchant.trim()) conditions.merchant = { op: 'contains', value: merchant.trim() };
    if (description.trim()) conditions.description = { op: 'contains', value: description.trim() };
    if (accountId) conditions.accountIds = [accountId];
    if (minAmount || maxAmount) {
      conditions.amount = {
        ...(minAmount ? { min: minAmount } : {}),
        ...(maxAmount ? { max: maxAmount } : {}),
      };
    }

    const actions: RuleActions = {};
    if (categoryId) actions.categoryId = categoryId;

    onSave({ name: name.trim(), priority, enabled: rule?.enabled ?? true, conditions, actions });
  }

  return (
    <form onSubmit={submit} id="rule-editor-form" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('rules.editor.name')}>
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label={t('rules.editor.priority')}>
          <input
            type="number"
            min={0}
            max={9999}
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label={t('rules.editor.merchant')}>
          <input
            value={merchant}
            onChange={(event) => setMerchant(event.target.value)}
            placeholder={t('rules.editor.merchant_placeholder')}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label={t('rules.editor.description')}>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('rules.editor.description_placeholder')}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label={t('rules.editor.account')}>
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="">{t('rules.editor.all_accounts')}</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('rules.editor.category')}>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="">{t('rules.editor.no_category')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryKind(category.kind)} · {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('rules.editor.min_amount')}>
          <input
            value={minAmount}
            onChange={(event) => setMinAmount(event.target.value)}
            placeholder="0"
            inputMode="decimal"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label={t('rules.editor.max_amount')}>
          <input
            value={maxAmount}
            onChange={(event) => setMaxAmount(event.target.value)}
            placeholder={t('rules.editor.unlimited')}
            inputMode="decimal"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>
      </div>

      <p className="text-xs text-[var(--color-content-muted)]">{t('rules.editor.hint')}</p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs text-[var(--color-content-muted)]">{label}</span>
      {children}
    </label>
  );
}

function describeRule(rule: ClassificationRule, t: TFunction): string {
  const parts: string[] = [];
  const td = (key: string, options?: Record<string, unknown>) => t(`rules.describe.${key}`, options);

  if (rule.conditions.directions?.length) parts.push(rule.conditions.directions.join('/'));
  if (rule.conditions.merchant) parts.push(td('merchant', { value: rule.conditions.merchant.value }));
  if (rule.conditions.description) {
    parts.push(td('description', { value: rule.conditions.description.value }));
  }
  if (rule.conditions.amount) {
    parts.push(
      td('amount', {
        min: rule.conditions.amount.min ?? '0',
        max: rule.conditions.amount.max ?? '∞',
      }),
    );
  }
  if (rule.conditions.onlyUncategorized) parts.push(td('only_uncategorized'));
  if (rule.conditions.accountIds?.length) {
    parts.push(td('accounts', { count: rule.conditions.accountIds.length }));
  }

  const actions: string[] = [];
  if (rule.actions.categoryId) actions.push(td('set_category'));
  if (rule.actions.addTagIds?.length) {
    actions.push(td('add_tags', { count: rule.actions.addTagIds.length }));
  }

  return `${parts.join(' · ') || td('no_conditions')} → ${actions.join(' + ') || td('no_actions')}`;
}
