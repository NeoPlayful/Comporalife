import { z } from 'zod';
import { SUPPORTED_CURRENCIES, SUPPORTED_LANGUAGES } from '../../config/constants.js';

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, '时区不合法');

const simulationDefaultsSchema = z.object({
  annualReturnRate: z.number().min(-1).max(1).optional(),
  inflationRate: z.number().min(-0.5).max(0.5).optional(),
  feeRate: z.number().min(0).max(0.05).optional(),
  years: z.number().int().min(1).max(100).optional(),
  contributionFrequency: z.enum(['none', 'monthly', 'annual']).optional(),
  contributionTiming: z.enum(['begin', 'end']).optional(),
});

// 展示偏好：形如 ["USD->CNY"]，只影响汇率列表展示，绝不参与折算
const rateDisplayPairsSchema = z
  .array(
    z
      .string()
      .regex(/^[A-Z]{3}->[A-Z]{3}$/, '币种对格式应为 ABC->XYZ')
      .refine((value) => {
        const [from, to] = value.split('->');
        return (
          SUPPORTED_CURRENCIES.includes(from!) &&
          SUPPORTED_CURRENCIES.includes(to!) &&
          from !== to
        );
      }, '币种对不合法'),
  )
  .max(50);

export const updateSettingsSchema = z
  .object({
    baseCurrency: currencySchema.optional(),
    timezone: timezoneSchema.optional(),
    dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']).optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
    language: z.enum(SUPPORTED_LANGUAGES).optional(),
    simulationDefaults: simulationDefaultsSchema.nullable().optional(),
    rateDisplayPairs: rateDisplayPairsSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一项设置');
