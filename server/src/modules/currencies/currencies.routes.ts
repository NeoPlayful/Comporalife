import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { rateToString } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { resolveRate } from './currency.service.js';

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

const pairRequestSchema = z
  .object({
    baseCurrency: currencySchema,
    quoteCurrency: currencySchema,
    reason: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.baseCurrency !== value.quoteCurrency, {
    message: '基准币种与计价币种不能相同',
  });

/**
 * 用户侧汇率接口：只读。
 *
 * 汇率是全局共享的系统参考数据，由后台统一维护（Phase 10）。用户不能写，
 * 只能查看、设置展示偏好、对缺失的币种对提交申请。
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

  // 列表：全局只读。路径沿用以免前端与文档大面积改动，语义已从「我的汇率」变为「全部汇率」
  app.get('/exchange-rates/manual', { preHandler: app.authenticate }, async (request) => {
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    // 汇率按日累积，全量返回会让列表无限增长
    const [total, records] = await Promise.all([
      app.prisma.exchangeRate.count(),
      app.prisma.exchangeRate.findMany({
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
        },
      }),
    ]);

    return ok(
      {
        exchangeRates: records.map((record) => ({
          ...record,
          rate: rateToString(record.rate.toString()),
        })),
        pagination: buildPagination(page.page, page.pageSize, total),
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

  app.get('/exchange-rates/pair-requests', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    const [total, requests] = await Promise.all([
      app.prisma.ratePairRequest.count({ where: { userId } }),
      app.prisma.ratePairRequest.findMany({
        where: { userId },
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
        },
      }),
    ]);

    return ok(
      { requests, pagination: buildPagination(page.page, page.pageSize, total) },
      request.id,
    );
  });

  app.post('/exchange-rates/pair-requests', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = pairRequestSchema.parse(request.body);

    const existing = await app.prisma.ratePairRequest.findFirst({
      where: {
        userId,
        baseCurrency: body.baseCurrency,
        quoteCurrency: body.quoteCurrency,
        status: 'pending',
      },
      select: { id: true },
    });
    if (existing) throw errors.ratePairRequestExists();

    const created = await app.prisma.ratePairRequest.create({
      data: {
        userId,
        baseCurrency: body.baseCurrency,
        quoteCurrency: body.quoteCurrency,
        reason: body.reason ?? null,
      },
      select: {
        id: true,
        baseCurrency: true,
        quoteCurrency: true,
        reason: true,
        status: true,
        createdAt: true,
      },
    });

    return reply.status(201).send(ok({ request: created }, request.id));
  });

  // 只允许撤销自己的待审申请；已审核的记录删掉会让审核痕迹消失
  app.delete('/exchange-rates/pair-requests/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = request.params as { id: string };

    const existing = await app.prisma.ratePairRequest.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!existing) throw errors.notFound('申请不存在');
    if (existing.status !== 'pending') {
      throw errors.validation('已审核的申请不能撤销');
    }

    await app.prisma.ratePairRequest.delete({ where: { id } });
    return ok({ deleted: true }, request.id);
  });
}
