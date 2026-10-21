import type { FastifyInstance, FastifyRequest } from 'fastify';
import Decimal from 'decimal.js';
import { buildPagination, ok, parsePageParams } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import {
  applyRulesSchema,
  createRuleSchema,
  reorderRulesSchema,
  ruleIdSchema,
  updateRuleSchema,
  type RuleActions,
  type RuleConditions,
} from './rules.types.js';
import { applyRulesToTransactions, evaluateRules, matchesRule } from './rules.service.js';

export default async function rulesRoutes(app: FastifyInstance) {
  app.get('/classification-rules', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const page = parsePageParams(request.query as { page?: unknown; pageSize?: unknown });

    const [total, rules] = await Promise.all([
      app.prisma.classificationRule.count({ where: { userId } }),
      app.prisma.classificationRule.findMany({
        where: { userId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
    ]);

    return ok({ rules, pagination: buildPagination(page.page, page.pageSize, total) }, request.id);
  });

  app.post('/classification-rules', { preHandler: app.authenticate }, async (request, reply) => {
    const { userId } = requireAuth(request);
    const body = createRuleSchema.parse(request.body);

    await validateRule(app, request, userId, body.conditions, body.actions);

    const existing = await app.prisma.classificationRule.findUnique({
      where: { userId_name: { userId, name: body.name } },
      select: { id: true },
    });
    if (existing) throw errors.conflict('同名规则已存在');

    const rule = await app.prisma.classificationRule.create({
      data: {
        userId,
        name: body.name,
        priority: body.priority,
        enabled: body.enabled,
        conditions: body.conditions as unknown as object,
        actions: body.actions as unknown as object,
      },
    });

    return reply.status(201).send(ok({ rule }, request.id));
  });

  app.get('/classification-rules/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = ruleIdSchema.parse(request.params);

    const rule = await app.prisma.classificationRule.findFirst({ where: { id, userId } });
    if (!rule) throw errors.notFound('规则不存在');

    return ok({ rule }, request.id);
  });

  app.patch('/classification-rules/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = ruleIdSchema.parse(request.params);
    const body = updateRuleSchema.parse(request.body);

    const existing = await app.prisma.classificationRule.findFirst({
      where: { id, userId },
      select: { id: true, name: true, conditions: true, actions: true },
    });
    if (!existing) throw errors.notFound('规则不存在');

    const conditions = (body.conditions ?? existing.conditions) as unknown as RuleConditions;
    const actions = (body.actions ?? existing.actions) as unknown as RuleActions;
    await validateRule(app, request, userId, conditions, actions);

    if (body.name && body.name !== existing.name) {
      const duplicate = await app.prisma.classificationRule.findUnique({
        where: { userId_name: { userId, name: body.name } },
        select: { id: true },
      });
      if (duplicate) throw errors.conflict('同名规则已存在');
    }

    const rule = await app.prisma.classificationRule.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.conditions ? { conditions: body.conditions as unknown as object } : {}),
        ...(body.actions ? { actions: body.actions as unknown as object } : {}),
      },
    });

    return ok({ rule }, request.id);
  });

  app.delete('/classification-rules/:id', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = ruleIdSchema.parse(request.params);

    const existing = await app.prisma.classificationRule.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw errors.notFound('规则不存在');

    // 已分类的交易不会因为删规则而回退
    await app.prisma.classificationRule.delete({ where: { id } });
    return ok({ deleted: true }, request.id);
  });

  // 试运行：返回命中样本，不写库
  app.post('/classification-rules/:id/test', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const { id } = ruleIdSchema.parse(request.params);

    const rule = await app.prisma.classificationRule.findFirst({ where: { id, userId } });
    if (!rule) throw errors.notFound('规则不存在');

    const candidates = await loadCandidates(app, userId, 2000);
    const compiled = {
      id: rule.id,
      priority: rule.priority,
      conditions: rule.conditions as unknown as RuleConditions,
      actions: rule.actions as unknown as RuleActions,
    };

    const hits = candidates.filter((item) => matchesRule(compiled, item.candidate));

    return ok(
      {
        matched: hits.length,
        sample: hits.slice(0, 50).map((item) => item.summary),
      },
      request.id,
    );
  });

  app.post('/classification-rules/apply', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = applyRulesSchema.parse(request.body);

    let targetIds: string[];

    if (body.transactionIds) {
      const found = await app.prisma.transaction.findMany({
        where: { id: { in: body.transactionIds }, userId, status: 'posted' },
        select: { id: true },
      });
      if (found.length !== body.transactionIds.length) throw errors.notFound('部分交易不存在');
      targetIds = found.map((item) => item.id);
    } else {
      const found = await app.prisma.transaction.findMany({
        where: {
          userId,
          status: 'posted',
          source: 'import',
          ...(body.onlyUncategorized ? { categoryId: null } : {}),
        },
        orderBy: { occurredAt: 'desc' },
        take: 500,
        select: { id: true },
      });
      targetIds = found.map((item) => item.id);
    }

    if (targetIds.length === 0) return ok({ matched: 0, categorized: 0, tagged: 0, skipped: 0 }, request.id);

    const result = await app.prisma.$transaction(async (tx) => {
      const categorized = await applyRulesToTransactions(tx, userId, targetIds, {
        overwrite: body.overwrite,
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: 'rules.applied',
          targetType: 'transaction',
          metadata: { targetCount: targetIds.length, categorized },
        },
      });

      return categorized;
    });

    return ok(
      { matched: targetIds.length, categorized: result, tagged: 0, skipped: targetIds.length - result },
      request.id,
    );
  });

  app.post('/classification-rules/reorder', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const body = reorderRulesSchema.parse(request.body);

    const ids = body.items.map((item) => item.id);
    const found = await app.prisma.classificationRule.findMany({
      where: { id: { in: ids }, userId },
      select: { id: true },
    });
    if (found.length !== ids.length) throw errors.notFound('部分规则不存在');

    await app.prisma.$transaction(
      body.items.map((item) =>
        app.prisma.classificationRule.update({ where: { id: item.id }, data: { priority: item.priority } }),
      ),
    );

    return ok({ updated: ids.length }, request.id);
  });
}

async function validateRule(
  app: FastifyInstance,
  request: FastifyRequest,
  userId: string,
  conditions: RuleConditions,
  actions: RuleActions,
): Promise<void> {
  const conditionFields = [
    conditions.accountIds?.length ? 'accountIds' : null,
    conditions.directions?.length ? 'directions' : null,
    conditions.merchant ? 'merchant' : null,
    conditions.description ? 'description' : null,
    conditions.amount ? 'amount' : null,
    conditions.onlyUncategorized ? 'onlyUncategorized' : null,
  ].filter(Boolean);

  if (conditionFields.length === 0) throw errors.ruleInvalid('规则至少需要一个条件');

  if (!actions.categoryId && !(actions.addTagIds && actions.addTagIds.length > 0) && !actions.markReviewed) {
    throw errors.ruleInvalid('规则至少需要一个动作');
  }

  if (conditions.amount?.min && conditions.amount?.max) {
    if (new Decimal(conditions.amount.min).gt(new Decimal(conditions.amount.max))) {
      throw errors.ruleInvalid('金额区间下限不能大于上限');
    }
  }

  if (conditions.accountIds && conditions.accountIds.length > 0) {
    const accounts = await app.prisma.account.findMany({
      where: { id: { in: conditions.accountIds }, userId },
      select: { id: true },
    });
    if (accounts.length !== conditions.accountIds.length) throw errors.ruleInvalid('条件中的账户不存在');
  }

  if (actions.categoryId) {
    const category = await app.prisma.category.findFirst({
      where: { id: actions.categoryId, userId },
      select: { id: true, kind: true, archived: true },
    });
    if (!category) throw errors.ruleInvalid('动作中的分类不存在');
    if (category.archived) throw errors.ruleInvalid('动作中的分类已归档');

    if (conditions.directions && conditions.directions.length === 1) {
      const direction = conditions.directions[0];
      if (direction !== category.kind) {
        throw errors.ruleInvalid('分类类型与规则方向不匹配');
      }
    }
  }

  if (actions.addTagIds && actions.addTagIds.length > 0) {
    const tags = await app.prisma.tag.findMany({
      where: { id: { in: actions.addTagIds }, userId },
      select: { id: true },
    });
    if (tags.length !== actions.addTagIds.length) throw errors.ruleInvalid('动作中的标签不存在');
  }

  request.log.debug({ userId }, '规则校验通过');
}

interface CandidateWithSummary {
  candidate: {
    id: string;
    type: string;
    description: string;
    merchant: string | null;
    categoryId: string | null;
    accountIds: string[];
    amountMagnitude: Decimal;
  };
  summary: {
    id: string;
    occurredAt: Date;
    type: string;
    description: string;
    merchant: string | null;
    amount: string;
  };
}

async function loadCandidates(app: FastifyInstance, userId: string, limit: number): Promise<CandidateWithSummary[]> {
  const transactions = await app.prisma.transaction.findMany({
    where: { userId, status: 'posted' },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      occurredAt: true,
      description: true,
      merchant: true,
      categoryId: true,
      entries: { select: { accountId: true, amount: true } },
    },
  });

  return transactions.map((transaction) => {
    const real = transaction.entries.filter((entry) => entry.accountId !== null);
    const magnitude = real.reduce(
      (sum, entry) => sum.plus(new Decimal(entry.amount.toString())),
      new Decimal(0),
    );

    return {
      candidate: {
        id: transaction.id,
        type: transaction.type,
        description: transaction.description,
        merchant: transaction.merchant,
        categoryId: transaction.categoryId,
        accountIds: real.map((entry) => entry.accountId!),
        amountMagnitude: magnitude,
      },
      summary: {
        id: transaction.id,
        occurredAt: transaction.occurredAt,
        type: transaction.type,
        description: transaction.description,
        merchant: transaction.merchant,
        amount: magnitude.toFixed(6),
      },
    };
  });
}

export { evaluateRules };
