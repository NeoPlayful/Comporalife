import { z } from 'zod';
import { BULK_OPERATION_LIMIT } from '../../config/constants.js';

const decimalString = z.string().regex(/^\d+(\.\d{1,6})?$/, '金额必须为正数，最多 6 位小数');

export const transactionIdSchema = z.object({
  id: z.string().uuid('交易 ID 格式不正确'),
});

export const createTransactionSchema = z.object({
  type: z.enum(['income', 'expense', 'adjustment']),
  accountId: z.string().uuid('账户 ID 格式不正确'),
  categoryId: z.string().uuid().nullable().optional(),
  amount: decimalString,
  occurredAt: z.coerce.date(),
  description: z.string().trim().min(1, '摘要不能为空').max(200, '摘要最多 200 个字符'),
  merchant: z.string().trim().max(100).nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  tagIds: z.array(z.string().uuid()).max(20).optional(),
});

export const createTransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: decimalString,
  occurredAt: z.coerce.date(),
  description: z.string().trim().min(1).max(200).optional(),
  note: z.string().max(1000).nullable().optional(),
});

export const updateTransactionSchema = z
  .object({
    categoryId: z.string().uuid().nullable().optional(),
    amount: decimalString.optional(),
    occurredAt: z.coerce.date().optional(),
    description: z.string().trim().min(1).max(200).optional(),
    merchant: z.string().trim().max(100).nullable().optional(),
    note: z.string().max(1000).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'version'),
    '至少需要修改一项字段',
  );

export const listTransactionsSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  type: z.enum(['income', 'expense', 'transfer', 'adjustment']).optional(),
  status: z.enum(['posted', 'voided', 'all']).default('posted'),
  keyword: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const bulkCategorizeSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(BULK_OPERATION_LIMIT),
  categoryId: z.string().uuid().nullable(),
});

export const bulkUpdateSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(BULK_OPERATION_LIMIT),
  note: z.string().max(1000).nullable().optional(),
  addTagIds: z.array(z.string().uuid()).max(10).optional(),
});
