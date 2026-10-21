import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { accountsApi } from '@/lib/accounts';
import { ApiError } from '@/lib/client';
import { categoriesApi } from '@/lib/categories';
import {
  classificationRulesApi,
  type ClassificationRule,
  type RuleActions,
  type RuleConditions,
} from '@/lib/imports';

export default function RulesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ClassificationRule | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      setError(null);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存规则失败'),
  });

  const toggleRule = useMutation({
    mutationFn: (rule: ClassificationRule) => classificationRulesApi.update(rule.id, { enabled: !rule.enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });

  const removeRule = useMutation({
    mutationFn: (id: string) => classificationRulesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });

  const testRule = useMutation({
    mutationFn: (rule: ClassificationRule) => classificationRulesApi.test(rule.id),
    onSuccess: (result, rule) => setTestResult({ rule, matched: result.matched }),
    onError: (err) => setError(err instanceof ApiError ? err.message : '试运行失败'),
  });

  const applyRules = useMutation({
    mutationFn: () => classificationRulesApi.apply({ onlyUncategorized: true }),
    onSuccess: async (result) => {
      setError(null);
      setTestResult(null);
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      alert(`已对 ${result.matched} 笔交易执行规则，其中 ${result.categorized} 笔完成分类`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '执行失败'),
  });

  if (rulesQuery.isPending) return <LoadingState label="加载规则…" />;
  if (rulesQuery.error) return <ErrorState message="规则加载失败" onRetry={() => void rulesQuery.refetch()} />;

  const rules = rulesQuery.data.rules;
  const flatCategories = categoriesQuery.data?.flat ?? [];
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">分类规则</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            规则按优先级从高到低执行：分类由首个命中且设置了分类的规则决定，标签取全部命中的并集。
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/imports" className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm">
            返回导入
          </Link>
          <button
            type="button"
            disabled={applyRules.isPending || rules.length === 0}
            onClick={() => applyRules.mutate()}
            className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            应用到未分类流水
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            新建规则
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      {editing && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
          categories={flatCategories}
          accounts={accounts}
          saving={saveRule.isPending}
          onCancel={() => setEditing(null)}
          onSave={(payload) => saveRule.mutate({ rule: editing, payload })}
        />
      )}

      {testResult && (
        <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-sm text-sky-500">
          「{testResult.rule.name}」试运行命中 {testResult.matched} 笔交易（未写入账本）。
        </p>
      )}

      {rules.length === 0 ? (
        <EmptyState
          title="还没有分类规则"
          description="创建规则后，导入的交易会按商户、摘要、金额等条件自动归类并打标签。"
        />
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="card flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{rule.name}</span>
                  <span className="rounded bg-black/10 px-1.5 py-0.5 text-xs dark:bg-white/10">
                    优先级 {rule.priority}
                  </span>
                  {!rule.enabled && (
                    <span className="text-xs text-[var(--color-content-muted)]">已停用</span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-content-muted)]">{describeRule(rule)}</p>
                <p className="text-xs text-[var(--color-content-muted)]">累计命中 {rule.matchCount} 次</p>
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                <button type="button" onClick={() => toggleRule.mutate(rule)} className="text-[var(--color-accent)]">
                  {rule.enabled ? '停用' : '启用'}
                </button>
                <button type="button" onClick={() => testRule.mutate(rule)} className="text-[var(--color-accent)]">
                  试运行
                </button>
                <button type="button" onClick={() => setEditing(rule)} className="text-[var(--color-accent)]">
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('删除规则不会回退已分类的交易，确定删除？')) removeRule.mutate(rule.id);
                  }}
                  className="text-[var(--color-negative)]"
                >
                  删除
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
  saving,
  onCancel,
  onSave,
}: {
  rule: ClassificationRule | null;
  categories: Array<{ id: string; name: string; kind: string; parentId: string | null }>;
  accounts: Array<{ id: string; name: string }>;
  saving: boolean;
  onCancel: () => void;
  onSave: (payload: RulePayload) => void;
}) {
  const [name, setName] = useState(rule?.name ?? '');
  const [priority, setPriority] = useState(rule?.priority ?? 100);
  const [merchant, setMerchant] = useState(rule?.conditions.merchant?.value ?? '');
  const [description, setDescription] = useState(rule?.conditions.description?.value ?? '');
  const [categoryId, setCategoryId] = useState(rule?.actions.categoryId ?? '');
  const [minAmount, setMinAmount] = useState(rule?.conditions.amount?.min ?? '');
  const [maxAmount, setMaxAmount] = useState(rule?.conditions.amount?.max ?? '');
  const [accountId, setAccountId] = useState(rule?.conditions.accountIds?.[0] ?? '');

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
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="text-sm font-medium">{rule ? '编辑规则' : '新建规则'}</h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="规则名称">
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="优先级（越小越优先）">
          <input
            type="number"
            min={0}
            max={9999}
            value={priority}
            onChange={(event) => setPriority(Number(event.target.value))}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="商户包含">
          <input
            value={merchant}
            onChange={(event) => setMerchant(event.target.value)}
            placeholder="例如：示例餐厅"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="摘要包含">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="例如：午餐"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="限定账户">
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="">全部账户</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="分类">
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          >
            <option value="">不设置分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.kind === 'income' ? '收入' : '支出'} · {category.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="金额下限">
          <input
            value={minAmount}
            onChange={(event) => setMinAmount(event.target.value)}
            placeholder="0"
            inputMode="decimal"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="金额上限">
          <input
            value={maxAmount}
            onChange={(event) => setMaxAmount(event.target.value)}
            placeholder="不限"
            inputMode="decimal"
            className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
          />
        </Field>
      </div>

      <p className="text-xs text-[var(--color-content-muted)]">
        至少填写一个条件与一个动作。规则不支持正则表达式。
      </p>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--color-border-subtle)] px-4 py-2 text-sm"
        >
          取消
        </button>
      </div>
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

function describeRule(rule: ClassificationRule): string {
  const parts: string[] = [];
  if (rule.conditions.directions?.length) parts.push(rule.conditions.directions.join('/'));
  if (rule.conditions.merchant) parts.push(`商户包含「${rule.conditions.merchant.value}」`);
  if (rule.conditions.description) parts.push(`摘要包含「${rule.conditions.description.value}」`);
  if (rule.conditions.amount) {
    parts.push(`金额 ${rule.conditions.amount.min ?? '0'}–${rule.conditions.amount.max ?? '∞'}`);
  }
  if (rule.conditions.onlyUncategorized) parts.push('仅未分类');
  if (rule.conditions.accountIds?.length) parts.push(`限定 ${rule.conditions.accountIds.length} 个账户`);

  const actions: string[] = [];
  if (rule.actions.categoryId) actions.push('设置分类');
  if (rule.actions.addTagIds?.length) actions.push(`加 ${rule.actions.addTagIds.length} 个标签`);

  return `${parts.join(' · ') || '无条件'} → ${actions.join(' + ') || '无动作'}`;
}
