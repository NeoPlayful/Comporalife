import type { FastifyInstance, FastifyRequest } from 'fastify';
import Decimal from 'decimal.js';
import { z } from 'zod';
import {
  CURRENCY_NAMES,
  RATE_STALE_DAYS,
  RATE_SYNC_FREQUENCIES,
  SUPPORTED_CURRENCIES,
} from '../../config/constants.js';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { rateToString, toDecimal } from '../../lib/money.js';
import { requireAuth, type AuthContext } from '../../plugins/auth.js';
import { isRateSyncEnabled, setRateSyncEnabled } from '../market-data/rate-sync.service.js';
import { getRateSyncFrequency, setRateSyncFrequency } from '../settings/system-settings.service.js';

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

// DECIMAL(20,10) 只留 10 位整数位，超出会在写库时溢出变成 500
const rateValueSchema = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,10})?$/, '汇率格式不正确：整数位最多 10 位、小数位最多 10 位')
  .refine((value) => toDecimal(value).gt(0), '汇率必须为大于 0 的数值');

const rateBodySchema = z
  .object({
    baseCurrency: currencySchema,
    quoteCurrency: currencySchema,
    rate: rateValueSchema,
    // 未来汇率会被 resolveRate 的 rateDate <= asOf 条件静默跳过，禁止录入
    rateDate: z.coerce
      .date()
      .refine((value) => value.getTime() <= Date.now() + 86_400_000, '生效日期不能晚于今天'),
  })
  .refine((value) => value.baseCurrency !== value.quoteCurrency, {
    message: '基准币种与计价币种不能相同',
  });

const rateListSchema = z.object({
  base: currencySchema.optional(),
  quote: currencySchema.optional(),
  source: z.enum(['manual', 'provider']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

/** 当前汇率视图：只按币种对与关键字裁剪，来源在取到最新行之后再筛 */
const latestRateQuerySchema = z.object({
  base: currencySchema.optional(),
  quote: currencySchema.optional(),
  source: z.enum(['manual', 'provider']).optional(),
  q: z.string().trim().max(24).optional(),
});

const rateHistoryQuerySchema = z.object({
  from: currencySchema,
  to: currencySchema,
  days: z.coerce.number().int().positive().max(3650).default(90),
});

const idSchema = z.object({ id: z.string().uuid() });

/** 管理员守卫：与 admin.routes.ts 保持一致，user 一律 403 */
function requireAdmin(request: FastifyRequest): AuthContext {
  const auth = requireAuth(request);
  if (auth.role !== 'admin' && auth.role !== 'super_admin') {
    throw errors.adminForbidden();
  }
  return auth;
}

function dayStart(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

function dayEnd(text: string): Date {
  return new Date(`${text}T23:59:59.999Z`);
}

/**
 * 后台汇率管理。
 *
 * 汇率是全局系统参考数据，写入入口只有这里与自动同步。所有改动都会影响
 * 所有用户的折算结果，因此必须留审计；metadata 只含币种对与日期，不含数值。
 */
export default async function adminRatesRoutes(app: FastifyInstance) {
  app.get('/admin/exchange-rates', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const query = rateListSchema.parse(request.query);
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    const where = {
      ...(query.base ? { baseCurrency: query.base } : {}),
      ...(query.quote ? { quoteCurrency: query.quote } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.from || query.to
        ? {
            rateDate: {
              ...(query.from ? { gte: dayStart(query.from) } : {}),
              ...(query.to ? { lte: dayEnd(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      app.prisma.exchangeRate.count({ where }),
      app.prisma.exchangeRate.findMany({
        where,
        orderBy: [{ rateDate: 'desc' }, { baseCurrency: 'asc' }, { quoteCurrency: 'asc' }],
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          baseCurrency: true,
          quoteCurrency: true,
          rate: true,
          rateDate: true,
          source: true,
          updatedAt: true,
        },
      }),
    ]);

    return ok(
      {
        exchangeRates: rows.map((row) => ({ ...row, rate: rateToString(row.rate.toString()) })),
        pagination: buildPagination(page.page, page.pageSize, total),
      },
      request.id,
    );
  });

  /**
   * 当前汇率：每个币种对只取最新一条。
   *
   * 上面那个接口是「按日期的流水」，管理员想知道「现在生效的是多少」要翻页找。
   * 这里先按币种对聚合出最大 rateDate，再取对应行；币种对数量受支持币种数平方
   * 约束（十余个币种，最多一百多对），因此整体载入后筛选分页是安全且简单的做法。
   * 统计数字在筛选之前算，反映的是全局覆盖情况，不受当前筛选影响。
   */
  app.get('/admin/exchange-rates/latest', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const query = latestRateQuerySchema.parse(request.query);
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    const maxRows = await app.prisma.exchangeRate.groupBy({
      by: ['baseCurrency', 'quoteCurrency'],
      where: { rateDate: { lte: new Date() } },
      _max: { rateDate: true },
    });

    const compound = maxRows
      .filter((row) => row._max.rateDate !== null)
      .map((row) => ({
        baseCurrency: row.baseCurrency,
        quoteCurrency: row.quoteCurrency,
        rateDate: row._max.rateDate as Date,
      }));

    const latest =
      compound.length === 0
        ? []
        : await app.prisma.exchangeRate.findMany({
            where: { OR: compound },
            orderBy: [{ baseCurrency: 'asc' }, { quoteCurrency: 'asc' }],
            select: {
              id: true,
              baseCurrency: true,
              quoteCurrency: true,
              rate: true,
              rateDate: true,
              source: true,
              updatedAt: true,
            },
          });

    const today = new Date();
    const rows = latest.map((row) => ({
      ...row,
      rate: rateToString(row.rate.toString()),
      daysLag: Math.max(
        0,
        Math.floor(
          (Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
            Date.UTC(
              row.rateDate.getUTCFullYear(),
              row.rateDate.getUTCMonth(),
              row.rateDate.getUTCDate(),
            )) /
            86_400_000,
        ),
      ),
    }));

    const stats = {
      pairs: rows.length,
      manual: rows.filter((row) => row.source === 'manual').length,
      provider: rows.filter((row) => row.source === 'provider').length,
      baseCurrencies: new Set(rows.map((row) => row.baseCurrency)).size,
      // 覆盖数没有分母看不出好坏，「其中多少已经滞后」才是管理员要看的那个数
      stale: rows.filter((row) => row.daysLag > RATE_STALE_DAYS).length,
      staleDays: RATE_STALE_DAYS,
    };

    // 「来源」是筛选条件之一，但统计要先于筛选，因此顺序不能倒过来
    const keyword = query.q?.toUpperCase();
    const matchesKeyword = (code: string) => {
      if (!keyword) return true;
      if (code.includes(keyword)) return true;
      const name = CURRENCY_NAMES[code];
      return Boolean(name && (name.zh.includes(query.q!.trim()) || name.en.toUpperCase().includes(keyword)));
    };

    const filtered = rows.filter((row) => {
      if (query.base && row.baseCurrency !== query.base) return false;
      if (query.quote && row.quoteCurrency !== query.quote) return false;
      if (query.source && row.source !== query.source) return false;
      // 只填了起点或终点时，另一端走关键字匹配，避免「只看以 X 开头的对」无从下手
      if (!matchesKeyword(row.baseCurrency) && !matchesKeyword(row.quoteCurrency)) return false;
      return true;
    });

    const total = filtered.length;
    const start = (page.page - 1) * page.pageSize;

    return ok(
      {
        exchangeRates: filtered.slice(start, start + page.pageSize),
        stats,
        pagination: buildPagination(page.page, page.pageSize, total),
      },
      request.id,
    );
  });

  /**
   * 单个币种对的汇率走势。
   *
   * 主表本来就是「每对每天一条」的时序数据，因此趋势图不需要额外的历史表。
   * 方向与折算逻辑保持一致：优先取正向，没有正向时用反向的倒数，并用 inverted
   * 标出来，避免图表把两个方向的数值混成一条线。
   */
  app.get('/admin/exchange-rates/history', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const query = rateHistoryQuerySchema.parse(request.query);

    const cutoff = new Date(Date.now() - query.days * 86_400_000);
    const since = new Date(`${cutoff.toISOString().slice(0, 10)}T00:00:00.000Z`);

    const select = { rate: true, rateDate: true, source: true } as const;

    const direct = await app.prisma.exchangeRate.findMany({
      where: {
        baseCurrency: query.from,
        quoteCurrency: query.to,
        rateDate: { gte: since, lte: new Date() },
      },
      orderBy: { rateDate: 'asc' },
      take: 1000,
      select,
    });

    const inverted = direct.length === 0;
    const source =
      direct.length > 0
        ? direct
        : await app.prisma.exchangeRate.findMany({
            where: {
              baseCurrency: query.to,
              quoteCurrency: query.from,
              rateDate: { gte: since, lte: new Date() },
            },
            orderBy: { rateDate: 'asc' },
            take: 1000,
            select,
          });

    const points = source.map((row) => ({
      rate: rateToString(
        inverted ? new Decimal(1).div(row.rate.toString()) : row.rate.toString(),
      ),
      rateDate: row.rateDate.toISOString().slice(0, 10),
      source: row.source,
    }));

    return ok(
      {
        from: query.from,
        to: query.to,
        days: query.days,
        inverted,
        points,
      },
      request.id,
    );
  });

  app.post('/admin/exchange-rates', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = requireAdmin(request);
    const body = rateBodySchema.parse(request.body);

    const rateDate = new Date(
      Date.UTC(body.rateDate.getUTCFullYear(), body.rateDate.getUTCMonth(), body.rateDate.getUTCDate()),
    );
    const key = {
      baseCurrency_quoteCurrency_rateDate: {
        baseCurrency: body.baseCurrency,
        quoteCurrency: body.quoteCurrency,
        rateDate,
      },
    };

    const existing = await app.prisma.exchangeRate.findUnique({ where: key, select: { id: true } });

    const saved = await app.prisma.$transaction(async (tx) => {
      const record = await tx.exchangeRate.upsert({
        where: key,
        create: {
          baseCurrency: body.baseCurrency,
          quoteCurrency: body.quoteCurrency,
          rate: body.rate,
          rateDate,
          source: 'manual',
        },
        // 人工录入总是权威值：覆盖自动写入的行时把来源也改回 manual，
        // 否则自动同步会误以为这一行可以再次刷新
        update: { rate: body.rate, source: 'manual' },
        select: {
          id: true,
          baseCurrency: true,
          quoteCurrency: true,
          rate: true,
          rateDate: true,
          source: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: existing ? 'admin.currency_rate.updated' : 'admin.currency_rate.created',
          targetType: 'exchange_rate',
          targetId: record.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          metadata: {
            baseCurrency: record.baseCurrency,
            quoteCurrency: record.quoteCurrency,
            rateDate: record.rateDate.toISOString().slice(0, 10),
            source: 'manual',
            ...(existing ? { changedFields: ['rate'] } : {}),
          },
        },
      });

      return record;
    });

    return reply.status(201).send(
      ok(
        {
          exchangeRate: { ...saved, rate: rateToString(saved.rate.toString()) },
          // 同一币种对同一天已存在时这里走的是覆盖，界面要能区分「新增」与「改掉别人写的值」
          replaced: Boolean(existing),
        },
        request.id,
      ),
    );
  });

  /**
   * 修改单条汇率。
   *
   * source 可省略：省略时沿用「人工改动即转人工」的既有规则，避免管理员只改数值
   * 却让这一行继续被自动同步覆盖。显式给出 provider 则是把这一行交还给自动同步，
   * 否则没有任何入口能撤销一次误触的人工覆盖，只能删行重录。
   */
  /**
   * 批量录入同一生效日期的多组汇率。
   *
   * 管理员通常一次拿到一整张当天的牌价，逐条 POST 既慢又会留下多条审计；
   * 这里在单个事务里写完整批，只记一条审计。任何一条校验不过就整批回滚，
   * 避免「一半写进去一半没写」需要人工对账。
   */
  app.post('/admin/exchange-rates/bulk', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = requireAdmin(request);
    const body = z
      .object({
        rateDate: z.coerce
          .date()
          .refine((value) => value.getTime() <= Date.now() + 86_400_000, '生效日期不能晚于今天'),
        rates: z
          .array(
            z
              .object({
                baseCurrency: currencySchema,
                quoteCurrency: currencySchema,
                rate: rateValueSchema,
              })
              .refine((value) => value.baseCurrency !== value.quoteCurrency, {
                message: '基准币种与计价币种不能相同',
              }),
          )
          .min(1, '至少需要一组汇率')
          .max(SUPPORTED_CURRENCIES.length * SUPPORTED_CURRENCIES.length, '一次提交的币种对过多'),
      })
      .parse(request.body);

    // 同一请求里重复的币种对会让 upsert 相互覆盖，结果取决于顺序，直接拒绝
    const seen = new Set<string>();
    for (const item of body.rates) {
      const key = `${item.baseCurrency}->${item.quoteCurrency}`;
      if (seen.has(key)) throw errors.validation(`重复的币种对：${key}`);
      seen.add(key);
    }

    const rateDate = new Date(
      Date.UTC(body.rateDate.getUTCFullYear(), body.rateDate.getUTCMonth(), body.rateDate.getUTCDate()),
    );

    const saved = await app.prisma.$transaction(async (tx) => {
      const records = [];
      for (const item of body.rates) {
        records.push(
          await tx.exchangeRate.upsert({
            where: {
              baseCurrency_quoteCurrency_rateDate: {
                baseCurrency: item.baseCurrency,
                quoteCurrency: item.quoteCurrency,
                rateDate,
              },
            },
            create: {
              baseCurrency: item.baseCurrency,
              quoteCurrency: item.quoteCurrency,
              rate: item.rate,
              rateDate,
              source: 'manual',
            },
            update: { rate: item.rate, source: 'manual' },
            select: {
              id: true,
              baseCurrency: true,
              quoteCurrency: true,
              rate: true,
              rateDate: true,
              source: true,
              updatedAt: true,
            },
          }),
        );
      }

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'admin.currency_rate.bulk_updated',
          targetType: 'exchange_rate',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          // 只记币种对与日期，数值不进审计
          metadata: {
            rateDate: rateDate.toISOString().slice(0, 10),
            pairs: body.rates.map((item) => `${item.baseCurrency}->${item.quoteCurrency}`),
            count: body.rates.length,
          },
        },
      });

      return records;
    });

    return reply.status(201).send(
      ok(
        {
          exchangeRates: saved.map((row) => ({ ...row, rate: rateToString(row.rate.toString()) })),
          writtenRows: saved.length,
          rateDate: rateDate.toISOString().slice(0, 10),
        },
        request.id,
      ),
    );
  });

  app.patch('/admin/exchange-rates/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = idSchema.parse(request.params);
    const body = z
      .object({
        rate: rateValueSchema,
        source: z.enum(['manual', 'provider']).optional(),
      })
      .parse(request.body);

    const existing = await app.prisma.exchangeRate.findUnique({
      where: { id },
      select: { id: true, baseCurrency: true, quoteCurrency: true, rateDate: true, source: true },
    });
    if (!existing) throw errors.notFound('汇率记录不存在');

    const source = body.source ?? 'manual';

    const saved = await app.prisma.$transaction(async (tx) => {
      const record = await tx.exchangeRate.update({
        where: { id },
        data: { rate: body.rate, source },
        select: {
          id: true,
          baseCurrency: true,
          quoteCurrency: true,
          rate: true,
          rateDate: true,
          source: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'admin.currency_rate.updated',
          targetType: 'exchange_rate',
          targetId: record.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          metadata: {
            baseCurrency: existing.baseCurrency,
            quoteCurrency: existing.quoteCurrency,
            rateDate: existing.rateDate.toISOString().slice(0, 10),
            changedFields: existing.source === source ? ['rate'] : ['rate', 'source'],
            ...(existing.source === source ? {} : { source }),
          },
        },
      });

      return record;
    });

    return ok({ exchangeRate: { ...saved, rate: rateToString(saved.rate.toString()) } }, request.id);
  });

  app.delete('/admin/exchange-rates/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = idSchema.parse(request.params);

    const existing = await app.prisma.exchangeRate.findUnique({
      where: { id },
      select: { id: true, baseCurrency: true, quoteCurrency: true, rateDate: true },
    });
    if (!existing) throw errors.notFound('汇率记录不存在');

    await app.prisma.$transaction(async (tx) => {
      await tx.exchangeRate.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'admin.currency_rate.deleted',
          targetType: 'exchange_rate',
          targetId: id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          metadata: {
            baseCurrency: existing.baseCurrency,
            quoteCurrency: existing.quoteCurrency,
            rateDate: existing.rateDate.toISOString().slice(0, 10),
          },
        },
      });
    });

    return ok({ deleted: true }, request.id);
  });

  app.get('/admin/rate-sync/settings', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);

    const [enabled, frequency] = await Promise.all([
      isRateSyncEnabled(app.prisma),
      getRateSyncFrequency(app.prisma),
    ]);

    return ok({ enabled, frequency, frequencies: RATE_SYNC_FREQUENCIES }, request.id);
  });

  app.patch('/admin/rate-sync/settings', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    // 两个字段都可省略：抽屉只改频率时不必回传开关状态，避免覆盖别人刚改的值
    const body = z
      .object({
        enabled: z.boolean().optional(),
        frequency: z.enum(RATE_SYNC_FREQUENCIES).optional(),
      })
      .refine((value) => value.enabled !== undefined || value.frequency !== undefined, {
        message: '至少需要提供一项要修改的设置',
      })
      .parse(request.body);

    if (body.enabled !== undefined) {
      await setRateSyncEnabled(app.prisma, body.enabled, actor.userId);
    }
    if (body.frequency !== undefined) {
      await setRateSyncFrequency(app.prisma, body.frequency, actor.userId);
    }

    await app.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        // 频率与开关分开记，审计里能看出是谁把同步调快/调慢了
        action:
          body.frequency !== undefined ? 'admin.rate_sync_frequency_changed' : 'admin.rate_sync_toggled',
        targetType: 'system_setting',
        metadata: {
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
        },
      },
    });

    // 频率或开关变了就立刻按新配置重排，否则要等旧定时器到期才生效
    await app.rateSyncScheduler?.reschedule();

    const [enabled, frequency] = await Promise.all([
      isRateSyncEnabled(app.prisma),
      getRateSyncFrequency(app.prisma),
    ]);

    return ok({ enabled, frequency, frequencies: RATE_SYNC_FREQUENCIES }, request.id);
  });

}
