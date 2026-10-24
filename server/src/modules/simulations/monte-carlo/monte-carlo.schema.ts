import { z } from 'zod';
import {
  MONTE_CARLO_MAX_ASSETS,
  MONTE_CARLO_MAX_PATHS,
  MONTE_CARLO_MAX_YEARS,
  MONTE_CARLO_PREVIEW_PATHS,
  MONTE_CARLO_SEED_MAX,
  REBALANCE_FREQUENCIES,
  STRESS_PRESETS,
} from '../../../config/constants.js';

/** 比率与金额在请求里统一用字符串，避免 JSON 数字精度损失 */
const decimalText = z
  .string()
  .regex(/^-?\d+(\.\d{1,6})?$/, '数值格式不正确，最多 6 位小数');

const nonNegative = decimalText.refine((value) => Number(value) >= 0, '不能为负数');

const frequency = z.enum(['none', 'monthly', 'annual']);

const assetSchema = z.object({
  key: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(80),
  weight: nonNegative,
  expectedAnnualReturn: decimalText,
  annualVolatility: nonNegative,
});

const settingsSchema = z.object({
  initialValue: nonNegative.default('0'),
  contribution: z.object({
    amount: nonNegative.default('0'),
    frequency: frequency.default('monthly'),
    timing: z.enum(['begin', 'end']).default('end'),
  }),
  withdrawal: z.object({
    amount: nonNegative.default('0'),
    frequency: frequency.default('none'),
    startYear: z.number().int().min(1).default(1),
  }),
  inflationRate: decimalText.default('0'),
  feeRate: nonNegative.default('0'),
  targetAmount: nonNegative.nullable().default(null),
});

const correlationSchema = z.array(z.array(z.number().finite()));

/** 完整方案参数：创建与更新共用，更新时整体替换（避免半套参数） */
export const scenarioBodySchema = z.object({
  currency: z.string().length(3).toUpperCase().default('CNY'),
  years: z.number().int().min(1).max(MONTE_CARLO_MAX_YEARS),
  pathCount: z.number().int().min(100).max(MONTE_CARLO_MAX_PATHS),
  rebalance: z.enum(REBALANCE_FREQUENCIES).default('annual'),
  assets: z.array(assetSchema).min(1).max(MONTE_CARLO_MAX_ASSETS),
  correlation: correlationSchema,
  settings: settingsSchema,
  note: z.string().max(500).optional().nullable(),
});

export const createScenarioSchema = scenarioBodySchema.extend({
  name: z.string().trim().min(1).max(80),
});

export const updateScenarioSchema = scenarioBodySchema
  .partial()
  .extend({ name: z.string().trim().min(1).max(80).optional() })
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一项参数');

export const duplicateScenarioSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const scenarioIdSchema = z.object({ id: z.string().uuid('方案 ID 格式不正确') });

export const runIdSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
});

/** 发起运行时只允许覆盖路径数与种子，其余参数一律以方案当前值为准 */
export const createRunSchema = z.object({
  pathCount: z.number().int().min(100).max(MONTE_CARLO_MAX_PATHS).optional(),
  seed: z.number().int().min(0).max(MONTE_CARLO_SEED_MAX).optional(),
  stressPreset: z.enum(STRESS_PRESETS).optional(),
});

export const listRunsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** 同步预览：直接传完整参数，最多 500 条路径 */
export const previewSchema = scenarioBodySchema
  .omit({ currency: true, note: true })
  .extend({
    pathCount: z.number().int().min(100).max(MONTE_CARLO_PREVIEW_PATHS),
    seed: z.number().int().min(0).max(MONTE_CARLO_SEED_MAX).optional(),
  });

export const pathsSchema = z.object({
  count: z.coerce.number().int().min(1).max(50).default(5),
  resolution: z.enum(['monthly', 'yearly']).default('monthly'),
  /** 逗号分隔的路径索引，提供后忽略 count */
  indexes: z
    .string()
    .regex(/^\d+(,\d+)*$/, '路径索引必须是逗号分隔的非负整数')
    .optional(),
});

export const compareSchema = z.object({
  runIds: z.array(z.string().uuid()).min(2).max(4).optional(),
  scenarioIds: z.array(z.string().uuid()).min(2).max(4).optional(),
  metrics: z.array(z.string().max(32)).max(12).optional(),
}).refine(
  (value) => Boolean(value.runIds) !== Boolean(value.scenarioIds),
  '必须且只能提供 runIds 或 scenarioIds 之一',
);

export const suggestionsSchema = z.object({
  portfolioId: z.string().uuid(),
});
