import type { FastifyInstance, FastifyRequest } from 'fastify';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { IDEMPOTENCY_TTL_SECONDS } from '../../config/constants.js';
import { moneyToString, roundMoney, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { assertBalanced, buildEntries, type EntryDraft } from './entry.service.js';
import {
  bulkCategorizeSchema,
  bulkUpdateSchema,
  createTransactionSchema,
  createTransferSchema,
  listTransactionsSchema,
  transactionIdSchema,
  updateTransactionSchema,
} from './ledger.schema.js';

async function readIdempotencyKey(request: FastifyRequest, redis: FastifyInstance['redis']) {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0) return null;

  const cacheKey = `idem:${request.auth?.userId}:${request.url}:${key}`;
  const cached = await redis.get(cacheKey);
  return { cacheKey, cached };
}

export default async function ledgerRoutes(app: FastifyInstance) {
  // ===== 交易 =====

  app.get('/transactions', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listTransactionsSchema.parse(request.query);
    const page = parsePageParams(query);

    if (query.from && query.to && query.from > query.to) {
      throw errors.validation('起始日期不能晚于结束日期');
    }

    const where = {
      userId,
      ...(query.status === 'all' ? {} : { status: query.status }),
      ...(query.type ? { type: query.type } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      // 未分类下钻只针对收入与支出；转账与调整本就没有分类
      ...(query.uncategorized
        ? {
            categoryId: null,
            type: { in: ['income', 'expense'] as Array<'income' | 'expense'> },
          }
        : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.merchant
        ? { merchant: { contains: query.merchant, mode: 'insensitive' as const } }
        : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.accountId ? { entries: { some: { accountId: query.accountId } } } : {}),
      ...(query.keyword
        ? {
            OR: [
              { description: { contains: query.keyword, mode: 'insensitive' as const } },
              { merchant: { contains: query.keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, transactions] = await Promise.all([
      app.prisma.transaction.count({ where }),
      app.prisma.transaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          type: true,
          occurredAt: true,
          description: true,
          merchant: true,
          note: true,
          status: true,
          version: true,
          voidedAt: true,
          source: true,
          importBatchId: true,
          category: { select: { id: true, name: true, kind: true } },
          tags: { select: { tag: { select: { id: true, name: true } } } },
          entries: { select: { accountId: true, amount: true, currency: true } },
        },
      }),
    ]);

    const data = transactions.map(toTransactionDto);

    return ok({ transactions: data, pagination: buildPagination(page.page, page.pageSize, total) }, request.id);
  });

  app.post('/transactions', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createTransactionSchema.parse(request.body);
    const idem = await readIdempotencyKey(request, app.redis);

    if (idem?.cached) {
      return reply.status(200).send(ok(JSON.parse(idem.cached), request.id));
    }

    const account = await app.prisma.account.findFirst({
      where: { id: body.accountId, userId },
      select: { id: true, currency: true, status: true },
    });
    if (!account) throw errors.notFound('账户不存在');
    if (account.status === 'archived') throw errors.accountArchived();

    const category = await resolveCategory(app, userId, body.type, body.categoryId);

    const entries = buildEntries({
      type: body.type,
      magnitude: toDecimal(body.amount),
      accountId: body.accountId,
      currency: account.currency,
    });
    assertBalanced(entries, body.type);

    const transaction = await app.prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          userId,
          type: body.type,
          occurredAt: body.occurredAt,
          description: body.description,
          merchant: body.merchant ?? null,
          note: body.note ?? null,
          categoryId: category?.id ?? null,
          entries: {
            create: entries.map((entry) => ({
              userId,
              accountId: entry.accountId,
              amount: entry.amount.toString(),
              currency: entry.currency,
            })),
          },
          ...(body.tagIds && body.tagIds.length > 0
            ? { tags: { create: body.tagIds.map((tagId) => ({ tagId })) } }
            : {}),
        },
        select: transactionSelect,
      });

      return created;
    });

    const payload = { transaction: toTransactionDto(transaction) };
    if (idem) {
      await app.redis.set(idem.cacheKey, JSON.stringify(payload), 'EX', IDEMPOTENCY_TTL_SECONDS);
    }

    return reply.status(201).send(ok(payload, request.id));
  });

  app.get('/transactions/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = transactionIdSchema.parse(request.params);

    const transaction = await app.prisma.transaction.findFirst({
      where: { id, userId },
      select: transactionSelect,
    });

    if (!transaction) throw errors.notFound('交易不存在');
    return ok({ transaction: toTransactionDto(transaction) }, request.id);
  });

  app.patch('/transactions/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = transactionIdSchema.parse(request.params);
    const body = updateTransactionSchema.parse(request.body);

    const existing = await app.prisma.transaction.findFirst({
      where: { id, userId },
      include: { entries: true },
    });
    if (!existing) throw errors.notFound('交易不存在');
    if (existing.status === 'voided') throw errors.conflict('已冲正的交易不可修改');
    if (existing.version !== body.version) {
      throw errors.conflict('交易已被其他操作修改，请刷新后重试');
    }

    const category = await resolveCategory(
      app,
      userId,
      existing.type,
      body.categoryId === undefined ? existing.categoryId : body.categoryId,
    );

    await app.prisma.$transaction(async (tx) => {
      // 金额变化时必须重建分录并重新校验平衡，不能做增量修补
      if (body.amount !== undefined) {
        const realLeg = existing.entries.find((entry) => entry.accountId !== null);
        const externalLeg = existing.entries.find((entry) => entry.accountId === null);
        if (!realLeg || !externalLeg) {
          throw errors.ledgerUnbalanced('原交易分录结构异常');
        }

        const rebuilt: EntryDraft[] = buildEntries({
          type: existing.type as 'income' | 'expense' | 'adjustment',
          magnitude: toDecimal(body.amount),
          accountId: realLeg.accountId!,
          currency: realLeg.currency,
        });
        assertBalanced(rebuilt, existing.type as 'income' | 'expense' | 'adjustment');

        await tx.transactionEntry.deleteMany({ where: { transactionId: id } });
        await tx.transactionEntry.createMany({
          data: rebuilt.map((entry) => ({
            userId,
            transactionId: id,
            accountId: entry.accountId,
            amount: entry.amount.toString(),
            currency: entry.currency,
          })),
        });
      }

      await tx.transaction.update({
        where: { id },
        data: {
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.occurredAt !== undefined ? { occurredAt: body.occurredAt } : {}),
          ...(body.merchant !== undefined ? { merchant: body.merchant } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          categoryId: category?.id ?? null,
          version: { increment: 1 },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'transaction.updated',
          targetType: 'transaction',
          targetId: id,
          // 只记录字段名，不记录金额明细
          metadata: { fields: Object.keys(body).filter((key) => key !== 'version') },
        },
      });
    });

    const updated = await app.prisma.transaction.findUniqueOrThrow({
      where: { id },
      select: transactionSelect,
    });

    return ok({ transaction: toTransactionDto(updated) }, request.id);
  });

  // DELETE 语义为冲正：分录保留，历史可追溯
  app.delete('/transactions/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = transactionIdSchema.parse(request.params);

    const existing = await app.prisma.transaction.findFirst({ where: { id, userId } });
    if (!existing) throw errors.notFound('交易不存在');
    if (existing.status === 'voided') throw errors.conflict('交易已冲正');

    await app.prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id },
        data: { status: 'voided', voidedAt: new Date(), version: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: { userId, action: 'transaction.void', targetType: 'transaction', targetId: id },
      });
    });

    return ok({ voided: true }, request.id);
  });

  app.get('/transactions/:id/entries', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = transactionIdSchema.parse(request.params);

    const transaction = await app.prisma.transaction.findFirst({ where: { id, userId }, select: { id: true } });
    if (!transaction) throw errors.notFound('交易不存在');

    const entries = await app.prisma.transactionEntry.findMany({
      where: { transactionId: id },
      orderBy: { amount: 'asc' },
      select: {
        id: true,
        accountId: true,
        amount: true,
        currency: true,
        account: { select: { name: true, type: true } },
      },
    });

    return ok(
      {
        entries: entries.map((entry) => ({
          ...entry,
          amount: moneyToString(entry.amount.toString()),
          description: entry.account ? `${entry.account.name}（${entry.account.type}）` : '外部对手方',
        })),
        balanced: entries.reduce((sum, entry) => sum.plus(entry.amount.toString()), toDecimal(0)).isZero(),
      },
      request.id,
    );
  });

  // ===== 批量操作 =====

  app.post('/transactions/bulk-categorize', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = bulkCategorizeSchema.parse(request.body);

    const category = body.categoryId
      ? await app.prisma.category.findFirst({
          where: { id: body.categoryId, userId },
          select: { id: true, kind: true },
        })
      : null;

    if (body.categoryId && !category) throw errors.notFound('分类不存在');

    // 任一交易不属于当前用户 → 整体失败，避免部分成功造成不一致
    const transactions = await app.prisma.transaction.findMany({
      where: { id: { in: body.transactionIds }, userId },
      select: { id: true, type: true, status: true },
    });

    if (transactions.length !== body.transactionIds.length) {
      throw errors.notFound('部分交易不存在');
    }

    if (transactions.some((tx) => tx.status === 'voided')) {
      throw errors.conflict('已冲正的交易不可分类');
    }

    if (category) {
      const mismatched = transactions.filter(
        (tx) => tx.type !== category.kind && tx.type !== 'adjustment',
      );
      if (mismatched.length > 0) {
        throw errors.categoryKindMismatch();
      }
    }

    const result = await app.prisma.transaction.updateMany({
      where: { id: { in: body.transactionIds }, userId, status: 'posted' },
      data: { categoryId: category?.id ?? null, version: { increment: 1 } },
    });

    return ok({ updated: result.count }, request.id);
  });

  app.post('/transactions/bulk-update', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = bulkUpdateSchema.parse(request.body);

    if (body.note === undefined && (!body.addTagIds || body.addTagIds.length === 0)) {
      throw errors.validation('至少需要指定备注或标签');
    }

    const transactions = await app.prisma.transaction.findMany({
      where: { id: { in: body.transactionIds }, userId },
      select: { id: true },
    });
    if (transactions.length !== body.transactionIds.length) {
      throw errors.notFound('部分交易不存在');
    }

    await app.prisma.$transaction(async (tx) => {
      if (body.note !== undefined) {
        await tx.transaction.updateMany({
          where: { id: { in: body.transactionIds }, userId },
          data: { note: body.note, version: { increment: 1 } },
        });
      }

      if (body.addTagIds && body.addTagIds.length > 0) {
        // 已绑定的标签由唯一约束挡住，skipDuplicates 保证幂等
        await tx.transactionTag.createMany({
          data: body.addTagIds.flatMap((tagId) =>
            body.transactionIds.map((transactionId) => ({ transactionId, tagId })),
          ),
          skipDuplicates: true,
        });
      }
    });

    return ok({ updated: transactions.length }, request.id);
  });

  // ===== 转账 =====

  app.post('/transfers', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createTransferSchema.parse(request.body);
    const idem = await readIdempotencyKey(request, app.redis);

    if (idem?.cached) {
      return reply.status(200).send(ok(JSON.parse(idem.cached), request.id));
    }

    if (body.fromAccountId === body.toAccountId) {
      throw errors.validation('转出与转入账户不能相同');
    }

    const accounts = await app.prisma.account.findMany({
      where: { id: { in: [body.fromAccountId, body.toAccountId] }, userId },
      select: { id: true, currency: true, status: true, name: true },
    });

    if (accounts.length !== 2) throw errors.notFound('账户不存在');

    const from = accounts.find((a) => a.id === body.fromAccountId)!;
    const to = accounts.find((a) => a.id === body.toAccountId)!;

    if (from.status === 'archived' || to.status === 'archived') {
      throw errors.accountArchived();
    }
    if (from.currency !== to.currency) {
      throw errors.crossCurrencyTransfer();
    }

    const entries = buildEntries({
      type: 'transfer',
      magnitude: toDecimal(body.amount),
      accountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      currency: from.currency,
    });
    assertBalanced(entries, 'transfer');

    const transaction = await app.prisma.$transaction(async (tx) => {
      return tx.transaction.create({
        data: {
          userId,
          type: 'transfer',
          occurredAt: body.occurredAt,
          description: body.description ?? `转账：${from.name} → ${to.name}`,
          note: body.note ?? null,
          categoryId: null,
          entries: {
            create: entries.map((entry) => ({
              userId,
              accountId: entry.accountId,
              amount: entry.amount.toString(),
              currency: entry.currency,
            })),
          },
        },
        select: transactionSelect,
      });
    });

    const payload = { transaction: toTransactionDto(transaction) };
    if (idem) {
      await app.redis.set(idem.cacheKey, JSON.stringify(payload), 'EX', IDEMPOTENCY_TTL_SECONDS);
    }

    return reply.status(201).send(ok(payload, request.id));
  });

  app.get('/transfers', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    const where = { userId, type: 'transfer' as const, status: 'posted' as const };

    const [total, transactions] = await Promise.all([
      app.prisma.transaction.count({ where }),
      app.prisma.transaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: page.skip,
        take: page.take,
        select: transactionSelect,
      }),
    ]);

    return ok(
      {
        transfers: transactions.map(toTransactionDto),
        pagination: buildPagination(page.page, page.pageSize, total),
      },
      request.id,
    );
  });

  app.delete('/transfers/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = transactionIdSchema.parse(request.params);

    const existing = await app.prisma.transaction.findFirst({
      where: { id, userId, type: 'transfer' },
    });
    if (!existing) throw errors.notFound('转账记录不存在');
    if (existing.status === 'voided') throw errors.conflict('转账已冲正');

    await app.prisma.$transaction(async (tx) => {
      // 冲正转账使两条分录同时失效，余额自动回到转账前
      await tx.transaction.update({
        where: { id },
        data: { status: 'voided', voidedAt: new Date(), version: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: { userId, action: 'transfer.void', targetType: 'transaction', targetId: id },
      });
    });

    return ok({ voided: true }, request.id);
  });
}

const transactionSelect = {
  id: true,
  type: true,
  occurredAt: true,
  description: true,
  merchant: true,
  note: true,
  status: true,
  version: true,
  voidedAt: true,
  source: true,
  importBatchId: true,
  category: { select: { id: true, name: true, kind: true } },
  tags: { select: { tag: { select: { id: true, name: true } } } },
  entries: {
    select: {
      accountId: true,
      amount: true,
      currency: true,
      account: { select: { name: true, type: true } },
    },
  },
} as const;

type TransactionRow = {
  id: string;
  type: string;
  occurredAt: Date;
  description: string;
  merchant: string | null;
  note: string | null;
  status: string;
  version: number;
  voidedAt: Date | null;
  source: string;
  importBatchId: string | null;
  category: { id: string; name: string; kind: string } | null;
  tags: Array<{ tag: { id: string; name: string } }>;
  entries: Array<{
    accountId: string | null;
    // Prisma Decimal 序列化为字符串，统一按可 toString 的值处理
    amount: { toString(): string };
    currency: string;
    account?: { name: string; type: string } | null;
  }>;
};

function toTransactionDto(transaction: TransactionRow) {
  const accountEntries = transaction.entries.filter((entry) => entry.accountId !== null);
  const primary = accountEntries[0];

  // 展示金额取账户腿的“贡献方向”：收入为正，支出与转出为负
  const signedAmount = accountEntries.reduce(
    (sum, entry) => sum.plus(toDecimal(entry.amount.toString())),
    toDecimal(0),
  );

  return {
    id: transaction.id,
    type: transaction.type,
    occurredAt: transaction.occurredAt,
    description: transaction.description,
    merchant: transaction.merchant,
    note: transaction.note,
    status: transaction.status,
    version: transaction.version,
    voidedAt: transaction.voidedAt,
    source: transaction.source,
    importBatchId: transaction.importBatchId,
    category: transaction.category,
    tags: transaction.tags.map((item) => item.tag),
    amount: moneyToString(roundMoney(signedAmount)),
    currency: primary?.currency ?? 'CNY',
    account: primary?.account ? { name: primary.account.name, type: primary.account.type } : null,
    entries: transaction.entries.map((entry) => ({
      accountId: entry.accountId,
      accountName: entry.account?.name ?? null,
      amount: moneyToString(entry.amount.toString()),
      currency: entry.currency,
    })),
  };
}

async function resolveCategory(
  app: FastifyInstance,
  userId: string,
  type: 'income' | 'expense' | 'adjustment' | 'transfer' | 'investment',
  categoryId: string | null | undefined,
) {
  if (type === 'investment') {
    // 买卖是资产转换，不挂分类；通用记账接口也不允许创建该类型
    throw errors.validation('投资交易请通过投资模块录入');
  }

  if (type === 'transfer') {
    // 转账不是收支，不能挂分类
    if (categoryId) throw errors.validation('转账不能指定分类');
    return null;
  }

  if (categoryId) {
    const category = await app.prisma.category.findFirst({
      where: { id: categoryId, userId },
      select: { id: true, kind: true, archived: true },
    });

    if (!category) throw errors.notFound('分类不存在');
    if (category.archived) throw errors.validation('分类已归档');

    if (type !== 'adjustment' && category.kind !== type) {
      throw errors.categoryKindMismatch();
    }

    return category;
  }

  // 调整交易必须落到“其他收入/其他支出”，收入支出允许暂不分类
  if (type === 'adjustment') {
    throw errors.validation('余额调整必须指定分类');
  }

  return null;
}

