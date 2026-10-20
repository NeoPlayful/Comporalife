import { z } from 'zod';

export const categoryIdSchema = z.object({
  id: z.string().uuid('分类 ID 格式不正确'),
});

export const listCategoriesSchema = z.object({
  kind: z.enum(['income', 'expense']).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const createCategorySchema = z.object({
  kind: z.enum(['income', 'expense']),
  name: z.string().trim().min(1, '分类名称不能为空').max(40, '分类名称最多 40 个字符'),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    parentId: z.string().uuid().nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一项字段');

export const reorderCategoriesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        sortOrder: z.number().int().min(0).max(9999),
      }),
    )
    .min(1)
    .max(200),
});

export const tagIdSchema = z.object({
  id: z.string().uuid('标签 ID 格式不正确'),
});

export const createTagSchema = z.object({
  name: z.string().trim().min(1, '标签名不能为空').max(20, '标签名最多 20 个字符'),
});

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(20),
});
