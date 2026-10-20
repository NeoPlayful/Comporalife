import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

// 校验 IANA 时区合法性，避免存入无法解析的时区导致统计切月错误
const timezoneSchema = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, '时区不合法');

export const updateProfileSchema = z.object({
  nickname: z.string().trim().min(1, '昵称不能为空').max(50, '昵称最多 50 个字符'),
});

export const updatePreferencesSchema = z
  .object({
    baseCurrency: currencySchema.optional(),
    timezone: timezoneSchema.optional(),
    dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']).optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一项偏好');
