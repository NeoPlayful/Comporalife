import { z } from 'zod';
import { ALLOCATION_DIMENSIONS, ASSET_CLASSES, CASHFLOW_KINDS, TRADE_KINDS } from '../../config/constants.js';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');
const moneyText = z
  .string()
  .regex(/^-?\d+(\.\d{1,6})?$/, '金额最多 6 位小数');
const positiveMoney = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, '金额必须为正数且最多 6 位小数');

const currency = z.string().length(3).toUpperCase();
const symbol = z.string().trim().min(1).max(32);

export const createInstrumentSchema = z.object({
  symbol,
  name: z.string().trim().min(1).max(120),
  assetClass: z.enum(ASSET_CLASSES),
  currency,
  note: z.string().max(200).optional().nullable(),
});

export const updateInstrumentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    assetClass: z.enum(ASSET_CLASSES).optional(),
    currency: currency.optional(),
    note: z.string().max(200).optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一个字段');

export const listInstrumentsSchema = z.object({
  assetClass: z.enum(ASSET_CLASSES).optional(),
  q: z.string().trim().max(64).optional(),
});

export const instrumentIdSchema = z.object({ id: z.string().uuid() });

export const createPriceSchema = z.object({
  priceDate: dateText,
  price: z.string().regex(/^\d+(\.\d{1,8})?$/, '价格必须为正数且最多 8 位小数'),
  note: z.string().max(200).optional().nullable(),
});

export const listPricesSchema = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
});

export const priceIdSchema = z.object({ id: z.string().uuid(), priceId: z.string().uuid() });

export const createPortfolioSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  note: z.string().max(500).optional().nullable(),
});

export const updatePortfolioSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    note: z.string().max(500).optional().nullable(),
    status: z.enum(['active', 'archived']).optional(),
    version: z.number().int().positive(),
  })
  .refine((value) => value.version > 0, '必须提供 version');

export const portfolioIdSchema = z.object({ id: z.string().uuid() });

export const listPortfoliosSchema = z.object({
  status: z.enum(['active', 'archived', 'all']).optional(),
});

export const moneyField = moneyText;
export const positiveMoneyField = positiveMoney;

export const createTradeSchema = z
  .object({
    portfolioId: z.string().uuid(),
    instrumentId: z.string().uuid().optional().nullable(),
    kind: z.enum(TRADE_KINDS),
    tradeDate: z.string().datetime({ offset: true }),
    quantity: z.string().regex(/^\d+(\.\d{1,8})?$/, '数量最多 8 位小数').optional().nullable(),
    price: z.string().regex(/^\d+(\.\d{1,8})?$/, '价格最多 8 位小数').optional().nullable(),
    amount: z.string().regex(/^\d+(\.\d{1,6})?$/, '金额必须为正数且最多 6 位小数').optional(),
    fee: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
    tax: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
    categoryId: z.string().uuid().optional().nullable(),
    note: z.string().max(200).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const isTrade = value.kind === 'buy' || value.kind === 'sell';

    if (isTrade) {
      if (!value.instrumentId) {
        ctx.addIssue({ code: 'custom', path: ['instrumentId'], message: '买卖必须指定标的' });
      }
      if (!value.quantity) {
        ctx.addIssue({ code: 'custom', path: ['quantity'], message: '买卖必须填写数量' });
      }
      if (!value.price) {
        ctx.addIssue({ code: 'custom', path: ['price'], message: '买卖必须填写价格' });
      }
      return;
    }

    if (value.quantity || value.price) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: '非买卖交易不能填写数量与价格' });
    }

    // 手续费/税费可以不带标的（账户管理费），但必须有金额
    if (!value.amount) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: '必须填写金额' });
    }
  });

export const updateTradeSchema = z.object({
  tradeDate: z.string().datetime({ offset: true }).optional(),
  quantity: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
  price: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  fee: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  tax: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  note: z.string().max(200).optional().nullable(),
  version: z.number().int().positive(),
});

export const listTradesSchema = z.object({
  portfolioId: z.string().uuid().optional(),
  instrumentId: z.string().uuid().optional(),
  kind: z.enum(TRADE_KINDS).optional(),
  from: dateText.optional(),
  to: dateText.optional(),
  includeVoided: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .transform((value) => value === true || value === 'true' || value === '1')
    .optional(),
});

export const tradeIdSchema = z.object({ id: z.string().uuid() });

export const createCashflowSchema = z.object({
  kind: z.enum(CASHFLOW_KINDS),
  flowDate: z.string().datetime({ offset: true }),
  amount: positiveMoney,
  note: z.string().max(200).optional().nullable(),
});

export const cashflowIdSchema = z.object({ id: z.string().uuid(), cashflowId: z.string().uuid() });

export const createValuationSchema = z.object({
  valuationDate: dateText,
  marketValue: z.string().regex(/^\d+(\.\d{1,6})?$/, '市值不能为负'),
  note: z.string().max(200).optional().nullable(),
  overwrite: z.boolean().optional(),
});

export const valuationIdSchema = z.object({
  id: z.string().uuid(),
  valuationId: z.string().uuid(),
});

export const targetsSchema = z.object({
  dimension: z.enum(ALLOCATION_DIMENSIONS),
  targets: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(64),
        targetWeight: z.string().regex(/^\d+(\.\d{1,6})?$/, '权重必须为 0–1 之间的小数'),
      }),
    )
    .max(100),
});

export const returnsSchema = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
});

export const rebalancePreviewSchema = z.object({
  dimension: z.enum(ALLOCATION_DIMENSIONS).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
});
