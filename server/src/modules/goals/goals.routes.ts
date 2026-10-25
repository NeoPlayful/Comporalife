/**
 * 路由顺序：/goals/summary、/financial-independence/* 等固定路径
 * 必须注册在 /goals/:id 之前，否则会被参数路由吞掉
 * （与 /imports/templates、/budgets/summary、/simulations/monte-carlo/compare 同一个坑）。
 */
import type { FastifyInstance } from 'fastify';
import Decimal from 'decimal.js';
import { formatInTimeZone } from 'date-fns-tz';
import { GOAL_MAX_COUNT } from '../../config/constants.js';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { moneyToString, roundMoney, toDecimal } from '../../lib/money.js';
import { requireAuth } from '../../plugins/auth.js';
import { computeCashflow } from '../analytics/cashflow.service.js';
import { computeFinancialIndependence } from './financial-independence.service.js';
import { computeGoalHistory, computeGoalProgress } from './goal.service.js';
import {
  createGoalSchema,
  fiCalculateSchema,
  goalIdSchema,
  historyQuerySchema,
  listGoalsSchema,
  projectionSchema,
  updateGoalSchema,
} from './goals.schema.js';
import { projectGoal } from './projection.service.js';

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function loadGoalOrThrow(app: FastifyInstance, userId: string, goalId: string) {
  const goal = await app.prisma.financialGoal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw errors.goalNotFound();
  return goal;
}

/** 绑定资金来源必须属于当前用户且状态可用，币种一致 */
async function assertFunding(app: FastifyInstance, userId: string, body: {
  fundingSource: 'net_worth' | 'account' | 'portfolio';
  accountId?: string | null;
  portfolioId?: string | null;
  currency: string;
}) {
  if (body.fundingSource === 'account') {
    const account = await app.prisma.account.findFirst({
      where: { id: body.accountId ?? '', userId },
      select: { id: true, currency: true, status: true },
    });
    if (!account) throw errors.goalFundingInvalid('选择的账户不存在');
    if (account.status !== 'active') throw errors.goalFundingInvalid('选择的账户已归档');
    if (account.currency !== body.currency) {
      throw errors.goalFundingInvalid('账户币种与目标币种不一致', {
        accountCurrency: account.currency,
        goalCurrency: body.currency,
      });
    }
  }

  if (body.fundingSource === 'portfolio') {
    const portfolio = await app.prisma.portfolio.findFirst({
      where: { id: body.portfolioId ?? '', userId },
      select: { id: true, currency: true, status: true },
    });
    if (!portfolio) throw errors.goalFundingInvalid('选择的投资组合不存在');
    if (portfolio.status !== 'active') throw errors.goalFundingInvalid('选择的投资组合已归档');
    if (portfolio.currency !== body.currency) {
      throw errors.goalFundingInvalid('组合币种与目标币种不一致', {
        portfolioCurrency: portfolio.currency,
        goalCurrency: body.currency,
      });
    }
  }
}

/**
 * 可投资结余：最近 6 个完整月的平均净结余。
 * 样本不足时返回 null 而不是按现有月份外推——外推会把一次大额收入
 * 变成一个"每月都能存这么多"的假信号。
 */
async function computeInvestableSurplus(
  app: FastifyInstance,
  params: { userId: string; timezone: string; baseCurrency: string },
): Promise<{ surplus: Decimal | null; months: number; isComplete: boolean }> {
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 5, 1));

  const cashflow = await computeCashflow(app.prisma, {
    userId: params.userId,
    timezone: params.timezone,
    baseCurrency: params.baseCurrency,
    from,
    to,
  });

  const complete = cashflow.points.filter((point) => point.isComplete);
  if (complete.length < 3) return { surplus: null, months: complete.length, isComplete: false };

  const total = complete.reduce((sum, point) => sum.plus(point.net), new Decimal(0));

  return {
    surplus: roundMoney(total.div(complete.length)),
    months: complete.length,
    isComplete: complete.length === cashflow.points.length,
  };
}

async function syncAchievedStatus(app: FastifyInstance, userId: string, goalId: string, asOf: string) {
  const goal = await loadGoalOrThrow(app, userId, goalId);
  const history = await computeGoalHistory(app.prisma, { userId, goal, asOf });

  if (history.firstAchievedAt === null) {
    return goal;
  }

  // 已达成状态只由重算推导；achivedAt 一旦写入即作为历史事实保留
  if (goal.status !== 'archived' && (!goal.achievedAt || dayKey(goal.achievedAt) !== history.firstAchievedAt)) {
    return app.prisma.financialGoal.update({
      where: { id: goal.id },
      data: {
        achievedAt: new Date(`${history.firstAchievedAt}T00:00:00.000Z`),
        status: 'achieved',
      },
    });
  }

  return goal;
}

export default async function goalsRoutes(app: FastifyInstance) {
  // ===== 固定路径：必须先于 /:id 注册 =====

  app.get('/goals/summary', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true, baseCurrency: true },
    });

    const asOf = formatInTimeZone(new Date(), settings.timezone, 'yyyy-MM-dd');

    const goals = await app.prisma.financialGoal.findMany({
      where: { userId, status: { in: ['active', 'achieved'] } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    let totalTarget = toDecimal(0);
    let totalCurrent = toDecimal(0);
    let requiredMonthlyTotal = toDecimal(0);
    const skipped: string[] = [];

    for (const goal of goals) {
      const progress = await computeGoalProgress(app.prisma, { userId, goal, asOf });

      // 跨币种目标不并入合计：折算需要目标汇率口径，混加会得到一个无法解释的总额
      if (!progress.currentAmount || goal.currency !== settings.baseCurrency) {
        skipped.push(goal.id);
        continue;
      }

      totalTarget = totalTarget.plus(progress.targetAmount);
      totalCurrent = totalCurrent.plus(progress.currentAmount);
      if (goal.monthlyContribution) {
        requiredMonthlyTotal = requiredMonthlyTotal.plus(goal.monthlyContribution.toString());
      }
    }

    const surplus = await computeInvestableSurplus(app, {
      userId,
      timezone: settings.timezone,
      baseCurrency: settings.baseCurrency,
    });

    const shortfall =
      surplus.surplus === null ? null : roundMoney(requiredMonthlyTotal.minus(surplus.surplus));

    return ok(
      {
        activeCount: goals.length,
        totalTarget: moneyToString(totalTarget),
        totalCurrent: moneyToString(totalCurrent),
        totalGap: moneyToString(roundMoney(Decimal.max(0, totalTarget.minus(totalCurrent)))),
        requiredMonthlyTotal: moneyToString(requiredMonthlyTotal),
        investableSurplus: surplus.surplus === null ? null : moneyToString(surplus.surplus),
        shortfall: shortfall === null ? null : moneyToString(shortfall),
        surplusBasis: {
          months: surplus.months,
          source: 'analytics',
          isComplete: surplus.isComplete,
        },
        currency: settings.baseCurrency,
        unavailableGoalIds: [...new Set(skipped)],
      },
      request.id,
    );
  });

  app.get('/financial-independence/overview', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    return ok(await computeFinancialIndependence(app.prisma, { userId, body: {} }), request.id);
  });

  app.post('/financial-independence/calculate', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = fiCalculateSchema.parse(request.body ?? {});
    return ok(await computeFinancialIndependence(app.prisma, { userId, body }), request.id);
  });

  // ===== 目标 CRUD =====

  app.get('/goals', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const query = listGoalsSchema.parse(request.query);
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true },
    });
    const asOf = formatInTimeZone(new Date(), settings.timezone, 'yyyy-MM-dd');

    const goals = await app.prisma.financialGoal.findMany({
      where: {
        userId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    const items = [];
    for (const goal of goals) {
      const progress = await computeGoalProgress(app.prisma, { userId, goal, asOf });
      items.push({
        id: goal.id,
        name: goal.name,
        type: goal.type,
        currency: goal.currency,
        status: goal.status,
        priority: goal.priority,
        targetDate: goal.targetDate ? dayKey(goal.targetDate) : null,
        targetAmount: progress.targetAmount,
        originalTargetAmount: progress.originalTargetAmount,
        currentAmount: progress.currentAmount,
        progress: progress.progress,
        gap: progress.gap,
        isAchieved: progress.isAchieved,
        achievedAt: progress.achievedAt,
        monthsRemaining: progress.monthsRemaining,
        funding: progress.funding,
      });
    }

    return ok({ goals: items, asOf }, request.id);
  });

  app.post('/goals', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createGoalSchema.parse(request.body ?? {});

    const activeCount = await app.prisma.financialGoal.count({
      where: { userId, status: { in: ['active', 'achieved'] } },
    });
    if (activeCount >= GOAL_MAX_COUNT) throw errors.goalLimitExceeded(GOAL_MAX_COUNT);

    const existing = await app.prisma.financialGoal.findFirst({
      where: { userId, name: body.name },
      select: { id: true },
    });
    if (existing) throw errors.goalNameExists();

    await assertFunding(app, userId, body);

    const created = await app.prisma.$transaction(async (tx) => {
      const goal = await tx.financialGoal.create({
        data: {
          userId,
          name: body.name,
          type: body.type,
          targetAmount: body.targetAmount,
          currency: body.currency,
          targetDate: body.targetDate ? new Date(`${body.targetDate}T00:00:00.000Z`) : null,
          startedAt: new Date(`${body.startedAt}T00:00:00.000Z`),
          initialAmount: body.initialAmount ?? '0',
          inflationAdjusted: body.inflationAdjusted,
          inflationRate: body.inflationRate ?? null,
          expectedAnnualReturn: body.expectedAnnualReturn ?? null,
          monthlyContribution: body.monthlyContribution ?? null,
          fundingSource: body.fundingSource,
          accountId: body.fundingSource === 'account' ? (body.accountId ?? null) : null,
          portfolioId: body.fundingSource === 'portfolio' ? (body.portfolioId ?? null) : null,
          priority: body.priority,
          note: body.note ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'goal.created',
          targetType: 'financial_goal',
          targetId: goal.id,
          metadata: {
            type: goal.type,
            fundingSource: goal.fundingSource,
            currency: goal.currency,
          },
        },
      });

      return goal;
    });

    reply.status(201);
    return ok({ id: created.id, name: created.name }, request.id);
  });

  app.get('/goals/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = goalIdSchema.parse(request.params);
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true },
    });
    const asOf = formatInTimeZone(new Date(), settings.timezone, 'yyyy-MM-dd');

    const goal = await loadGoalOrThrow(app, userId, id);
    const progress = await computeGoalProgress(app.prisma, { userId, goal, asOf });

    return ok(
      {
        goal: {
          id: goal.id,
          name: goal.name,
          type: goal.type,
          currency: goal.currency,
          status: goal.status,
          priority: goal.priority,
          targetDate: goal.targetDate ? dayKey(goal.targetDate) : null,
          startedAt: dayKey(goal.startedAt),
          initialAmount: moneyToString(goal.initialAmount),
          inflationAdjusted: goal.inflationAdjusted,
          inflationRate: goal.inflationRate ? goal.inflationRate.toFixed(6) : null,
          expectedAnnualReturn: goal.expectedAnnualReturn ? goal.expectedAnnualReturn.toFixed(6) : null,
          monthlyContribution: goal.monthlyContribution ? moneyToString(goal.monthlyContribution) : null,
          fundingSource: goal.fundingSource,
          accountId: goal.accountId,
          portfolioId: goal.portfolioId,
          note: goal.note,
          achievedAt: goal.achievedAt ? dayKey(goal.achievedAt) : null,
        },
        progress,
      },
      request.id,
    );
  });

  app.patch('/goals/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = goalIdSchema.parse(request.params);
    const body = updateGoalSchema.parse(request.body ?? {});

    const goal = await loadGoalOrThrow(app, userId, id);

    if (body.name && body.name !== goal.name) {
      const duplicate = await app.prisma.financialGoal.findFirst({
        where: { userId, name: body.name, id: { not: goal.id } },
        select: { id: true },
      });
      if (duplicate) throw errors.goalNameExists();
    }

    const nextFundingSource = body.fundingSource ?? goal.fundingSource;
    const nextCurrency = body.currency ?? goal.currency;
    const nextInflationAdjusted = body.inflationAdjusted ?? goal.inflationAdjusted;
    const nextTargetDate = body.targetDate !== undefined ? body.targetDate : goal.targetDate ? dayKey(goal.targetDate) : null;
    const nextInflationRate =
      body.inflationRate !== undefined ? body.inflationRate : goal.inflationRate ? goal.inflationRate.toString() : null;

    if (nextInflationAdjusted) {
      if (!nextTargetDate) throw errors.goalParametersInvalid('开启通胀调整时必须设置目标日期');
      if (nextInflationRate == null) throw errors.goalParametersInvalid('开启通胀调整时必须填写通胀率');
    }

    const accountId = nextFundingSource === 'account' ? (body.accountId ?? goal.accountId) : null;
    const portfolioId = nextFundingSource === 'portfolio' ? (body.portfolioId ?? goal.portfolioId) : null;

    await assertFunding(app, userId, {
      fundingSource: nextFundingSource,
      accountId,
      portfolioId,
      currency: nextCurrency,
    });

    const updated = await app.prisma.$transaction(async (tx) => {
      const result = await tx.financialGoal.update({
        where: { id: goal.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.targetAmount !== undefined ? { targetAmount: body.targetAmount } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.targetDate !== undefined
            ? { targetDate: body.targetDate ? new Date(`${body.targetDate}T00:00:00.000Z`) : null }
            : {}),
          ...(body.startedAt !== undefined ? { startedAt: new Date(`${body.startedAt}T00:00:00.000Z`) } : {}),
          ...(body.initialAmount !== undefined ? { initialAmount: body.initialAmount } : {}),
          ...(body.inflationAdjusted !== undefined ? { inflationAdjusted: body.inflationAdjusted } : {}),
          ...(body.inflationRate !== undefined ? { inflationRate: body.inflationRate } : {}),
          ...(body.expectedAnnualReturn !== undefined ? { expectedAnnualReturn: body.expectedAnnualReturn } : {}),
          ...(body.monthlyContribution !== undefined ? { monthlyContribution: body.monthlyContribution } : {}),
          ...(body.fundingSource !== undefined ? { fundingSource: body.fundingSource } : {}),
          accountId,
          portfolioId,
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'goal.updated',
          targetType: 'financial_goal',
          targetId: goal.id,
          metadata: { fields: Object.keys(body) },
        },
      });

      return result;
    });

    return ok({ id: updated.id, name: updated.name }, request.id);
  });

  app.delete('/goals/:id', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const { id } = goalIdSchema.parse(request.params);

    const goal = await loadGoalOrThrow(app, userId, id);

    await app.prisma.$transaction(async (tx) => {
      await tx.financialGoal.delete({ where: { id: goal.id } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'goal.deleted',
          targetType: 'financial_goal',
          targetId: goal.id,
          metadata: { type: goal.type },
        },
      });
    });

    reply.status(204);
    return null;
  });

  app.get('/goals/:id/progress', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = goalIdSchema.parse(request.params);
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true },
    });
    const asOf = formatInTimeZone(new Date(), settings.timezone, 'yyyy-MM-dd');

    const goal = await loadGoalOrThrow(app, userId, id);
    return ok(await computeGoalProgress(app.prisma, { userId, goal, asOf }), request.id);
  });

  app.get('/goals/:id/history', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = goalIdSchema.parse(request.params);
    const query = historyQuerySchema.parse(request.query);
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true },
    });
    const asOf = formatInTimeZone(new Date(), settings.timezone, 'yyyy-MM-dd');

    const goal = await loadGoalOrThrow(app, userId, id);
    const history = await computeGoalHistory(app.prisma, {
      userId,
      goal,
      asOf,
      maxMonths: query.months,
    });

    return ok(
      {
        goalId: goal.id,
        asOf,
        points: history.points,
        firstAchievedAt: history.firstAchievedAt,
        truncated: history.truncated,
        granularity: 'month_end',
        note: 'file:goals.history_granularity_note',
      },
      request.id,
    );
  });

  app.post('/goals/:id/projection', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = goalIdSchema.parse(request.params);
    const body = projectionSchema.parse(request.body ?? {});
    const settings = await app.prisma.userSettings.findUniqueOrThrow({
      where: { userId },
      select: { timezone: true },
    });
    const asOf = formatInTimeZone(new Date(), settings.timezone, 'yyyy-MM-dd');

    // 先按当前资金重算一次达成状态，保证预测里的 achievedAt 与进度页一致
    await syncAchievedStatus(app, userId, id, asOf);

    return ok(await projectGoal(app.prisma, { userId, goalId: id, asOf, body }), request.id);
  });
}
