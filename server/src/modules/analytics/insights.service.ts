import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { addMonths } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { roundMoney } from '../../lib/money.js';
import { buildBasis, computeCoverage } from './coverage.js';
import type { AnalyticsContext } from './analytics.service.js';
import { loadAnalyticsRows, sumBy, type AnalyticsRow } from './query.service.js';
import {
  detectRecurring,
  groupKey,
  type RecurringCandidate,
  type RecurringFrequency,
} from './recurring.engine.js';

export interface RecurringResponse {
  items: Array<{
    key: string;
    label: string;
    accountId: string;
    accountName: string;
    frequency: RecurringFrequency;
    amount: string;
    amountVariation: string;
    occurrences: number;
    lastOccurredAt: string;
    nextExpectedDate: string;
    confidence: string;
    recentSamples: Array<{
      transactionId: string;
      occurredAt: string;
      amount: string;
      description: string;
    }>;
  }>;
  lookbackMonths: number;
  lookback: { from: string; to: string };
  note?: string;
}

/**
 * 周期识别：取回溯窗口内的支出流水，交给纯函数引擎。
 * 引擎不关心币种——金额在取数层已折算为基准币种。
 */
export async function getRecurring(
  prisma: PrismaClient,
  context: AnalyticsContext,
  params: { lookbackMonths: number; frequency?: RecurringFrequency },
): Promise<RecurringResponse> {
  const now = new Date();
  const lookbackFrom = addMonths(now, -params.lookbackMonths);

  const fromText = formatInTimeZone(lookbackFrom, context.timezone, 'yyyy-MM-dd');
  const toText = formatInTimeZone(now, context.timezone, 'yyyy-MM-dd');

  const result = await loadAnalyticsRows(prisma, {
    userId: context.userId,
    fromText,
    toText,
    timezone: context.timezone,
    baseCurrency: context.baseCurrency,
  });

  const expenses = result.rows.filter((row) => row.type === 'expense');

  const candidates = detectRecurring({
    now,
    transactions: expenses.map((row) => ({
      id: row.transactionId,
      accountId: row.accountId,
      accountName: row.accountName,
      occurredAt: row.occurredAt,
      description: row.description,
      merchant: row.merchant,
      amount: row.amountBase,
    })),
  });

  const filtered = params.frequency
    ? candidates.filter((candidate) => candidate.frequency === params.frequency)
    : candidates;

  return {
    items: filtered.map((candidate) => ({
      key: candidate.key,
      label: candidate.label,
      accountId: candidate.accountId,
      accountName: candidate.accountName,
      frequency: candidate.frequency,
      amount: roundMoney(candidate.amount).toFixed(6),
      amountVariation: candidate.amountVariation.toFixed(4),
      occurrences: candidate.occurrences,
      lastOccurredAt: candidate.lastOccurredAt.toISOString(),
      nextExpectedDate: candidate.nextExpectedDate,
      confidence: candidate.confidence.toFixed(4),
      recentSamples: candidate.recentSamples.map((sample) => ({
        transactionId: sample.transactionId,
        occurredAt: sample.occurredAt.toISOString(),
        amount: roundMoney(sample.amount).toFixed(6),
        description: sample.description,
      })),
    })),
    lookbackMonths: params.lookbackMonths,
    lookback: { from: fromText, to: toText },
    ...(filtered.length === 0 ? { note: 'no_recurring_detected' } : {}),
  };
}

export interface FixedVariableResponse {
  fixed: {
    amount: string;
    ratio: string | null;
    items: Array<{ key: string; label: string; amount: string; frequency: RecurringFrequency }>;
  };
  variable: { amount: string; ratio: string | null };
  total: string;
  recurringKeys: string[];
  coverage: ReturnType<typeof computeCoverage>;
  period: { from: string; to: string; days: number };
  basis: Record<string, unknown>;
  note?: string;
}

/**
 * 固定/可变支出拆分，复用周期识别的结果。
 * 固定支出只统计「在回溯窗口内命中周期项、且落在本区间内」的流水，
 * 因此固定 + 可变严格等于区间总支出。
 */
export async function getFixedVariable(
  prisma: PrismaClient,
  context: AnalyticsContext,
  fromText: string,
  toText: string,
): Promise<FixedVariableResponse> {
  const total = await loadAnalyticsRows(prisma, {
    userId: context.userId,
    fromText,
    toText,
    timezone: context.timezone,
    baseCurrency: context.baseCurrency,
  });

  const expenses = total.rows.filter((row) => row.type === 'expense');

  // 周期识别需要更长历史才能判断规律，这里固定回溯 12 个月
  const now = new Date();
  const lookbackFrom = addMonths(now, -12);
  const lookbackResult = await loadAnalyticsRows(prisma, {
    userId: context.userId,
    fromText: formatInTimeZone(lookbackFrom, context.timezone, 'yyyy-MM-dd'),
    toText: formatInTimeZone(now, context.timezone, 'yyyy-MM-dd'),
    timezone: context.timezone,
    baseCurrency: context.baseCurrency,
  });

  const candidates = detectRecurring({
    now,
    transactions: lookbackResult.rows
      .filter((row) => row.type === 'expense')
      .map((row) => ({
        id: row.transactionId,
        accountId: row.accountId,
        accountName: row.accountName,
        occurredAt: row.occurredAt,
        description: row.description,
        merchant: row.merchant,
        amount: row.amountBase,
      })),
  });

  const recurringByKey = new Map<string, RecurringCandidate>(
    candidates.map((candidate) => [candidate.key, candidate]),
  );

  // 区间内的支出逐笔判定：命中周期分组键即视为固定支出
  const fixedRows: Array<{ row: AnalyticsRow; candidate: RecurringCandidate }> = [];
  for (const row of expenses) {
    const candidate = recurringByKey.get(groupKey({
      id: row.transactionId,
      accountId: row.accountId,
      accountName: row.accountName,
      occurredAt: row.occurredAt,
      description: row.description,
      merchant: row.merchant,
      amount: row.amountBase,
    }));
    if (candidate) fixedRows.push({ row, candidate });
  }

  const fixedMap = new Map<string, { candidate: RecurringCandidate; amount: Decimal }>();
  for (const { row, candidate } of fixedRows) {
    const bucket = fixedMap.get(candidate.key) ?? { candidate, amount: new Decimal(0) };
    bucket.amount = bucket.amount.plus(row.amountBase);
    fixedMap.set(candidate.key, bucket);
  }

  const fixedAmount = roundMoney(
    [...fixedMap.values()].reduce((sum, item) => sum.plus(item.amount), new Decimal(0)),
  );
  const totalExpense = sumBy(expenses, (row) => row.amountBase);
  const variableAmount = roundMoney(totalExpense.minus(fixedAmount));

  const ratioOf = (value: Decimal) =>
    totalExpense.isZero() ? null : value.div(totalExpense).toDecimalPlaces(4).toFixed(4);

  return {
    fixed: {
      amount: fixedAmount.toFixed(6),
      ratio: ratioOf(fixedAmount),
      items: [...fixedMap.values()]
        .sort((a, b) => b.amount.comparedTo(a.amount))
        .map((item) => ({
          key: item.candidate.key,
          label: item.candidate.label,
          amount: roundMoney(item.amount).toFixed(6),
          frequency: item.candidate.frequency,
        })),
    },
    variable: {
      amount: variableAmount.toFixed(6),
      ratio: ratioOf(variableAmount),
    },
    total: totalExpense.toFixed(6),
    recurringKeys: [...fixedMap.keys()],
    coverage: computeCoverage(total.rows, total),
    period: total.range,
    basis: buildBasis({
      timezone: context.timezone,
      baseCurrency: context.baseCurrency,
      range: total.range,
      extra: { recurringDetection: 'fixed_12_month_lookback' },
    }),
    ...(fixedRows.length === 0 ? { note: 'no_recurring_detected' } : {}),
  };
}
