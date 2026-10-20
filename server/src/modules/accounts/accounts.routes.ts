import type { FastifyInstance } from 'fastify';
import { eachDayOfInterval, eachMonthOfInterval, format } from 'date-fns';
import { ok, parsePageParams, buildPagination } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { moneyToString, roundMoney, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { computeBalance, computeBalances } from './balance.service.js';
import {
  accountIdSchema,
  balanceHistorySchema,
  createAccountSchema,
  listAccountsSchema,
  reconcileSchema,
  updateAccountSchema,
} from './accounts.schema.js';

export default async function accountsRoutes(app: FastifyInstance) {
  app.get('/accounts', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listAccountsSchema.parse(request.query);

    const accounts = await app.prisma.account.findMany({
      where: {
        userId,
        ...(query.status === 'all' ? {} : { status: query.status }),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        type: true,
        institution: true,
        currency: true,
        openingBalance: true,
        openingBalanceDate: true,
        status: true,
        note: true,
        version: true,
        archivedAt: true,
        createdAt: true,
      },
    });

    const balances = await computeBalances(app.prisma, {
      userId,
      accountIds: accounts.map((a) => a.id),
    });

    const data = accounts.map((account) => ({
      ...account,
      openingBalance: moneyToString(account.openingBalance.toString()),
      balance: moneyToString(balances.get(account.id) ?? toDecimal(0)),
    }));

    return ok({ accounts: data }, request.id);
  });

  app.post('/accounts', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createAccountSchema.parse(request.body);

    const account = await app.prisma.account.create({
      data: {
        userId,
        name: body.name,
        type: body.type,
        institution: body.institution ?? null,
        currency: body.currency,
        openingBalance: body.openingBalance,
        openingBalanceDate: body.openingBalanceDate,
        note: body.note ?? null,
      },
      select: {
        id: true,
        name: true,
        type: true,
        institution: true,
        currency: true,
        openingBalance: true,
        openingBalanceDate: true,
        status: true,
        note: true,
        version: true,
        createdAt: true,
      },
    });

    return reply.status(201).send(
      ok(
        {
          account: { ...account, openingBalance: moneyToString(account.openingBalance.toString()) },
        },
        request.id,
      ),
    );
  });

  app.get('/accounts/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);

    const account = await app.prisma.account.findFirst({
      where: { id, userId },
      select: {
        id: true,
        name: true,
        type: true,
        institution: true,
        currency: true,
        openingBalance: true,
        openingBalanceDate: true,
        status: true,
        note: true,
        version: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!account) throw errors.notFound('账户不存在');

    const balance = await computeBalance(app.prisma, { userId, accountId: id });

    return ok(
      {
        account: {
          ...account,
          openingBalance: moneyToString(account.openingBalance.toString()),
          balance: moneyToString(balance.balance),
          entryCount: balance.entryCount,
        },
      },
      request.id,
    );
  });

  app.patch('/accounts/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);
    const body = updateAccountSchema.parse(request.body);

    const existing = await app.prisma.account.findFirst({ where: { id, userId } });
    if (!existing) throw errors.notFound('账户不存在');

    if (existing.version !== body.version) {
      throw errors.conflict('账户已被其他操作修改，请刷新后重试');
    }

    const updates = {
      name: body.name,
      institution: body.institution,
      openingBalance: body.openingBalance,
      openingBalanceDate: body.openingBalanceDate,
      note: body.note,
    };
    // version 已用于上面的乐观锁校验，不写入更新字段
    const definedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    );

    const openingChanged =
      updates.openingBalance !== undefined &&
      roundMoney(updates.openingBalance).toString() !== roundMoney(existing.openingBalance.toString()).toString();

    const account = await app.prisma.$transaction(async (tx) => {
      const updated = await tx.account.update({
        where: { id },
        data: { ...definedUpdates, version: { increment: 1 } },
        select: {
          id: true,
          name: true,
          type: true,
          institution: true,
          currency: true,
          openingBalance: true,
          openingBalanceDate: true,
          status: true,
          note: true,
          version: true,
          updatedAt: true,
        },
      });

      if (openingChanged) {
        // 期初余额属于账本口径的一部分，修改必须留痕（只记录前后值，不记录分录明细）
        await tx.auditLog.create({
          data: {
            userId,
            action: 'account.opening_balance_changed',
            targetType: 'account',
            targetId: id,
            metadata: {
              before: existing.openingBalance.toString(),
              after: updated.openingBalance.toString(),
            },
          },
        });
      }

      return updated;
    });

    const balance = await computeBalance(app.prisma, { userId, accountId: id });

    return ok(
      {
        account: {
          ...account,
          openingBalance: moneyToString(account.openingBalance.toString()),
          balance: moneyToString(balance.balance),
        },
        warning: openingChanged && balance.entryCount > 0
          ? '该账户已有流水，修改期初余额会整体平移余额曲线'
          : undefined,
      },
      request.id,
    );
  });

  app.delete('/accounts/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);

    const account = await app.prisma.account.findFirst({ where: { id, userId } });
    if (!account) throw errors.notFound('账户不存在');

    const entryCount = await app.prisma.transactionEntry.count({ where: { accountId: id, userId } });
    if (entryCount > 0) {
      throw errors.accountHasTransactions();
    }

    await app.prisma.account.update({
      where: { id },
      data: { status: 'archived', archivedAt: new Date() },
    });

    return ok({ archived: true }, request.id);
  });

  app.post('/accounts/:id/archive', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);

    const result = await app.prisma.account.updateMany({
      where: { id, userId },
      data: { status: 'archived', archivedAt: new Date() },
    });

    if (result.count === 0) throw errors.notFound('账户不存在');
    return ok({ archived: true }, request.id);
  });

  app.post('/accounts/:id/unarchive', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);

    const result = await app.prisma.account.updateMany({
      where: { id, userId },
      data: { status: 'active', archivedAt: null },
    });

    if (result.count === 0) throw errors.notFound('账户不存在');
    return ok({ archived: false }, request.id);
  });

  app.get('/accounts/:id/balance', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);

    const asOfRaw = (request.query as { asOf?: string }).asOf;
    const asOf = asOfRaw ? new Date(asOfRaw) : null;
    if (asOfRaw && Number.isNaN(asOf!.getTime())) {
      throw errors.validation('asOf 日期格式不正确');
    }

    const balance = await computeBalance(app.prisma, { userId, accountId: id, asOf });

    return ok(
      {
        accountId: balance.accountId,
        currency: balance.currency,
        balance: moneyToString(balance.balance),
        openingBalance: moneyToString(balance.openingBalance),
        openingBalanceDate: balance.openingBalanceDate,
        entryCount: balance.entryCount,
        asOf: balance.asOf,
        // 口径必须随数值一起返回，前端据此展示
        basis: '期初余额 + 已入账分录合计',
      },
      request.id,
    );
  });

  app.get('/accounts/:id/balance-history', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);
    const query = balanceHistorySchema.parse(request.query);

    if (query.from > query.to) throw errors.validation('起始日期不能晚于结束日期');

    const maxSpanDays = 366 * 2;
    const spanDays = (query.to.getTime() - query.from.getTime()) / 86_400_000;
    if (spanDays > maxSpanDays) {
      throw errors.validation('余额历史最多查询两年');
    }

    const granularity = query.granularity ?? (spanDays <= 90 ? 'day' : 'month');

    const account = await app.prisma.account.findFirst({
      where: { id, userId },
      select: { openingBalance: true, openingBalanceDate: true, currency: true },
    });
    if (!account) throw errors.notFound('账户不存在');

    const entries = await app.prisma.transactionEntry.findMany({
      where: {
        accountId: id,
        userId,
        transaction: { status: 'posted', occurredAt: { lte: query.to } },
      },
      select: { amount: true, createdAt: true, transaction: { select: { occurredAt: true } } },
      orderBy: { transaction: { occurredAt: 'asc' } },
    });

    const points =
      granularity === 'day'
        ? eachDayOfInterval({ start: query.from, end: query.to }).map((d) => format(d, 'yyyy-MM-dd'))
        : eachMonthOfInterval({ start: query.from, end: query.to }).map((d) => format(d, 'yyyy-MM'));

    const opening = toDecimal(account.openingBalance.toString());
    const series: Array<{ period: string; balance: string }> = [];

    let running = opening;
    let index = 0;

    for (const point of points) {
      while (index < entries.length) {
        const entryDate = format(entries[index]!.transaction.occurredAt, granularity === 'day' ? 'yyyy-MM-dd' : 'yyyy-MM');
        if (entryDate > point) break;
        running = running.plus(entries[index]!.amount.toString());
        index += 1;
      }

      // 期初基准日之前的点直接显示期初余额
      series.push({ period: point, balance: moneyToString(running) });
    }

    return ok(
      { accountId: id, currency: account.currency, granularity, series, basis: '期末余额快照' },
      request.id,
    );
  });

  app.get('/accounts/:id/transactions', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    const account = await app.prisma.account.findFirst({
      where: { id, userId },
      select: { id: true, currency: true },
    });
    if (!account) throw errors.notFound('账户不存在');

    const where = {
      userId,
      entries: { some: { accountId: id } },
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
          status: true,
          category: { select: { id: true, name: true, kind: true } },
          entries: {
            where: { accountId: id },
            select: { amount: true, currency: true },
            take: 1,
          },
        },
      }),
    ]);

    const data = transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      occurredAt: tx.occurredAt,
      description: tx.description,
      merchant: tx.merchant,
      status: tx.status,
      category: tx.category,
      amount: moneyToString(tx.entries[0]?.amount?.toString() ?? '0'),
      currency: tx.entries[0]?.currency ?? account.currency,
    }));

    return ok({ transactions: data, pagination: buildPagination(page.page, page.pageSize, total) }, request.id);
  });

  app.post('/accounts/:id/reconcile', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);
    const body = reconcileSchema.parse(request.body);

    const balance = await computeBalance(app.prisma, { userId, accountId: id, asOf: body.reconciledAt });
    const statement = toDecimal(body.statementBalance);
    const difference = roundMoney(statement.minus(balance.balance));

    const record = await app.prisma.accountReconciliation.create({
      data: {
        userId,
        accountId: id,
        statementBalance: statement.toString(),
        computedBalance: balance.balance.toString(),
        difference: difference.toString(),
        reconciledAt: body.reconciledAt,
        note: body.note ?? null,
      },
    });

    return reply.status(201).send(
      ok(
        {
          reconciliation: {
            id: record.id,
            statementBalance: moneyToString(statement),
            computedBalance: moneyToString(balance.balance),
            difference: moneyToString(difference),
            reconciledAt: record.reconciledAt,
          },
          // 对账只记录差异，不自动调整账本
          suggestion: difference.isZero()
            ? null
            : '差异未写入账本。如需修正，请创建一笔“余额调整”交易。',
        },
        request.id,
      ),
    );
  });

  app.get('/accounts/:id/reconciliations', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = accountIdSchema.parse(request.params);

    const records = await app.prisma.accountReconciliation.findMany({
      where: { accountId: id, userId },
      orderBy: { reconciledAt: 'desc' },
      select: {
        id: true,
        statementBalance: true,
        computedBalance: true,
        difference: true,
        reconciledAt: true,
        note: true,
        createdAt: true,
      },
    });

    return ok(
      {
        reconciliations: records.map((record) => ({
          ...record,
          statementBalance: moneyToString(record.statementBalance.toString()),
          computedBalance: moneyToString(record.computedBalance.toString()),
          difference: moneyToString(record.difference.toString()),
        })),
      },
      request.id,
    );
  });

  app.get(
    '/accounts/:id/reconciliations/:reconciliationId',
    { preHandler: app.authenticate },
    async (request) => {
      const { userId } = requireAuth(request);
      const { id } = accountIdSchema.parse(request.params);
      const { reconciliationId } = request.params as { reconciliationId: string };

      const record = await app.prisma.accountReconciliation.findFirst({
        where: { id: reconciliationId, accountId: id, userId },
        select: {
          id: true,
          statementBalance: true,
          computedBalance: true,
          difference: true,
          reconciledAt: true,
          note: true,
          createdAt: true,
        },
      });

      if (!record) throw errors.notFound('对账记录不存在');

      return ok(
        {
          reconciliation: {
            ...record,
            statementBalance: moneyToString(record.statementBalance.toString()),
            computedBalance: moneyToString(record.computedBalance.toString()),
            difference: moneyToString(record.difference.toString()),
          },
        },
        request.id,
      );
    },
  );
}

