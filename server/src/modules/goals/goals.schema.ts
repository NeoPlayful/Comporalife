import { z } from 'zod';
import {
  GOAL_FUNDING_SOURCES,
  GOAL_MAX_REQUIRED_MONTHLY,
  GOAL_NAME_MAX_LENGTH,
  GOAL_STATUSES,
  GOAL_TYPES,
} from '../../config/constants.js';

const moneyString = z.string().regex(/^-?\d+(\.\d{1,6})?$/, '金额最多 6 位小数');
const positiveMoney = z.string().regex(/^\d+(\.\d{1,6})?$/, '金额必须为非负数，最多 6 位小数');
const rateString = z.string().regex(/^-?\d+(\.\d{1,6})?$/, '比率最多 6 位小数');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

const baseShape = {
  name: z.string().trim().min(1, '目标名称不能为空').max(GOAL_NAME_MAX_LENGTH),
  type: z.enum(GOAL_TYPES).default('savings'),
  targetAmount: positiveMoney,
  currency: z.string().length(3).toUpperCase(),
  targetDate: dateString.nullable().optional(),
  startedAt: dateString,
  initialAmount: positiveMoney.optional(),
  inflationAdjusted: z.boolean().optional().default(false),
  inflationRate: rateString.nullable().optional(),
  expectedAnnualReturn: rateString.nullable().optional(),
  monthlyContribution: positiveMoney.nullable().optional(),
  fundingSource: z.enum(GOAL_FUNDING_SOURCES).default('net_worth'),
  accountId: z.string().uuid().nullable().optional(),
  portfolioId: z.string().uuid().nullable().optional(),
  priority: z.coerce.number().int().min(1).max(999).optional().default(1),
  note: z.string().trim().max(500).nullable().optional(),
};

type GoalShape = z.infer<z.ZodObject<typeof baseShape>>;

/**
 * 目标参数的交叉校验。
 * 这些规则必须在 schema 层拦住，否则会在进度计算时产生难以解释的结果：
 * 例如开启通胀调整却没有目标日期，调整年数无从计算。
 */
function refineGoal(value: GoalShape, ctx: z.RefinementCtx) {
  if (value.inflationAdjusted) {
    if (!value.targetDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetDate'], message: '开启通胀调整时必须设置目标日期' });
    }
    if (value.inflationRate == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inflationRate'], message: '开启通胀调整时必须填写通胀率' });
    }
  }

  if (value.targetDate && value.targetDate < value.startedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetDate'], message: '目标日期不能早于起算日' });
  }

  if (value.fundingSource === 'account' && !value.accountId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['accountId'], message: '绑定账户时必须选择账户' });
  }
  if (value.fundingSource === 'portfolio' && !value.portfolioId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['portfolioId'], message: '绑定组合时必须选择组合' });
  }
  if (value.fundingSource === 'net_worth' && (value.accountId || value.portfolioId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fundingSource'],
      message: '绑定净资产时不应同时指定账户或组合',
    });
  }
}

export const createGoalSchema = z.object(baseShape).superRefine(refineGoal);

export const updateGoalSchema = z
  .object({
    name: baseShape.name.optional(),
    type: z.enum(GOAL_TYPES).optional(),
    targetAmount: positiveMoney.optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    targetDate: dateString.nullable().optional(),
    startedAt: dateString.optional(),
    initialAmount: positiveMoney.optional(),
    inflationAdjusted: z.boolean().optional(),
    inflationRate: rateString.nullable().optional(),
    expectedAnnualReturn: rateString.nullable().optional(),
    monthlyContribution: positiveMoney.nullable().optional(),
    fundingSource: z.enum(GOAL_FUNDING_SOURCES).optional(),
    accountId: z.string().uuid().nullable().optional(),
    portfolioId: z.string().uuid().nullable().optional(),
    priority: z.coerce.number().int().min(1).max(999).optional(),
    status: z.enum(GOAL_STATUSES).optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少需要提供一个待更新字段' });

export const listGoalsSchema = z.object({
  status: z.enum(GOAL_STATUSES).optional(),
  type: z.enum(GOAL_TYPES).optional(),
});

export const goalIdSchema = z.object({ id: z.string().uuid('目标 ID 格式不正确') });

export const historyQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(120).optional(),
});

export const projectionSchema = z.object({
  expectedAnnualReturn: rateString.optional(),
  monthlyContribution: positiveMoney.optional(),
  feeRate: rateString.optional(),
  includeProbabilistic: z.boolean().optional().default(true),
  maxRequiredMonthly: positiveMoney
    .optional()
    .default(String(GOAL_MAX_REQUIRED_MONTHLY)),
});

export const fiCalculateSchema = z.object({
  annualExpense: positiveMoney.optional(),
  withdrawalRate: rateString.optional(),
  expectedAnnualReturn: rateString.optional(),
  inflationRate: rateString.optional(),
});

export { moneyString };
