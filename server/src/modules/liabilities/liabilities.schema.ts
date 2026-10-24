import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, '金额必须为非负数，最多 6 位小数');

const rateString = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, '利率格式不正确，最多 6 位小数');

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

export const LIABILITY_KINDS = ['mortgage', 'consumer_loan', 'auto_loan', 'credit_line', 'other'] as const;
export const LIABILITY_STATUSES = ['active', 'archived'] as const;

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 yyyy-MM-dd');

export const createLiabilitySchema = z.object({
  name: z.string().trim().min(1, '负债名称不能为空').max(80, '负债名称最多 80 个字符'),
  kind: z.enum(LIABILITY_KINDS).default('other'),
  currency: currencySchema,
  // 原始本金与利率仅作参考，不参与任何计算
  originalAmount: decimalString.optional().nullable(),
  startDate: dateText.optional().nullable(),
  interestRate: rateString
    .refine((value) => Number(value) <= 1, '年化利率应在 0 到 1 之间')
    .optional()
    .nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const updateLiabilitySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    kind: z.enum(LIABILITY_KINDS).optional(),
    currency: currencySchema.optional(),
    originalAmount: decimalString.nullable().optional(),
    startDate: dateText.nullable().optional(),
    interestRate: rateString.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), '至少需要修改一项字段');

export const listLiabilitiesSchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
  kind: z.enum(LIABILITY_KINDS).optional(),
});

export const liabilityIdSchema = z.object({ id: z.string().uuid('负债 ID 格式不正确') });

export const liabilitySnapshotIdSchema = z.object({
  id: z.string().uuid('负债 ID 格式不正确'),
  snapshotId: z.string().uuid('快照 ID 格式不正确'),
});

export const createLiabilitySnapshotSchema = z.object({
  snapshotDate: dateText,
  balance: decimalString,
  note: z.string().trim().max(200).optional().nullable(),
  overwrite: z.boolean().default(false),
});
