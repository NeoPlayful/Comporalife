import { z } from 'zod';
import { IMPORT_DATE_FORMATS, IMPORT_ROW_STATUSES } from '../../config/constants.js';

const columnIndex = z.number().int().min(0).max(199);

export const mappingSchema = z
  .object({
    occurredAt: columnIndex,
    amountMode: z.enum(['signed', 'debitCredit']),
    amount: columnIndex.optional(),
    debit: columnIndex.optional(),
    credit: columnIndex.optional(),
    currency: columnIndex.optional(),
    description: columnIndex.optional(),
    merchant: columnIndex.optional(),
    externalId: columnIndex.optional(),
    balanceAfter: columnIndex.optional(),
    dateFormat: z.enum(IMPORT_DATE_FORMATS),
  })
  .superRefine((value, ctx) => {
    if (value.amountMode === 'signed' && value.amount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: '单列模式必须指定金额列' });
    }
    if (value.amountMode === 'debitCredit' && value.debit === undefined && value.credit === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['debit'], message: '借贷模式至少需要指定一列' });
    }
    if (value.description === undefined && value.merchant === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: '摘要与商户至少需要映射一个',
      });
    }

    const used = [
      value.occurredAt,
      value.amount,
      value.debit,
      value.credit,
      value.currency,
      value.description,
      value.merchant,
      value.externalId,
      value.balanceAfter,
    ].filter((item): item is number => item !== undefined);

    if (new Set(used).size !== used.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mapping'], message: '同一列不能映射到多个字段' });
    }
  });

export const importIdSchema = z.object({
  id: z.string().uuid('导入批次 ID 格式不正确'),
});

export const listImportsSchema = z.object({
  status: z
    .enum([
      'uploaded',
      'parsed',
      'mapped',
      'validated',
      'committing',
      'completed',
      'failed',
      'cancelled',
      'rolled_back',
      'all',
    ])
    .default('all'),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const rowsQuerySchema = z.object({
  status: z.enum([...IMPORT_ROW_STATUSES, 'all']).default('all'),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const previewQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

export const setMappingSchema = z.object({
  version: z.number().int().positive().optional(),
  headerRow: z.number().int().min(1).max(1000).optional(),
  mapping: mappingSchema,
  /** 保存映射模板时同时提供 */
  templateName: z.string().trim().min(1).max(80).optional(),
});

export const duplicateDecisionSchema = z.object({
  decisions: z
    .array(
      z.object({
        rowId: z.string().uuid(),
        action: z.enum(['keep', 'skip']),
      }),
    )
    .min(1)
    .max(5000),
});

export const uploadQuerySchema = z.object({
  accountId: z.string().uuid('账户 ID 格式不正确'),
  encoding: z.enum(['utf-8', 'gb18030']).optional(),
  sheetName: z.string().max(100).optional(),
  force: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ColumnMappingInput = z.infer<typeof mappingSchema>;
