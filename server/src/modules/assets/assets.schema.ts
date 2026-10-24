import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, '金额必须为非负数，最多 6 位小数');

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

export const ASSET_KINDS = ['property', 'vehicle', 'collectible', 'other'] as const;
export const ASSET_STATUSES = ['active', 'archived'] as const;
export const VALUATION_BASES = ['manual', 'appraised', 'market'] as const;

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 yyyy-MM-dd');

export const createAssetSchema = z.object({
  name: z.string().trim().min(1, '资产名称不能为空').max(80, '资产名称最多 80 个字符'),
  kind: z.enum(ASSET_KINDS).default('other'),
  currency: currencySchema,
  purchaseDate: dateText.optional().nullable(),
  // 购置价仅作参考，不参与净资产
  purchasePrice: decimalString.optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const updateAssetSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    kind: z.enum(ASSET_KINDS).optional(),
    currency: currencySchema.optional(),
    purchaseDate: dateText.nullable().optional(),
    purchasePrice: decimalString.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'version'), '至少需要修改一项字段');

export const listAssetsSchema = z.object({
  status: z.enum(['active', 'archived', 'all']).default('active'),
  kind: z.enum(ASSET_KINDS).optional(),
});

export const assetIdSchema = z.object({ id: z.string().uuid('资产 ID 格式不正确') });

export const assetValuationIdSchema = z.object({
  id: z.string().uuid('资产 ID 格式不正确'),
  valuationId: z.string().uuid('估值 ID 格式不正确'),
});

export const createValuationSchema = z.object({
  valuationDate: dateText,
  value: decimalString,
  basis: z.enum(VALUATION_BASES).default('manual'),
  note: z.string().trim().max(200).optional().nullable(),
  // 同日已存在时必须显式声明覆盖，避免误改历史估值
  overwrite: z.boolean().default(false),
});
