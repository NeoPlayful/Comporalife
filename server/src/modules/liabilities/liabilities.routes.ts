import type { FastifyInstance } from 'fastify';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { resolveRate } from '../currencies/currency.service.js';
import {
  createLiabilitySchema,
  createLiabilitySnapshotSchema,
  liabilityIdSchema,
  liabilitySnapshotIdSchema,
  listLiabilitiesSchema,
  updateLiabilitySchema,
} from './liabilities.schema.js';

interface SnapshotRow {
  id: string;
  snapshotDate: Date;
  balance: unknown;
  note: string | null;
  createdAt: Date;
}

function moneyToString(value: unknown): string {
  return toDecimal(value as string).toFixed(6);
}

function latestSnapshot(snapshots: SnapshotRow[], asOf: Date): SnapshotRow | null {
  let latest: SnapshotRow | null = null;
  for (const item of snapshots) {
    if (item.snapshotDate.getTime() > asOf.getTime()) continue;
    if (!latest || item.snapshotDate.getTime() > latest.snapshotDate.getTime()) {
      latest = item;
    }
  }
  return latest;
}

export default async function liabilitiesRoutes(app: FastifyInstance) {
  // ===== 汇总（必须在 /:id 之前） =====
  app.get('/liabilities/summary', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const asOf = new Date();

    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { baseCurrency: true },
    });

    const liabilities = await app.prisma.liability.findMany({
      where: { userId, status: 'active' },
      select: {
        id: true,
        name: true,
        kind: true,
        currency: true,
        snapshots: {
          orderBy: { snapshotDate: 'desc' },
          select: { id: true, snapshotDate: true, balance: true, note: true, createdAt: true },
        },
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });

    const items: Array<{ id: string; name: string; kind: string; currency: string; value: ReturnType<typeof toDecimal> }> = [];
    const unpriced: Array<{ id: string; name: string; reason: string }> = [];

    for (const liability of liabilities) {
      const latest = latestSnapshot(liability.snapshots as SnapshotRow[], asOf);
      if (!latest) {
        unpriced.push({ id: liability.id, name: liability.name, reason: 'no_snapshot' });
        continue;
      }
      items.push({
        id: liability.id,
        name: liability.name,
        kind: liability.kind,
        currency: liability.currency,
        value: toDecimal(latest.balance as string),
      });
    }

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

      const converted = item.value.mul(rate.rate);
      total = total.plus(converted);
      byKind.set(item.kind, (byKind.get(item.kind) ?? toDecimal(0)).plus(converted));
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
  app.get('/liabilities', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listLiabilitiesSchema.parse(request.query);
    const asOf = new Date();

    const liabilities = await app.prisma.liability.findMany({
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
        originalAmount: true,
        startDate: true,
        interestRate: true,
        note: true,
        status: true,
        version: true,
        archivedAt: true,
        createdAt: true,
        snapshots: {
          orderBy: { snapshotDate: 'desc' },
          select: { id: true, snapshotDate: true, balance: true, note: true, createdAt: true },
        },
      },
    });

    return ok(
      {
        liabilities: liabilities.map((liability) => {
          const latest = latestSnapshot(liability.snapshots as SnapshotRow[], asOf);
          return {
            id: liability.id,
            name: liability.name,
            kind: liability.kind,
            currency: liability.currency,
            originalAmount: liability.originalAmount ? moneyToString(liability.originalAmount) : null,
            startDate: liability.startDate ? liability.startDate.toISOString().slice(0, 10) : null,
            interestRate: liability.interestRate ? moneyToString(liability.interestRate) : null,
            note: liability.note,
            status: liability.status,
            version: liability.version,
            archivedAt: liability.archivedAt?.toISOString() ?? null,
            createdAt: liability.createdAt.toISOString(),
            snapshotCount: liability.snapshots.length,
            latestSnapshot: latest
              ? {
                  id: latest.id,
                  snapshotDate: latest.snapshotDate.toISOString().slice(0, 10),
                  balance: moneyToString(latest.balance),
                }
              : null,
            stale: latest
              ? (asOf.getTime() - latest.snapshotDate.getTime()) / 86_400_000 > 90
              : true,
          };
        }),
      },
      request.id,
    );
  });

  // ===== 详情 =====
  app.get('/liabilities/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = liabilityIdSchema.parse(request.params);
    const asOf = new Date();

    const liability = await app.prisma.liability.findFirst({
      where: { id, userId },
      select: {
        id: true,
        name: true,
        kind: true,
        currency: true,
        originalAmount: true,
        startDate: true,
        interestRate: true,
        note: true,
        status: true,
        version: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        snapshots: {
          orderBy: { snapshotDate: 'desc' },
          select: { id: true, snapshotDate: true, balance: true, note: true, createdAt: true },
        },
      },
    });

    if (!liability) throw errors.liabilityNotFound();

    const latest = latestSnapshot(liability.snapshots as SnapshotRow[], asOf);

    return ok(
      {
        liability: {
          id: liability.id,
          name: liability.name,
          kind: liability.kind,
          currency: liability.currency,
          originalAmount: liability.originalAmount ? moneyToString(liability.originalAmount) : null,
          startDate: liability.startDate ? liability.startDate.toISOString().slice(0, 10) : null,
          interestRate: liability.interestRate ? moneyToString(liability.interestRate) : null,
          note: liability.note,
          status: liability.status,
          version: liability.version,
          archivedAt: liability.archivedAt?.toISOString() ?? null,
          createdAt: liability.createdAt.toISOString(),
          updatedAt: liability.updatedAt.toISOString(),
          latestSnapshot: latest
            ? {
                id: latest.id,
                snapshotDate: latest.snapshotDate.toISOString().slice(0, 10),
                balance: moneyToString(latest.balance),
              }
            : null,
          snapshots: liability.snapshots.map((item) => ({
            id: item.id,
            snapshotDate: item.snapshotDate.toISOString().slice(0, 10),
            balance: moneyToString(item.balance),
            note: item.note,
            createdAt: item.createdAt.toISOString(),
          })),
        },
      },
      request.id,
    );
  });

  // ===== 创建 =====
  app.post('/liabilities', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createLiabilitySchema.parse(request.body ?? {});

    const duplicate = await app.prisma.liability.findFirst({
      where: { userId, name: body.name },
      select: { id: true },
    });
    if (duplicate) throw errors.liabilityNameExists();

    const liability = await app.prisma.liability.create({
      data: {
        userId,
        name: body.name,
        kind: body.kind,
        currency: body.currency,
        originalAmount: body.originalAmount ?? null,
        startDate: body.startDate ? new Date(`${body.startDate}T00:00:00.000Z`) : null,
        interestRate: body.interestRate ?? null,
        note: body.note ?? null,
      },
      select: { id: true, name: true, kind: true, currency: true, status: true, version: true, createdAt: true },
    });

    return reply.status(201).send(ok({ liability }, request.id));
  });

  // ===== 更新 =====
  app.patch('/liabilities/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = liabilityIdSchema.parse(request.params);
    const body = updateLiabilitySchema.parse(request.body ?? {});
    const { version, ...rest } = body;

    const existing = await app.prisma.liability.findFirst({
      where: { id, userId },
      select: { id: true, version: true, status: true },
    });
    if (!existing) throw errors.liabilityNotFound();
    if (existing.status === 'archived') throw errors.liabilityArchived();
    if (existing.version !== version) throw errors.conflict('负债已被修改，请刷新后重试');

    if (rest.name) {
      const duplicate = await app.prisma.liability.findFirst({
        where: { userId, name: rest.name, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) throw errors.liabilityNameExists();
    }

    const liability = await app.prisma.liability.update({
      where: { id },
      data: {
        ...(rest.name !== undefined ? { name: rest.name } : {}),
        ...(rest.kind !== undefined ? { kind: rest.kind } : {}),
        ...(rest.currency !== undefined ? { currency: rest.currency } : {}),
        ...(rest.originalAmount !== undefined ? { originalAmount: rest.originalAmount } : {}),
        ...(rest.startDate !== undefined
          ? { startDate: rest.startDate ? new Date(`${rest.startDate}T00:00:00.000Z`) : null }
          : {}),
        ...(rest.interestRate !== undefined ? { interestRate: rest.interestRate } : {}),
        ...(rest.note !== undefined ? { note: rest.note } : {}),
        version: { increment: 1 },
      },
      select: { id: true, name: true, kind: true, currency: true, status: true, version: true },
    });

    return ok({ liability }, request.id);
  });

  // ===== 删除（归档） =====
  app.delete('/liabilities/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = liabilityIdSchema.parse(request.params);

    const liability = await app.prisma.liability.findFirst({
      where: { id, userId },
      select: { id: true, _count: { select: { snapshots: true } } },
    });
    if (!liability) throw errors.liabilityNotFound();

    if (liability._count.snapshots > 0) {
      throw errors.liabilityHasSnapshots(liability._count.snapshots);
    }

    await app.prisma.liability.update({
      where: { id },
      data: { status: 'archived', archivedAt: new Date(), version: { increment: 1 } },
    });

    return ok({ archived: true }, request.id);
  });

  // ===== 余额快照 =====
  app.get('/liabilities/:id/balance-snapshots', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = liabilityIdSchema.parse(request.params);

    const liability = await app.prisma.liability.findFirst({ where: { id, userId }, select: { id: true } });
    if (!liability) throw errors.liabilityNotFound();

    const snapshots = await app.prisma.liabilitySnapshot.findMany({
      where: { liabilityId: id, userId },
      orderBy: { snapshotDate: 'desc' },
      select: { id: true, snapshotDate: true, balance: true, note: true, createdAt: true },
    });

    return ok(
      {
        snapshots: snapshots.map((item) => ({
          id: item.id,
          snapshotDate: item.snapshotDate.toISOString().slice(0, 10),
          balance: moneyToString(item.balance),
          note: item.note,
          createdAt: item.createdAt.toISOString(),
        })),
      },
      request.id,
    );
  });

  app.post('/liabilities/:id/balance-snapshots', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = liabilityIdSchema.parse(request.params);
    const body = createLiabilitySnapshotSchema.parse(request.body ?? {});

    const liability = await app.prisma.liability.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!liability) throw errors.liabilityNotFound();
    if (liability.status === 'archived') throw errors.liabilityArchived();

    const snapshotDate = new Date(`${body.snapshotDate}T00:00:00.000Z`);

    const existing = await app.prisma.liabilitySnapshot.findFirst({
      where: { liabilityId: id, snapshotDate },
      select: { id: true },
    });

    if (existing && !body.overwrite) {
      throw errors.liabilitySnapshotExists();
    }

    const snapshot = existing
      ? await app.prisma.liabilitySnapshot.update({
          where: { id: existing.id },
          data: { balance: body.balance, note: body.note ?? null },
          select: { id: true, snapshotDate: true, balance: true, note: true },
        })
      : await app.prisma.liabilitySnapshot.create({
          data: {
            userId,
            liabilityId: id,
            snapshotDate,
            balance: body.balance,
            note: body.note ?? null,
          },
          select: { id: true, snapshotDate: true, balance: true, note: true },
        });

    return reply.status(existing ? 200 : 201).send(
      ok(
        {
          snapshot: {
            ...snapshot,
            snapshotDate: snapshot.snapshotDate.toISOString().slice(0, 10),
            balance: moneyToString(snapshot.balance),
          },
        },
        request.id,
      ),
    );
  });

  app.delete(
    '/liabilities/:id/balance-snapshots/:snapshotId',
    { preHandler: app.authenticate },
    async (request) => {
      const { userId } = requireAuth(request);
      const { id, snapshotId } = liabilitySnapshotIdSchema.parse(request.params);

      const snapshot = await app.prisma.liabilitySnapshot.findFirst({
        where: { id: snapshotId, liabilityId: id, userId },
        select: { id: true },
      });
      if (!snapshot) throw errors.liabilityNotFound();

      await app.prisma.liabilitySnapshot.delete({ where: { id: snapshotId } });

      return ok({ deleted: true }, request.id);
    },
  );
}
