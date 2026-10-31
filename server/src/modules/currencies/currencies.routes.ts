import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { rateToString } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { resolveRate } from './currency.service.js';
import {
  getRateHistory,
  RATE_GRANULARITIES,
  RATE_GRANULARITY_LIMITS,
} from './rate-history.service.js';
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
  resetWatchlist,
  WatchlistError,
} from './rate-watchlist.service.js';

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

const pairSchema = z
  .object({
    from: currencySchema,
    to: currencySchema,
  })
  .refine((value) => value.from !== value.to, { message: '两个币种不能相同' });

const historyQuerySchema = z.object({
  from: currencySchema,
  to: currencySchema,
  granularity: z.enum(RATE_GRANULARITIES).default('day'),
  buckets: z.coerce.number().int().positive().optional(),
});

function rethrowWatchlistError(err: unknown): never {
  if (err instanceof WatchlistError) {
    throw errors.validation(err.message);
  }
  throw err;
}

/**
 * 用户侧汇率接口：只读 + 自选。
 *
 * 汇率本身是全局共享的系统参考数据，由后台统一维护；用户能改的只有
 * 「我的列表里显示哪些币种对」，这与自选股票是同一个模型。
 */
export default async function currenciesRoutes(app: FastifyInstance) {
  app.get('/exchange-rates', { preHandler: app.authenticate }, async (request) => {
    const query = request.query as { from?: string; to?: string; asOf?: string };

    if (!query.from || !query.to) {
      throw errors.validation('必须指定 from 与 to 币种');
    }

    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      throw errors.validation('asOf 日期格式不正确');
    }

    const result = await resolveRate(app.prisma, { from: query.from, to: query.to, asOf });

    if (!result) {
      throw errors.rateMissing([`${query.from}->${query.to}`]);
    }

    return ok(
      {
        from: query.from,
        to: query.to,
        rate: rateToString(result.rate),
        rateDate: result.rateDate,
        inverted: result.inverted,
      },
      request.id,
    );
  });

  // 写入能力已迁移到后台。返回 403 而不是 404，便于前端与用户理解「能力去哪了」
  app.post('/exchange-rates/manual', { preHandler: app.authenticate }, async () => {
    throw errors.rateWriteForbidden();
  });

  app.delete('/exchange-rates/manual/:id', { preHandler: app.authenticate }, async () => {
    throw errors.rateWriteForbidden();
  });

  /** 自选列表：当前展示的币种对、各自最新汇率与状态、可添加的候选 */
  app.get('/exchange-rates/watchlist', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    return ok(await getWatchlist(app.prisma, userId), request.id);
  });

  app.post('/exchange-rates/watchlist', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = pairSchema.parse(request.body);

    try {
      const view = await addToWatchlist(app.prisma, userId, body.from, body.to);
      return reply.status(201).send(ok(view, request.id));
    } catch (err) {
      rethrowWatchlistError(err);
    }
  });

  app.delete('/exchange-rates/watchlist', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = pairSchema.parse(request.body);

    try {
      return ok(await removeFromWatchlist(app.prisma, userId, body.from, body.to), request.id);
    } catch (err) {
      rethrowWatchlistError(err);
    }
  });

  /** 恢复默认：清空偏好，重新跟随自己持有币种的默认集合 */
  app.post('/exchange-rates/watchlist/reset', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    return ok(await resetWatchlist(app.prisma, userId), request.id);
  });

  /**
   * 单个币种对的走势（日/周/月/季/年）。
   *
   * 汇率是全局公开的市场数据，不含任何用户私有信息，因此登录用户即可读取历史，
   * 无需管理员权限、也不写审计。数值口径与自选列表保持一致（优先正向、
   * 无正向才取反向倒数），保证图上最后一个点能和列表卡片的当前值对上。
   */
  app.get('/exchange-rates/history', { preHandler: app.authenticate }, async (request) => {
    const query = historyQuerySchema.parse(request.query);
    if (query.from === query.to) {
      throw errors.validation('两个币种不能相同');
    }

    const result = await getRateHistory(app.prisma, {
      from: query.from,
      to: query.to,
      granularity: query.granularity,
      buckets: query.buckets ?? RATE_GRANULARITY_LIMITS[query.granularity].default,
    });

    return ok(result, request.id);
  });
}
