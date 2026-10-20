import { api } from './client';

export type CategoryKind = 'income' | 'expense';

export interface CategoryNode {
  id: string;
  kind: CategoryKind;
  name: string;
  parentId: string | null;
  sortOrder: number;
  archived: boolean;
  children: CategoryNode[];
}

export interface FlatCategory {
  id: string;
  kind: CategoryKind;
  name: string;
  parentId: string | null;
  sortOrder: number;
  archived: boolean;
}

export interface Tag {
  id: string;
  name: string;
  transactionCount?: number;
  createdAt: string;
}

export const KIND_LABELS: Record<CategoryKind, string> = {
  income: '收入',
  expense: '支出',
};

export const categoriesApi = {
  tree: (kind?: CategoryKind) =>
    api.get<{ categories: CategoryNode[]; flat: FlatCategory[] }>(
      `/api/categories${kind ? `?kind=${kind}` : ''}`,
    ),

  create: (body: { kind: CategoryKind; name: string; parentId?: string | null; sortOrder?: number }) =>
    api.post<{ category: FlatCategory }>('/api/categories', body),

  update: (id: string, body: { name?: string; parentId?: string | null; sortOrder?: number }) =>
    api.patch<{ category: FlatCategory }>(`/api/categories/${id}`, body),

  remove: (id: string) => api.delete<{ archived: boolean }>(`/api/categories/${id}`),
};

export const tagsApi = {
  list: () => api.get<{ tags: Tag[] }>('/api/tags'),
  create: (name: string) => api.post<{ tag: Tag }>('/api/tags', { name }),
  rename: (id: string, name: string) => api.patch<{ tag: Tag }>(`/api/tags/${id}`, { name }),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/tags/${id}`),
};
