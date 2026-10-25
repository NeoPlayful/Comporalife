import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { rateToString, toDecimal } from '../../lib/money.js';
import { requireAuth, type AuthContext } from '../../plugins/auth.js';
import { isRateSyncEnabled, setRateSyncEnabled } from '../market-data/rate-sync.service.js';

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

const idSchema = z.object({ id: z.string().uuid() });

const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(200).optional(),
});

const requestListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

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
      ok({ exchangeRate: { ...saved, rate: rateToString(saved.rate.toString()) } }, request.id),
    );
  });

  app.patch('/admin/exchange-rates/:id', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const { id } = idSchema.parse(request.params);
    const body = z.object({ rate: rateValueSchema }).parse(request.body);

    const existing = await app.prisma.exchangeRate.findUnique({
      where: { id },
      select: { id: true, baseCurrency: true, quoteCurrency: true, rateDate: true },
    });
    if (!existing) throw errors.notFound('汇率记录不存在');

    const saved = await app.prisma.$transaction(async (tx) => {
      const record = await tx.exchangeRate.update({
        where: { id },
        data: { rate: body.rate, source: 'manual' },
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
            changedFields: ['rate'],
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
    return ok({ enabled: await isRateSyncEnabled(app.prisma) }, request.id);
  });

  app.patch('/admin/rate-sync/settings', { preHandler: app.authenticate }, async (request) => {
    const actor = requireAdmin(request);
    const body = z.object({ enabled: z.boolean() }).parse(request.body);

    await setRateSyncEnabled(app.prisma, body.enabled, actor.userId);

    await app.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        action: 'admin.rate_sync_toggled',
        targetType: 'system_setting',
        metadata: { enabled: body.enabled },
      },
    });

    return ok({ enabled: body.enabled }, request.id);
  });

  app.get('/admin/rate-pair-requests', { preHandler: app.authenticate }, async (request) => {
    requireAdmin(request);
    const query = requestListSchema.parse(request.query);
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    const where = query.status ? { status: query.status } : {};

    const [total, rows] = await Promise.all([
      app.prisma.ratePairRequest.count({ where }),
      app.prisma.ratePairRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          baseCurrency: true,
          quoteCurrency: true,
          reason: true,
          status: true,
          reviewNote: true,
          reviewedAt: true,
          createdAt: true,
          // 只暴露昵称，不返回邮箱与任何财务信息
          user: { select: { nickname: true } },
        },
      }),
    ]);

    return ok(
      { requests: rows, pagination: buildPagination(page.page, page.pageSize, total) },
      request.id,
    );
  });

  // 批准只表示「纳入维护范围」，不写入任何汇率值：
  // 批准一个币种对不等于知道它当天的汇率，凭空造一行就是编造数据。
  app.post(
    '/admin/rate-pair-requests/:id/review',
    { preHandler: app.authenticate },
    async (request) => {
      const actor = requireAdmin(request);
      const { id } = idSchema.parse(request.params);
      const body = reviewSchema.parse(request.body);

      const existing = await app.prisma.ratePairRequest.findUnique({
        where: { id },
        select: { id: true, baseCurrency: true, quoteCurrency: true, status: true },
      });
      if (!existing) throw errors.notFound('申请不存在');
      if (existing.status !== 'pending') throw errors.validation('该申请已审核');

      await app.prisma.$transaction(async (tx) => {
        await tx.ratePairRequest.update({
          where: { id },
          data: {
            status: body.status,
            reviewedBy: actor.userId,
            reviewedAt: new Date(),
            reviewNote: body.note ?? null,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: actor.userId,
            action: 'admin.rate_pair.reviewed',
            targetType: 'rate_pair_request',
            targetId: id,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
            metadata: {
              baseCurrency: existing.baseCurrency,
              quoteCurrency: existing.quoteCurrency,
              status: body.status,
            },
          },
        });
      });

      return ok({ status: body.status }, request.id);
    },
  );
}
