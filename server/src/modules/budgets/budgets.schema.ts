import { z } from 'zod';
import {
  BUDGET_MAX_ITEMS,
  BUDGET_PERIOD_TYPES,
  BUDGET_STATUSES,
} from '../../config/constants.js';

const moneyString = z.string().regex(/^\d+(\.\d{1,6})?$/, '金额必须为正数，最多 6 位小数');

const budgetItemSchema = z.object({
  categoryId: z.string().uuid('分类 ID 格式不正确'),
  amount: moneyString,
});

const baseBudgetShape = {
  periodType: z.enum(BUDGET_PERIOD_TYPES),
  year: z.coerce.number().int().min(1970).max(2100),
  month: z.coerce.number().int().min(0).max(12),
  totalAmount: moneyString.nullable().optional(),
  rollover: z.boolean().optional().default(false),
  note: z.string().trim().max(500).nullable().optional(),
  items: z.array(budgetItemSchema).max(BUDGET_MAX_ITEMS).optional(),
};

/** 月度预算 month 必填 1–12；年度预算 month 固定为 0 */
function assertPeriodShape(value: { periodType: 'monthly' | 'yearly'; month: number }, ctx: z.RefinementCtx) {
  if (value.periodType === 'monthly' && (value.month < 1 || value.month > 12)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['month'], message: '月度预算的月份应为 1–12' });
  }
  if (value.periodType === 'yearly' && value.month !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['month'], message: '年度预算的月份必须为 0' });
  }
}

export const createBudgetSchema = z.object(baseBudgetShape).superRefine(assertPeriodShape);

export const updateBudgetSchema = z
  .object({
    totalAmount: moneyString.nullable().optional(),
    rollover: z.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    items: z.array(budgetItemSchema).max(BUDGET_MAX_ITEMS).optional(),
    version: z.number().int().positive(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'version'),
    '至少需要修改一项字段',
  );

export const listBudgetsSchema = z.object({
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(0).max(12).optional(),
  periodType: z.enum(BUDGET_PERIOD_TYPES).optional(),
  status: z.enum(BUDGET_STATUSES).default('active'),
});

export const budgetSummarySchema = z.object({
  periodType: z.enum(BUDGET_PERIOD_TYPES).default('monthly'),
  year: z.coerce.number().int().min(1970).max(2100),
  month: z.coerce.number().int().min(0).max(12).default(0),
});

export const budgetIdSchema = z.object({
  id: z.string().uuid('预算 ID 格式不正确'),
});

export const copyBudgetSchema = z.object({
  /** 目标周期，缺省时自动取下一周期 */
  year: z.coerce.number().int().min(1970).max(2100).optional(),
  month: z.coerce.number().int().min(0).max(12).optional(),
});
