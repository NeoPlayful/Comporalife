import { z } from 'zod';
import {
  ANALYTICS_DEFAULT_LOOKBACK_MONTHS,
  ANALYTICS_GRANULARITIES,
  ANALYTICS_MAX_LOOKBACK_MONTHS,
  ANALYTICS_MIN_LOOKBACK_MONTHS,
} from '../../config/constants.js';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

export const rangeQuerySchema = z.object({
  from: dateText,
  to: dateText,
});

/** 区间可选：未传时按 granularity 取当前自然月/自然年 */
export const optionalRangeQuerySchema = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
});

export const categoryAnalyticsSchema = rangeQuerySchema.extend({
  kind: z.enum(['income', 'expense']).default('expense'),
  level: z.coerce.number().int().min(1).max(2).default(1),
  previous: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true' || value === '1'),
});

export const merchantsQuerySchema = rangeQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const trendQuerySchema = rangeQuerySchema.extend({
  granularity: z.enum(ANALYTICS_GRANULARITIES).optional(),
});

export const periodComparisonSchema = rangeQuerySchema.extend({
  mode: z.enum(['month', 'year', 'custom']).default('custom'),
});

export const largeExpensesSchema = rangeQuerySchema.extend({
  threshold: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, '阈值必须为正数')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const recurringQuerySchema = z.object({
  lookbackMonths: z.coerce
    .number()
    .int()
    .min(ANALYTICS_MIN_LOOKBACK_MONTHS)
    .max(ANALYTICS_MAX_LOOKBACK_MONTHS)
    .default(ANALYTICS_DEFAULT_LOOKBACK_MONTHS),
  frequency: z.enum(['weekly', 'monthly', 'yearly']).optional(),
});

export const fixedVariableQuerySchema = rangeQuerySchema;
