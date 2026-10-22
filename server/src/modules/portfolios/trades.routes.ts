/**
 * 投资交易：写交易行 + 写账本必须在同一事务内完成，
 * 否则会出现"持仓有了、账本没扣钱"的半成功状态。
 */
import type { FastifyInstance } from 'fastify';
import { formatInTimeZone } from 'date-fns-tz';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { getUserAnalyticsContext } from '../analytics/analytics.service.js';
import {
  assertPortfolioActive,
  availableQuantityAt,
  voidLedgerTransaction,
  writeTradeLedger,
} from './portfolio.service.js';
import {
  listTradesSchema,
  tradeIdSchema,
  createTradeSchema,
  updateTradeSchema,
} from './portfolios.schema.js';

const INCOME_KINDS = new Set(['dividend', 'interest']);

/** 股息/利息/费用/税费必须有分类，否则会拉低分类覆盖率 */
async function resolveCategoryId(
  app: FastifyInstance,
  params: { userId: string; kind: string; categoryId: string | null | undefined },
): Promise<string | null> {
  const kind = params.kind;
  if (kind === 'buy' || kind === 'sell') return null;

  const expectedKind = INCOME_KINDS.has(kind) ? 'income' : 'expense';

  if (!params.categoryId) {
    // 允许自动落到同名分类，找不到就要求用户先建
    // 名称对齐内置分类模板；税费模板中没有专门的分类，落到"手续费"所在组，
    // 用户可随时改到自己的分类
    const fallbackName = INCOME_KINDS.has(kind)
      ? kind === 'dividend'
        ? ['分红', '投资收益', 'Dividends']
        : ['利息', '利息收入', 'Interest']
      : ['手续费', '投资费用', 'Fees'];

    const fallback = await app.prisma.category.findFirst({
      where: {
        userId: params.userId,
        kind: expectedKind,
        archived: false,
        name: { in: fallbackName },
      },
      select: { id: true },
    });

    if (!fallback) throw errors.tradeCategoryRequired();
    return fallback.id;
  }

  const category = await app.prisma.category.findFirst({
    where: { id: params.categoryId, userId: params.userId },
    select: { id: true, kind: true, archived: true },
  });

  if (!category) throw errors.categoryKindMismatch();
  if (category.archived) throw errors.validation('分类已归档');
  if (category.kind !== expectedKind) throw errors.categoryKindMismatch();

  return category.id;
}

function tradeAmount(quantity: string | null | undefined, price: string | null | undefined, amount?: string) {
  if (amount) return toDecimal(amount);
  if (quantity && price) return roundMoney(toDecimal(quantity).mul(toDecimal(price)));
  return toDecimal(0);
}

export default async function tradesRoutes(app: FastifyInstance) {
  app.get('/portfolio-trades', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const context = await getUserAnalyticsContext(app.prisma, userId);
    const query = listTradesSchema.parse(request.query);

    const trades = await app.prisma.portfolioTrade.findMany({
      where: {
        userId,
        ...(query.portfolioId ? { portfolioId: query.portfolioId } : {}),
        ...(query.instrumentId ? { instrumentId: query.instrumentId } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.includeVoided ? {} : { voidedAt: null }),
        ...(query.from || query.to
          ? {
              tradeDate: {
                ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
                ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ tradeDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        portfolioId: true,
        instrumentId: true,
        kind: true,
        tradeDate: true,
        quantity: true,
        price: true,
        amount: true,
        fee: true,
        tax: true,
        transactionId: true,
        note: true,
        voidedAt: true,
        version: true,
        instrument: { select: { symbol: true, name: true, currency: true } },
        portfolio: { select: { name: true, currency: true } },
      },
    });

    return ok(
      {
        items: trades.map((trade) => ({
          id: trade.id,
          portfolioId: trade.portfolioId,
          portfolioName: trade.portfolio.name,
          instrumentId: trade.instrumentId,
          symbol: trade.instrument?.symbol ?? null,
          instrumentName: trade.instrument?.name ?? null,
          kind: trade.kind,
          tradeDate: formatInTimeZone(trade.tradeDate, context.timezone, 'yyyy-MM-dd'),
          quantity: trade.quantity === null ? null : trade.quantity.toFixed(8),
          price: trade.price === null ? null : trade.price.toFixed(8),
          amount: roundMoney(toDecimal(trade.amount.toString())).toFixed(6),
          fee: roundMoney(toDecimal(trade.fee.toString())).toFixed(6),
          tax: roundMoney(toDecimal(trade.tax.toString())).toFixed(6),
          transactionId: trade.transactionId,
          note: trade.note,
          voided: trade.voidedAt !== null,
          version: trade.version,
        })),
        timezone: context.timezone,
      },
      request.id,
    );
  });

  app.post('/portfolio-trades', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createTradeSchema.parse(request.body);

    const portfolio = await assertPortfolioActive(app.prisma, {
      userId,
      portfolioId: body.portfolioId,
    });

    let instrumentId: string | null = null;
    if (body.instrumentId) {
      const instrument = await app.prisma.instrument.findFirst({
        where: { id: body.instrumentId, userId },
        select: { id: true, symbol: true, name: true, currency: true },
      });
      if (!instrument) throw errors.instrumentNotFound();
      // 标的币种必须与账户一致，否则成本与市值不可加
      if (instrument.currency !== portfolio.currency) {
        throw errors.instrumentCurrencyMismatch();
      }
      instrumentId = instrument.id;
    }

    const kind = body.kind;
    const isTrade = kind === 'buy' || kind === 'sell';

    if (isTrade && !instrumentId) throw errors.tradeInvalid('买卖必须指定标的');

    const tradeDate = new Date(body.tradeDate);
    const quantity = isTrade && body.quantity ? toDecimal(body.quantity) : null;
    const price = isTrade && body.price ? toDecimal(body.price) : null;

    if (isTrade) {
      if (!quantity || quantity.lte(0)) throw errors.tradeInvalid('买卖数量必须为正数');
      if (!price || price.lte(0)) throw errors.tradeInvalid('买卖价格必须为正数');
    }

    // 卖出按成交日校验，历史超卖必须被拦下
    if (kind === 'sell' && instrumentId && quantity) {
      const available = await availableQuantityAt(app.prisma, {
        userId,
        portfolioId: portfolio.id,
        instrumentId,
        tradeDate,
      });
      if (quantity.gt(available)) {
        throw errors.tradeSellExceedsHolding(quantity.toFixed(8), available.toFixed(8));
      }
    }

    const amount = tradeAmount(body.quantity, body.price, body.amount);
    const fee = body.fee ? toDecimal(body.fee) : toDecimal(0);
    const tax = body.tax ? toDecimal(body.tax) : toDecimal(0);

    if (!isTrade && amount.lte(0)) throw errors.tradeInvalid('金额必须为正数');

    const categoryId = await resolveCategoryId(app, {
      userId,
      kind,
      categoryId: body.categoryId,
    });

    const instrumentName = instrumentId
      ? (
          await app.prisma.instrument.findFirst({
            where: { id: instrumentId },
            select: { symbol: true, name: true },
          })
        )?.name
      : undefined;

    const description =
      body.note?.trim() ||
      `${kindLabel(kind)}${instrumentName ? ` ${instrumentName}` : ''}`.trim();

    const result = await app.prisma.$transaction(async (tx) => {
      const ledger = await writeTradeLedger(tx, {
        userId,
        accountId: portfolio.accountId,
        currency: portfolio.currency,
        kind,
        tradeDate,
        amount,
        fee,
        tax,
        categoryId,
        description,
      });

      const trade = await tx.portfolioTrade.create({
        data: {
          userId,
          portfolioId: portfolio.id,
          instrumentId,
          kind,
          tradeDate,
          quantity: isTrade ? quantity : null,
          price: isTrade ? price : null,
          amount,
          fee,
          tax,
          transactionId: ledger?.transactionId ?? null,
          note: body.note ?? null,
        },
        select: { id: true, version: true },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'trade.created',
          targetType: 'portfolio',
          targetId: portfolio.id,
          metadata: { tradeId: trade.id, kind, instrumentId },
        },
      });

      return trade;
    });

    return reply.status(201).send(ok({ id: result.id, version: result.version }, request.id));
  });

  app.get('/portfolio-trades/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = tradeIdSchema.parse(request.params);
    const context = await getUserAnalyticsContext(app.prisma, userId);

    const trade = await app.prisma.portfolioTrade.findFirst({
      where: { id, userId },
      select: {
        id: true,
        portfolioId: true,
        instrumentId: true,
        kind: true,
        tradeDate: true,
        quantity: true,
        price: true,
        amount: true,
        fee: true,
        tax: true,
        transactionId: true,
        note: true,
        voidedAt: true,
        version: true,
        instrument: { select: { symbol: true, name: true } },
        portfolio: { select: { name: true, currency: true } },
      },
    });

    if (!trade) throw errors.tradeNotFound();

    return ok(
      {
        id: trade.id,
        portfolioId: trade.portfolioId,
        portfolioName: trade.portfolio.name,
        instrumentId: trade.instrumentId,
        symbol: trade.instrument?.symbol ?? null,
        instrumentName: trade.instrument?.name ?? null,
        kind: trade.kind,
        tradeDate: formatInTimeZone(trade.tradeDate, context.timezone, 'yyyy-MM-dd'),
        quantity: trade.quantity === null ? null : trade.quantity.toFixed(8),
        price: trade.price === null ? null : trade.price.toFixed(8),
        amount: roundMoney(toDecimal(trade.amount.toString())).toFixed(6),
        fee: roundMoney(toDecimal(trade.fee.toString())).toFixed(6),
        tax: roundMoney(toDecimal(trade.tax.toString())).toFixed(6),
        transactionId: trade.transactionId,
        note: trade.note,
        voided: trade.voidedAt !== null,
        version: trade.version,
      },
      request.id,
    );
  });

  app.patch('/portfolio-trades/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = tradeIdSchema.parse(request.params);
    const body = updateTradeSchema.parse(request.body);

    const existing = await app.prisma.portfolioTrade.findFirst({
      where: { id, userId },
      select: {
        id: true,
        portfolioId: true,
        instrumentId: true,
        kind: true,
        tradeDate: true,
        quantity: true,
        price: true,
        amount: true,
        fee: true,
        tax: true,
        transactionId: true,
        note: true,
        voidedAt: true,
        version: true,
      },
    });

    if (!existing) throw errors.tradeNotFound();
    if (existing.voidedAt) throw errors.validation('已撤销的交易不可修改');
    if (existing.version !== body.version) {
      throw errors.conflict('交易已被其他操作修改，请刷新后重试');
    }

    const portfolio = await assertPortfolioActive(app.prisma, {
      userId,
      portfolioId: existing.portfolioId,
    });

    const isTrade = existing.kind === 'buy' || existing.kind === 'sell';

    const tradeDate = body.tradeDate ? new Date(body.tradeDate) : existing.tradeDate;
    const quantity = body.quantity ? toDecimal(body.quantity) : existing.quantity ? toDecimal(existing.quantity.toString()) : null;
    const price = body.price ? toDecimal(body.price) : existing.price ? toDecimal(existing.price.toString()) : null;

    if (isTrade) {
      if (!quantity || quantity.lte(0)) throw errors.tradeInvalid('买卖数量必须为正数');
      if (!price || price.lte(0)) throw errors.tradeInvalid('买卖价格必须为正数');
    }

    const amount =
      isTrade && quantity && price
        ? roundMoney(quantity.mul(price))
        : body.amount
          ? toDecimal(body.amount)
          : toDecimal(existing.amount.toString());

    const fee = body.fee ? toDecimal(body.fee) : toDecimal(existing.fee.toString());
    const tax = body.tax ? toDecimal(body.tax) : toDecimal(existing.tax.toString());

    // 修改后同样要校验超卖：改数量或改日期都可能造成历史超卖
    if (existing.kind === 'sell' && existing.instrumentId && quantity) {
      const available = await availableQuantityAt(app.prisma, {
        userId,
        portfolioId: existing.portfolioId,
        instrumentId: existing.instrumentId,
        tradeDate,
      });
      // 需要排除自身原来的卖出量
      const ownPrevious =
        existing.quantity && existing.tradeDate.getTime() <= tradeDate.getTime()
          ? toDecimal(existing.quantity.toString())
          : toDecimal(0);
      if (quantity.gt(available.plus(ownPrevious))) {
        throw errors.tradeSellExceedsHolding(
          quantity.toFixed(8),
          available.plus(ownPrevious).toFixed(8),
        );
      }
    }

    const categoryId = await resolveCategoryId(app, {
      userId,
      kind: existing.kind,
      categoryId: body.categoryId,
    });

    const result = await app.prisma.$transaction(async (tx) => {
      // 冲正旧账本交易后重建，不原地改分录，保留审计链
      if (existing.transactionId) {
        await voidLedgerTransaction(tx, { userId, transactionId: existing.transactionId });
      }

      const ledger = await writeTradeLedger(tx, {
        userId,
        accountId: portfolio.accountId,
        currency: portfolio.currency,
        kind: existing.kind,
        tradeDate,
        amount,
        fee,
        tax,
        categoryId,
        description: body.note?.trim() || `${kindLabel(existing.kind)}`,
      });

      const updated = await tx.portfolioTrade.update({
        where: { id },
        data: {
          tradeDate,
          quantity: isTrade ? quantity : null,
          price: isTrade ? price : null,
          amount,
          fee,
          tax,
          transactionId: ledger?.transactionId ?? null,
          ...(body.note !== undefined ? { note: body.note } : {}),
          version: { increment: 1 },
        },
        select: { id: true, version: true },
      });

      return updated;
    });

    return ok(result, request.id);
  });

  app.delete('/portfolio-trades/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = tradeIdSchema.parse(request.params);

    const existing = await app.prisma.portfolioTrade.findFirst({
      where: { id, userId },
      select: { id: true, portfolioId: true, transactionId: true, voidedAt: true },
    });

    if (!existing) throw errors.tradeNotFound();
    if (existing.voidedAt) return ok({ voided: true }, request.id);

    await app.prisma.$transaction(async (tx) => {
      if (existing.transactionId) {
        await voidLedgerTransaction(tx, { userId, transactionId: existing.transactionId });
      }

      // 软删：保留交易行，持仓重放自动排除
      await tx.portfolioTrade.update({
        where: { id },
        data: { voidedAt: new Date(), version: { increment: 1 } },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'trade.voided',
          targetType: 'portfolio',
          targetId: existing.portfolioId,
          metadata: { tradeId: id },
        },
      });
    });

    return ok({ voided: true }, request.id);
  });
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'buy':
      return '买入';
    case 'sell':
      return '卖出';
    case 'dividend':
      return '股息';
    case 'interest':
      return '利息';
    case 'fee':
      return '手续费';
    default:
      return '税费';
  }
}
