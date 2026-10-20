import { z } from 'zod';
import { ACCOUNT_TYPES, SUPPORTED_CURRENCIES } from '../../config/constants.js';

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d{1,6})?$/, '金额格式不正确，最多 6 位小数');

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, '账户名称不能为空').max(60, '账户名称最多 60 个字符'),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(80).optional(),
  currency: currencySchema,
  openingBalance: decimalString,
  openingBalanceDate: z.coerce.date(),
  note: z.string().max(500).optional(),
});

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    institution: z.string().trim().max(80).nullable().optional(),
    openingBalance: decimalString.optional(),
    openingBalanceDate: z.coerce.date().optional(),
    note: z.string().max(500).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'version'),
    '至少需要修改一项字段',
  );

export const listAccountsSchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
  type: z.enum(ACCOUNT_TYPES).optional(),
});

export const balanceHistorySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  granularity: z.enum(['day', 'month']).optional(),
});

export const reconcileSchema = z.object({
  statementBalance: decimalString,
  reconciledAt: z.coerce.date(),
  note: z.string().max(500).optional(),
});

export const accountIdSchema = z.object({
  id: z.string().uuid('账户 ID 格式不正确'),
});
