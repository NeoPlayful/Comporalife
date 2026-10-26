import {
  categoriesApi,
  tagsApi,
  type CategoryKind,
  type CategoryNode,
} from '@/lib/categories';
import { useEnumLabels } from '@/lib/enum-labels';
import { translateError } from '@/lib/error-message';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingState from '@/components/ui/LoadingState';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function CategoriesPage() {
  const [kind, setKind] = useState<CategoryKind>('expense');
  const { t } = useTranslation();
  const { categoryKind } = useEnumLabels();

  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [addingUnder, setAddingUnder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const treeQuery = useQuery({
    queryKey: ['categories', kind],
    queryFn: () => categoriesApi.tree(kind),
  });

  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: tagsApi.list });

  const [tagName, setTagName] = useState('');

  const createTag = useMutation({
    mutationFn: () => tagsApi.create(tagName.trim()),
    onSuccess: () => {
      setTagName('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const deleteTag = useMutation({
    mutationFn: (id: string) => tagsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  });

  const createCategory = useMutation({
    mutationFn: (payload: { name: string; parentId: string | null }) =>
      categoriesApi.create({ kind, name: payload.name, parentId: payload.parentId }),
    onSuccess: () => {
      setNewName('');
      setAddingUnder(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: () => setError(t('categories:create_failed')),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => categoriesApi.remove(id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (err) => setError(translateError(err, t)),
  });

  const roots = treeQuery.data?.categories ?? [];

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('categories:title')}</h1>

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-negative)]/10 px-3 py-2 text-sm text-[var(--color-negative)]">
          {error}
        </p>
      )}

      <section className="card p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/5">
            {(['expense', 'income'] as CategoryKind[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setKind(item)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  kind === item
                    ? 'bg-[var(--color-surface-raised)] font-medium text-[var(--color-content)]'
                    : 'text-[var(--color-content-muted)]'
                }`}
              >
                {categoryKind(item)}
              </button>
            ))}
          </div>

          <button
            type="button"
            // 单输入快加保持行内：为一个名称框加遮罩与焦点陷阱，成本大于收益
            onClick={() => {
              setAddingUnder('root');
              setNewName('');
            }}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white"
          >
            <Plus className="size-4" />
            {t('categories:new_category')}
          </button>
        </div>

        {addingUnder === 'root' && (
          <InlineInput
            placeholder={t('categories:root_placeholder')}
            value={newName}
            onChange={setNewName}
            onCancel={() => setAddingUnder(null)}
            onSubmit={() => createCategory.mutate({ name: newName.trim(), parentId: null })}
            disabled={!newName.trim()}
          />
        )}

        {treeQuery.isLoading && <LoadingState />}
        {treeQuery.isError && (
          <ErrorState message={t('categories:load_failed')} onRetry={() => treeQuery.refetch()} />
        )}

        {treeQuery.data && roots.length === 0 && (
          <EmptyState
            title={t('categories:empty_title')}
            description={t('categories:empty_description')}
          />
        )}

        {roots.length > 0 && (
          <ul className="mt-3 space-y-3">
            {roots.map((root) => (
              <CategoryGroup
                key={root.id}
                node={root}
                addingUnder={addingUnder}
                newName={newName}
                onNewNameChange={setNewName}
                onStartAdd={() => {
                  setAddingUnder(root.id);
                  setNewName('');
                }}
                onCancelAdd={() => setAddingUnder(null)}
                onSubmitAdd={() =>
                  createCategory.mutate({ name: newName.trim(), parentId: root.id })
                }
                onDelete={(id) => deleteCategory.mutate(id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-medium">{t('categories:tags.title')}</h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tagName.trim()) createTag.mutate();
          }}
          className="mb-3 flex gap-2"
        >
          <input
            maxLength={20}
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            placeholder={t('categories:tags.placeholder')}
            className="input max-w-xs"
          />
          <button
            type="submit"
            disabled={!tagName.trim() || createTag.isPending}
            className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {t('categories:tags.add')}
          </button>
        </form>

        {tagsQuery.data && tagsQuery.data.tags.length === 0 && (
          <p className="text-sm text-[var(--color-content-muted)]">{t('categories:tags.empty')}</p>
        )}

        {tagsQuery.data && tagsQuery.data.tags.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {tagsQuery.data.tags.map((tag) => (
              <li
                key={tag.id}
                className="flex items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] px-3 py-1 text-sm"
              >
                {tag.name}
                {tag.transactionCount !== undefined && tag.transactionCount > 0 && (
                  <span className="text-xs text-[var(--color-content-muted)]">{tag.transactionCount}</span>
                )}
                <button
                  type="button"
                  onClick={() => deleteTag.mutate(tag.id)}
                  className="text-[var(--color-content-muted)] hover:text-[var(--color-negative)]"
                  aria-label={t('categories:tags.delete_aria', { name: tag.name })}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CategoryGroup({
  node,
  addingUnder,
  newName,
  onNewNameChange,
  onStartAdd,
  onCancelAdd,
  onSubmitAdd,
  onDelete,
}: {
  node: CategoryNode;
  addingUnder: string | null;
  newName: string;
  onNewNameChange: (value: string) => void;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onSubmitAdd: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <li>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{node.name}</span>
        <div className="flex items-center gap-2">
          {node.children.length === 0 && (
            <button
              type="button"
              onClick={onStartAdd}
              className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-accent)]"
            >
              {t('categories:add_child')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="text-[var(--color-content-muted)] hover:text-[var(--color-negative)]"
            aria-label={t('categories:delete_category_aria', { name: node.name })}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {node.children.length > 0 && (
        <ul className="mt-1 ml-3 space-y-1 border-l border-[var(--color-border-subtle)] pl-3">
          {node.children.map((child) => (
            <li key={child.id} className="flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--color-content-muted)]">{child.name}</span>
              <button
                type="button"
                onClick={() => onDelete(child.id)}
                className="text-[var(--color-content-muted)] hover:text-[var(--color-negative)]"
                aria-label={t('categories:delete_category_aria', { name: child.name })}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {addingUnder === node.id && (
        <div className="mt-2 ml-3">
          <InlineInput
            placeholder={t('categories:child_placeholder')}
            value={newName}
            onChange={onNewNameChange}
            onCancel={onCancelAdd}
            onSubmit={onSubmitAdd}
            disabled={!newName.trim()}
          />
        </div>
      )}
    </li>
  );
}

function InlineInput({
  placeholder,
  value,
  onChange,
  onCancel,
  onSubmit,
  disabled,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
      className="flex gap-2"
    >
      <input
        autoFocus
        maxLength={40}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input max-w-xs"
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm text-white disabled:opacity-60"
      >
        {t('common:actions.save')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-sm"
      >
        {t('common:actions.cancel')}
      </button>
    </form>
  );
}
