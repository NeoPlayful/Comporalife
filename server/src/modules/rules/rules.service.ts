import type { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { normalizeDescription } from '../imports/parser/fingerprint.js';
import type { RuleActions, RuleConditions } from './rules.types.js';

/**
 * 规则引擎只做确定性匹配，不支持正则表达式：
 * 可解释、可测试，且不存在 ReDoS 风险。
 */

export interface RuleCandidate {
  id: string;
  type: string;
  description: string;
  merchant: string | null;
  categoryId: string | null;
  accountIds: string[];
  amountMagnitude: Decimal;
}

export interface CompiledRule {
  id: string;
  priority: number;
  conditions: RuleConditions;
  actions: RuleActions;
}

export function matchesRule(rule: CompiledRule, candidate: RuleCandidate): boolean {
  const conditions = rule.conditions;
  const checks: boolean[] = [];

  if (conditions.accountIds && conditions.accountIds.length > 0) {
    checks.push(candidate.accountIds.some((id) => conditions.accountIds!.includes(id)));
  }

  if (conditions.directions && conditions.directions.length > 0) {
    const direction = candidate.type === 'income' ? 'income' : 'expense';
    checks.push(conditions.directions.includes(direction));
  }

  if (conditions.merchant) {
    checks.push(matchText(conditions.merchant.op, conditions.merchant.value, candidate.merchant ?? ''));
  }

  if (conditions.description) {
    checks.push(matchText(conditions.description.op, conditions.description.value, candidate.description));
  }

  if (conditions.amount) {
    const magnitude = candidate.amountMagnitude.abs();
    if (conditions.amount.min && magnitude.lt(new Decimal(conditions.amount.min))) checks.push(false);
    else if (conditions.amount.max && magnitude.gt(new Decimal(conditions.amount.max))) checks.push(false);
    else checks.push(true);
  }

  if (conditions.onlyUncategorized) {
    checks.push(candidate.categoryId === null);
  }

  // 没有任何条件时不允许命中，避免规则误伤全量数据
  if (checks.length === 0) return false;

  return conditions.logic === 'any' ? checks.some(Boolean) : checks.every(Boolean);
}

function matchText(op: 'equals' | 'contains' | 'startsWith', expected: string, actual: string): boolean {
  const left = normalizeDescription(expected);
  const right = normalizeDescription(actual);
  if (right.length === 0) return false;

  switch (op) {
    case 'equals':
      return right === left;
    case 'contains':
      return right.includes(left);
    case 'startsWith':
      return right.startsWith(left);
  }
}

export interface RuleEvaluation {
  categoryId: string | null;
  tagIds: string[];
  matchedRuleIds: string[];
}

/** 分类由首个命中且设置了分类的规则决定；标签取全部命中的并集 */
export function evaluateRules(rules: CompiledRule[], candidate: RuleCandidate): RuleEvaluation {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  let categoryId: string | null = null;
  const tagIds = new Set<string>();
  const matchedRuleIds: string[] = [];

  for (const rule of sorted) {
    if (!matchesRule(rule, candidate)) continue;

    matchedRuleIds.push(rule.id);
    if (categoryId === null && rule.actions.categoryId) categoryId = rule.actions.categoryId;
    for (const tagId of rule.actions.addTagIds ?? []) tagIds.add(tagId);
  }

  return { categoryId, tagIds: [...tagIds], matchedRuleIds };
}

type TxClient = Prisma.TransactionClient;

/**
 * 对指定交易执行规则，返回被成功分类的交易数。
 * 分类只在交易当前未分类时写入（除非调用方已过滤），标签按并集追加。
 */
export async function applyRulesToTransactions(
  tx: TxClient,
  userId: string,
  transactionIds: string[],
  options: { overwrite?: boolean } = {},
): Promise<number> {
  if (transactionIds.length === 0) return 0;

  const rules = await tx.classificationRule.findMany({
    where: { userId, enabled: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, priority: true, conditions: true, actions: true },
  });

  if (rules.length === 0) return 0;

  const transactions = await tx.transaction.findMany({
    where: { id: { in: transactionIds }, userId, status: 'posted' },
    select: {
      id: true,
      type: true,
      description: true,
      merchant: true,
      categoryId: true,
      entries: { where: { accountId: { not: null } }, select: { accountId: true, amount: true } },
    },
  });

  const compiled: CompiledRule[] = rules.map((rule) => ({
    id: rule.id,
    priority: rule.priority,
    conditions: rule.conditions as unknown as RuleConditions,
    actions: rule.actions as unknown as RuleActions,
  }));

  const matchCounts = new Map<string, number>();
  let categorized = 0;

  for (const transaction of transactions) {
    const accountIds = transaction.entries
      .map((entry) => entry.accountId)
      .filter((id): id is string => id !== null);

    const magnitude = transaction.entries.reduce(
      (sum, entry) => sum.plus(new Decimal(entry.amount.toString())),
      new Decimal(0),
    );

    const evaluation = evaluateRules(compiled, {
      id: transaction.id,
      type: transaction.type,
      description: transaction.description,
      merchant: transaction.merchant,
      categoryId: transaction.categoryId,
      accountIds,
      amountMagnitude: magnitude,
    });

    for (const ruleId of evaluation.matchedRuleIds) {
      matchCounts.set(ruleId, (matchCounts.get(ruleId) ?? 0) + 1);
    }

    const shouldSetCategory =
      evaluation.categoryId !== null &&
      (transaction.categoryId === null || (options.overwrite === true && transaction.categoryId !== evaluation.categoryId));

    if (shouldSetCategory) {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { categoryId: evaluation.categoryId, version: { increment: 1 } },
      });
      categorized += 1;
    }

    if (evaluation.tagIds.length > 0) {
      await tx.transactionTag.createMany({
        data: evaluation.tagIds.map((tagId) => ({ transactionId: transaction.id, tagId })),
        skipDuplicates: true,
      });
    }
  }

  // 命中计数用增量更新，避免逐条写
  for (const [ruleId, count] of matchCounts) {
    await tx.classificationRule.update({
      where: { id: ruleId },
      data: { matchCount: { increment: count }, lastAppliedAt: new Date() },
    });
  }

  return categorized;
}
