import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { rateToString, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { resolveRate } from './currency.service.js';

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

// DECIMAL(20,10) 只留 10 位整数位，超出会在写库时溢出变成 500
const manualRateSchema = z.object({
  baseCurrency: currencySchema,
  quoteCurrency: currencySchema,
  rate: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,10})?$/, '汇率格式不正确：整数位最多 10 位、小数位最多 10 位')
    .refine((value) => toDecimal(value).gt(0), '汇率必须为大于 0 的数值'),
  // 未来汇率会被 resolveRate 的 rateDate <= asOf 条件静默跳过，禁止录入
  rateDate: z.coerce
    .date()
    .refine((value) => value.getTime() <= Date.now() + 86_400_000, '生效日期不能晚于今天'),
});

export default async function currenciesRoutes(app: FastifyInstance) {
  app.get('/exchange-rates', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = request.query as { from?: string; to?: string; asOf?: string };

    if (!query.from || !query.to) {
      throw errors.validation('必须指定 from 与 to 币种');
    }

    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      throw errors.validation('asOf 日期格式不正确');
    }

    const result = await resolveRate(app.prisma, { userId, from: query.from, to: query.to, asOf });

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

  app.post('/exchange-rates/manual', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = manualRateSchema.parse(request.body);

    if (body.baseCurrency === body.quoteCurrency) {
      throw errors.validation('基准币种与计价币种不能相同');
    }

    const rateDate = new Date(
      Date.UTC(body.rateDate.getUTCFullYear(), body.rateDate.getUTCMonth(), body.rateDate.getUTCDate()),
    );

    // 修改汇率会直接改变净资产，必须留痕；同一键的覆盖要区分「新建」与「修改」
    const existing = await app.prisma.exchangeRate.findUnique({
      where: {
        userId_baseCurrency_quoteCurrency_rateDate: {
          userId,
          baseCurrency: body.baseCurrency,
          quoteCurrency: body.quoteCurrency,
          rateDate,
        },
      },
      select: { id: true, rate: true },
    });

    const record = await app.prisma.$transaction(async (tx) => {
      const saved = await tx.exchangeRate.upsert({
        where: {
          userId_baseCurrency_quoteCurrency_rateDate: {
            userId,
            baseCurrency: body.baseCurrency,
            quoteCurrency: body.quoteCurrency,
            rateDate,
          },
        },
        create: {
          userId,
          baseCurrency: body.baseCurrency,
          quoteCurrency: body.quoteCurrency,
          rate: body.rate,
          rateDate,
          source: 'manual',
        },
        update: { rate: body.rate },
        select: {
          id: true,
          baseCurrency: true,
          quoteCurrency: true,
          rate: true,
          rateDate: true,
          source: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: existing ? 'currency_rate.updated' : 'currency_rate.created',
          targetType: 'exchange_rate',
          targetId: saved.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          metadata: {
            baseCurrency: saved.baseCurrency,
            quoteCurrency: saved.quoteCurrency,
            rateDate: saved.rateDate.toISOString().slice(0, 10),
            ...(existing
              ? { changedFields: ['rate'], reason: 'manual_override' }
              : {}),
          },
        },
      });

      return saved;
    });

    return reply.status(201).send(
      ok({ exchangeRate: { ...record, rate: rateToString(record.rate.toString()) } }, request.id),
    );
  });

  app.get('/exchange-rates/manual', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    // 汇率按日累积，全量返回会让列表无限增长
    const [total, records] = await Promise.all([
      app.prisma.exchangeRate.count({ where: { userId } }),
      app.prisma.exchangeRate.findMany({
        where: { userId },
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

  app.delete('/exchange-rates/manual/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = request.params as { id: string };

    await app.prisma.$transaction(async (tx) => {
      const existing = await tx.exchangeRate.findFirst({
        where: { id, userId },
        select: { id: true, baseCurrency: true, quoteCurrency: true, rateDate: true },
      });
      if (!existing) throw errors.notFound('汇率记录不存在');

      await tx.exchangeRate.deleteMany({ where: { id, userId } });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'currency_rate.deleted',
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
}
