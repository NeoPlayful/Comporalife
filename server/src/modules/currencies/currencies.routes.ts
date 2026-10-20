import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../../config/constants.js';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { rateToString, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { resolveRate } from './currency.service.js';

const currencySchema = z
  .string()
  .refine((value) => SUPPORTED_CURRENCIES.includes(value), '不支持的币种');

const manualRateSchema = z.object({
  baseCurrency: currencySchema,
  quoteCurrency: currencySchema,
  rate: z
    .string()
    .regex(/^\d+(\.\d{1,10})?$/, '汇率格式不正确')
    .refine((value) => toDecimal(value).gt(0), '汇率必须大于 0'),
  rateDate: z.coerce.date(),
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

    const record = await app.prisma.exchangeRate.upsert({
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

    return reply.status(201).send(
      ok({ exchangeRate: { ...record, rate: rateToString(record.rate.toString()) } }, request.id),
    );
  });

  app.get('/exchange-rates/manual', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);

    const records = await app.prisma.exchangeRate.findMany({
      where: { userId },
      orderBy: [{ rateDate: 'desc' }, { baseCurrency: 'asc' }],
      select: {
        id: true,
        baseCurrency: true,
        quoteCurrency: true,
        rate: true,
        rateDate: true,
        source: true,
      },
    });

    return ok(
      {
        exchangeRates: records.map((record) => ({
          ...record,
          rate: rateToString(record.rate.toString()),
        })),
      },
      request.id,
    );
  });

  app.delete('/exchange-rates/manual/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = request.params as { id: string };

    const result = await app.prisma.exchangeRate.deleteMany({ where: { id, userId } });
    if (result.count === 0) throw errors.notFound('汇率记录不存在');

    return ok({ deleted: true }, request.id);
  });
}
