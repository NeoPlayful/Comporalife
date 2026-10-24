import { z } from 'zod';
import { MAX_SIMULATION_YEARS, MIN_SIMULATION_YEARS } from '../../config/constants.js';

const decimalString = z.string().regex(/^\d+(\.\d{1,6})?$/, '金额必须为非负数，最多 6 位小数');
const signedDecimalString = z
  .string()
  .regex(/^-?\d+(\.\d{1,6})?$/, '比率格式不正确，最多 6 位小数');

export const compoundParamsSchema = z.object({
  principal: decimalString,
  contributionAmount: decimalString,
  contributionFrequency: z.enum(['none', 'monthly', 'annual']),
  contributionTiming: z.enum(['begin', 'end']).default('end'),
  annualReturnRate: signedDecimalString.refine(
    (value) => Number(value) > -1 && Number(value) <= 1,
    '年化收益率必须在 -100% 到 100% 之间',
  ),
  years: z
    .number()
    .int()
    .min(MIN_SIMULATION_YEARS, `期限至少 ${MIN_SIMULATION_YEARS} 年`)
    .max(MAX_SIMULATION_YEARS, `期限最多 ${MAX_SIMULATION_YEARS} 年`),
  inflationRate: signedDecimalString
    .refine((value) => Number(value) >= -0.5 && Number(value) <= 0.5, '通胀率超出合理区间')
    .default('0'),
  feeRate: decimalString
    .refine((value) => Number(value) <= 0.05, '费用率不能超过 5%')
    .default('0'),
});


const optionalSignedDecimal = signedDecimalString.optional();

/** v2 进阶参数：全部可选，缺省为 0/不启用，与 v1 结果一致 */
const advancedParams = {
  annualContributionIncrease: optionalSignedDecimal.refine(
    (value) => value === undefined || (Number(value) > -0.5 && Number(value) <= 1),
    '追加额递增率应在 -50% 到 100% 之间',
  ),
  withdrawalAmount: decimalString.optional(),
  withdrawalFrequency: z.enum(['none', 'monthly', 'annual']).optional(),
  withdrawalStartYear: z.number().int().min(1).max(100).optional(),
  taxRate: decimalString
    .refine((value) => Number(value) <= 0.5, '税率不能超过 50%')
    .optional(),
};

export const calculateSchema = compoundParamsSchema.extend(advancedParams).refine(
  (value) => Number(value.principal) > 0 || Number(value.contributionAmount) > 0,
  '本金与定投至少需要一项大于 0',
);

export const saveScenarioSchema = compoundParamsSchema.extend({ ...advancedParams,
  name: z.string().trim().min(1, '场景名称不能为空').max(60, '场景名称最多 60 个字符'),
});

export const updateScenarioSchema = compoundParamsSchema
  .partial()
  .extend({ name: z.string().trim().min(1).max(60).optional() })
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一项参数');

export const compareSchema = z
  .object({
    scenarioIds: z.array(z.string().uuid()).min(2).max(4).optional(),
    params: z.array(calculateSchema).min(2).max(4).optional(),
  })
  .refine(
    (value) => Boolean(value.scenarioIds) !== Boolean(value.params),
    '必须且只能提供 scenarioIds 或 params 之一',
  );

export const scenarioIdSchema = z.object({
  id: z.string().uuid('场景 ID 格式不正确'),
});

export const solveSchema = compoundParamsSchema
  .omit({ contributionAmount: true })
  .extend({
    ...advancedParams,
    targetAmount: decimalString.refine((value) => Number(value) > 0, '目标金额必须大于 0'),
    solveFor: z.enum(['contribution', 'years']).default('contribution'),
    contributionAmount: decimalString.optional(),
  })
  .refine(
    (value) => value.solveFor !== 'years' || value.contributionAmount !== undefined,
    '按年限反推时必须提供每次投入金额',
  );
