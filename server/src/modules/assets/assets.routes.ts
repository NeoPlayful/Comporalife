import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { resolveRate } from '../currencies/currency.service.js';
import {
  assetIdSchema,
  assetValuationIdSchema,
  createAssetSchema,
  createValuationSchema,
  listAssetsSchema,
  updateAssetSchema,
} from './assets.schema.js';

interface ValuationRow {
  id: string;
  valuationDate: Date;
  value: unknown;
  basis: string;
  note: string | null;
  createdAt: Date;
}

function moneyToString(value: unknown): string {
  return toDecimal(value as string).toFixed(6);
}

/** 取 asOf 之前（含当天）的最后一条估值；未来日期的估值不参与 */
function latestValuation(valuations: ValuationRow[], asOf: Date): ValuationRow | null {
  let latest: ValuationRow | null = null;
  for (const item of valuations) {
    if (item.valuationDate.getTime() > asOf.getTime()) continue;
    if (!latest || item.valuationDate.getTime() > latest.valuationDate.getTime()) {
      latest = item;
    }
  }
  return latest;
}

export default async function assetsRoutes(app: FastifyInstance) {
  // ===== 汇总（必须注册在 /:id 之前，否则会被当成 ID 解析） =====
  app.get('/assets/summary', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const asOf = new Date();

    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { baseCurrency: true },
    });

    const assets = await app.prisma.asset.findMany({
      where: { userId, status: 'active' },
      select: {
        id: true,
        name: true,
        kind: true,
        currency: true,
        valuations: {
          orderBy: { valuationDate: 'desc' },
          select: { id: true, valuationDate: true, value: true, basis: true, note: true, createdAt: true },
        },
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });

    const items: Array<{ id: string; name: string; kind: string; currency: string; value: ReturnType<typeof toDecimal> }> = [];
    const unpriced: Array<{ id: string; name: string; reason: string }> = [];

    for (const asset of assets) {
      const latest = latestValuation(asset.valuations as ValuationRow[], asOf);
      if (!latest) {
        unpriced.push({ id: asset.id, name: asset.name, reason: 'no_valuation' });
        continue;
      }
      items.push({ id: asset.id, name: asset.name, kind: asset.kind, currency: asset.currency, value: toDecimal(latest.value as string) });
    }

    // 逐项折算：需要知道哪一条缺汇率，只拿总数无法区分是「没有资产」还是「缺汇率」
    let total = toDecimal(0);
    const byKind = new Map<string, ReturnType<typeof toDecimal>>();
    const byCurrency = new Map<string, ReturnType<typeof toDecimal>>();
    const missingRate: Array<{ id: string; name: string; currency: string }> = [];
    const rateCache = new Map<string, { rate: ReturnType<typeof toDecimal> } | null>();

    for (const item of items) {
      byCurrency.set(item.currency, (byCurrency.get(item.currency) ?? toDecimal(0)).plus(item.value));

      let rate: { rate: ReturnType<typeof toDecimal> } | null;
      if (item.currency === settings.baseCurrency) {
        rate = { rate: toDecimal(1) };
      } else {
        const key = `${item.currency}->${settings.baseCurrency}`;
        if (!rateCache.has(key)) {
          const found = await resolveRate(app.prisma, {
            from: item.currency,
            to: settings.baseCurrency,
            asOf,
          });
          rateCache.set(key, found ? { rate: found.rate } : null);
        }
        rate = rateCache.get(key) ?? null;
      }

      if (!rate) {
        missingRate.push({ id: item.id, name: item.name, currency: item.currency });
        continue;
      }

      const convertedAmount = item.value.mul(rate.rate);
      total = total.plus(convertedAmount);
      byKind.set(item.kind, (byKind.get(item.kind) ?? toDecimal(0)).plus(convertedAmount));
    }

    return ok(
      {
        total: roundMoney(total).toFixed(6),
        baseCurrency: settings.baseCurrency,
        byKind: [...byKind.entries()].map(([kind, amount]) => ({ kind, amount: roundMoney(amount).toFixed(6) })),
        byCurrency: [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount: roundMoney(amount).toFixed(6) })),
        unpriced,
        missingRate,
        basis: { asOf: asOf.toISOString(), baseCurrency: settings.baseCurrency },
      },
      request.id,
    );
  });

  // ===== 列表 =====
  app.get('/assets', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listAssetsSchema.parse(request.query);
    const asOf = new Date();

    const assets = await app.prisma.asset.findMany({
      where: {
        userId,
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(query.kind ? { kind: query.kind } : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        kind: true,
        currency: true,
        purchaseDate: true,
        purchasePrice: true,
        note: true,
        status: true,
        version: true,
        archivedAt: true,
        createdAt: true,
        valuations: {
          orderBy: { valuationDate: 'desc' },
          select: { id: true, valuationDate: true, value: true, basis: true, note: true, createdAt: true },
        },
      },
    });

    return ok(
      {
        assets: assets.map((asset) => {
          const latest = latestValuation(asset.valuations as ValuationRow[], asOf);
          return {
            id: asset.id,
            name: asset.name,
            kind: asset.kind,
            currency: asset.currency,
            purchaseDate: asset.purchaseDate ? asset.purchaseDate.toISOString().slice(0, 10) : null,
            purchasePrice: asset.purchasePrice ? moneyToString(asset.purchasePrice) : null,
            note: asset.note,
            status: asset.status,
            version: asset.version,
            archivedAt: asset.archivedAt?.toISOString() ?? null,
            createdAt: asset.createdAt.toISOString(),
            valuationCount: asset.valuations.length,
            latestValuation: latest
              ? {
                  id: latest.id,
                  valuationDate: latest.valuationDate.toISOString().slice(0, 10),
                  value: moneyToString(latest.value),
                  basis: latest.basis,
                }
              : null,
            stale: latest
              ? (asOf.getTime() - latest.valuationDate.getTime()) / 86_400_000 > 90
              : true,
          };
        }),
      },
      request.id,
    );
  });

  // ===== 详情 =====
  app.get('/assets/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = assetIdSchema.parse(request.params);
    const asOf = new Date();

    const asset = await app.prisma.asset.findFirst({
      where: { id, userId },
      select: {
        id: true,
        name: true,
        kind: true,
        currency: true,
        purchaseDate: true,
        purchasePrice: true,
        note: true,
        status: true,
        version: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        valuations: {
          orderBy: { valuationDate: 'desc' },
          select: { id: true, valuationDate: true, value: true, basis: true, note: true, createdAt: true },
        },
      },
    });

    if (!asset) throw errors.assetNotFound();

    const latest = latestValuation(asset.valuations as ValuationRow[], asOf);

    return ok(
      {
        asset: {
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          currency: asset.currency,
          purchaseDate: asset.purchaseDate ? asset.purchaseDate.toISOString().slice(0, 10) : null,
          purchasePrice: asset.purchasePrice ? moneyToString(asset.purchasePrice) : null,
          note: asset.note,
          status: asset.status,
          version: asset.version,
          archivedAt: asset.archivedAt?.toISOString() ?? null,
          createdAt: asset.createdAt.toISOString(),
          updatedAt: asset.updatedAt.toISOString(),
          latestValuation: latest
            ? {
                id: latest.id,
                valuationDate: latest.valuationDate.toISOString().slice(0, 10),
                value: moneyToString(latest.value),
                basis: latest.basis,
              }
            : null,
          valuations: asset.valuations.map((item) => ({
            id: item.id,
            valuationDate: item.valuationDate.toISOString().slice(0, 10),
            value: moneyToString(item.value),
            basis: item.basis,
            note: item.note,
            createdAt: item.createdAt.toISOString(),
          })),
        },
      },
      request.id,
    );
  });

  // ===== 创建 =====
  app.post('/assets', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createAssetSchema.parse(request.body ?? {});

    const duplicate = await app.prisma.asset.findFirst({
      where: { userId, name: body.name },
      select: { id: true },
    });
    if (duplicate) throw errors.assetNameExists();

    const asset = await app.prisma.asset.create({
      data: {
        userId,
        name: body.name,
        kind: body.kind,
        currency: body.currency,
        purchaseDate: body.purchaseDate ? new Date(`${body.purchaseDate}T00:00:00.000Z`) : null,
        purchasePrice: body.purchasePrice ?? null,
        note: body.note ?? null,
      },
      select: { id: true, name: true, kind: true, currency: true, status: true, version: true, createdAt: true },
    });

    return reply.status(201).send(ok({ asset }, request.id));
  });

  // ===== 更新 =====
  app.patch('/assets/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = assetIdSchema.parse(request.params);
    const body = updateAssetSchema.parse(request.body ?? {});
    const { version, ...rest } = body;

    const existing = await app.prisma.asset.findFirst({
      where: { id, userId },
      select: { id: true, version: true, status: true },
    });
    if (!existing) throw errors.assetNotFound();
    if (existing.status === 'archived') throw errors.assetArchived();
    if (existing.version !== version) throw errors.conflict('资产已被修改，请刷新后重试');

    if (rest.name) {
      const duplicate = await app.prisma.asset.findFirst({
        where: { userId, name: rest.name, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) throw errors.assetNameExists();
    }

    const asset = await app.prisma.asset.update({
      where: { id },
      data: {
        ...(rest.name !== undefined ? { name: rest.name } : {}),
        ...(rest.kind !== undefined ? { kind: rest.kind } : {}),
        ...(rest.currency !== undefined ? { currency: rest.currency } : {}),
        ...(rest.purchaseDate !== undefined
          ? { purchaseDate: rest.purchaseDate ? new Date(`${rest.purchaseDate}T00:00:00.000Z`) : null }
          : {}),
        ...(rest.purchasePrice !== undefined ? { purchasePrice: rest.purchasePrice } : {}),
        ...(rest.note !== undefined ? { note: rest.note } : {}),
        version: { increment: 1 },
      },
      select: { id: true, name: true, kind: true, currency: true, status: true, version: true },
    });

    return ok({ asset }, request.id);
  });

  // ===== 删除（归档） =====
  app.delete('/assets/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = assetIdSchema.parse(request.params);

    const asset = await app.prisma.asset.findFirst({
      where: { id, userId },
      select: { id: true, _count: { select: { valuations: true } } },
    });
    if (!asset) throw errors.assetNotFound();

    // 有估值记录的资产只归档：硬删会让历史净资产无法复现
    if (asset._count.valuations > 0) {
      throw errors.assetHasValuations(asset._count.valuations);
    }

    await app.prisma.asset.update({
      where: { id },
      data: { status: 'archived', archivedAt: new Date(), version: { increment: 1 } },
    });

    return ok({ archived: true }, request.id);
  });

  // ===== 估值快照 =====
  app.get('/assets/:id/valuations', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = assetIdSchema.parse(request.params);

    const asset = await app.prisma.asset.findFirst({ where: { id, userId }, select: { id: true } });
    if (!asset) throw errors.assetNotFound();

    const valuations = await app.prisma.assetValuation.findMany({
      where: { assetId: id, userId },
      orderBy: { valuationDate: 'desc' },
      select: { id: true, valuationDate: true, value: true, basis: true, note: true, createdAt: true },
    });

    return ok(
      {
        valuations: valuations.map((item) => ({
          id: item.id,
          valuationDate: item.valuationDate.toISOString().slice(0, 10),
          value: moneyToString(item.value),
          basis: item.basis,
          note: item.note,
          createdAt: item.createdAt.toISOString(),
        })),
      },
      request.id,
    );
  });

  app.post('/assets/:id/valuations', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = assetIdSchema.parse(request.params);
    const body = createValuationSchema.parse(request.body ?? {});

    const asset = await app.prisma.asset.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!asset) throw errors.assetNotFound();
    if (asset.status === 'archived') throw errors.assetArchived();

    const valuationDate = new Date(`${body.valuationDate}T00:00:00.000Z`);

    const existing = await app.prisma.assetValuation.findFirst({
      where: { assetId: id, valuationDate },
      select: { id: true },
    });

    if (existing && !body.overwrite) {
      throw errors.assetValuationExists();
    }

    const valuation = existing
      ? await app.prisma.assetValuation.update({
          where: { id: existing.id },
          data: { value: body.value, basis: body.basis, note: body.note ?? null },
          select: { id: true, valuationDate: true, value: true, basis: true, note: true },
        })
      : await app.prisma.assetValuation.create({
          data: {
            userId,
            assetId: id,
            valuationDate,
            value: body.value,
            basis: body.basis,
            note: body.note ?? null,
          },
          select: { id: true, valuationDate: true, value: true, basis: true, note: true },
        });

    return reply.status(existing ? 200 : 201).send(
      ok(
        {
          valuation: {
            ...valuation,
            valuationDate: valuation.valuationDate.toISOString().slice(0, 10),
            value: moneyToString(valuation.value),
          },
        },
        request.id,
      ),
    );
  });

  app.delete('/assets/:id/valuations/:valuationId', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id, valuationId } = assetValuationIdSchema.parse(request.params);

    const valuation = await app.prisma.assetValuation.findFirst({
      where: { id: valuationId, assetId: id, userId },
      select: { id: true },
    });
    if (!valuation) throw errors.assetNotFound();

    await app.prisma.assetValuation.delete({ where: { id: valuationId } });

    return ok({ deleted: true }, request.id);
  });
}
