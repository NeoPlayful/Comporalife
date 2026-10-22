import type { CategoryNode } from '@/lib/categories';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface DraftItem {
  categoryId: string;
  amount: string;
}

/**
 * 分类额度编辑器：额度以「全量替换」方式提交，
 * 因此这里维护的是完整集合，而不是增量操作。
 */
export default function BudgetItemEditor({
  items,
  categories,
  onChange,
}: {
  items: DraftItem[];
  categories: CategoryNode[];
  onChange: (items: DraftItem[]) => void;
}) {
  const { t } = useTranslation('budgets');

  const used = new Set(items.map((item) => item.categoryId));

  function updateAt(index: number, patch: Partial<DraftItem>) {
    onChange(items.map((item, current) => (current === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const options = categories.filter(
          (node) => !node.archived && (node.id === item.categoryId || !used.has(node.id)),
        );

        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t('form.category')}
              value={item.categoryId}
              onChange={(event) => updateAt(index, { categoryId: event.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm"
            >
              <option value="">{t('form.select_category')}</option>
              {options.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              aria-label={t('form.amount')}
              value={item.amount}
              onChange={(event) => updateAt(index, { amount: event.target.value })}
              className="w-32 rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-2 py-1.5 text-sm tabular-nums"
            />
            <button
              type="button"
              aria-label={t('form.remove_item')}
              onClick={() => onChange(items.filter((_, current) => current !== index))}
              className="rounded-lg p-1.5 text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => onChange([...items, { categoryId: '', amount: '' }])}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
      >
        <Plus className="size-4" aria-hidden />
        {t('items.add')}
      </button>
    </div>
  );
}
