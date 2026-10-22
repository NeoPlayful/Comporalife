import Decimal from 'decimal.js';
import { addDays, addMonths, addYears, differenceInCalendarDays } from 'date-fns';
import { RECURRING_MIN_OCCURRENCES } from '../../config/constants.js';
import { coefficientOfVariation, median } from '../../lib/percentile.js';

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: string;
  accountId: string;
  accountName: string;
  occurredAt: Date;
  description: string;
  merchant: string | null;
  /** 已折算基准币种的支出金额，必须为正 */
  amount: Decimal;
}

export interface RecurringInput {
  transactions: RecurringTransaction[];
  now: Date;
  minOccurrences?: number;
}

export interface RecurringCandidate {
  key: string;
  label: string;
  accountId: string;
  accountName: string;
  frequency: RecurringFrequency;
  amount: Decimal;
  amountVariation: Decimal;
  occurrences: number;
  lastOccurredAt: Date;
  nextExpectedDate: string;
  confidence: Decimal;
  recentSamples: Array<{
    transactionId: string;
    occurredAt: Date;
    amount: Decimal;
    description: string;
  }>;
}

/** 间隔区间（天）——一条规则覆盖同类周期，避免把月末 28/31 天判成不同频率 */
const FREQUENCY_RANGES: Array<{ frequency: RecurringFrequency; min: number; max: number }> = [
  { frequency: 'weekly', min: 5, max: 9 },
  { frequency: 'monthly', min: 25, max: 35 },
  { frequency: 'yearly', min: 350, max: 380 },
];

/**
 * 描述规范化：去空白、全角转半角、小写、去尾部流水后缀。
 * 刻意不做模糊匹配——过度合并会让「房租」和「物业费」变成同一项，
 * 少识别用户能理解，误合并不可解释。
 */
export function normalizeLabel(text: string): string {
  return text
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[-#_]?\d{4}(\d{2}){0,2}$/u, '')
    .replace(/[-#]\d{4,}$/u, '')
    .trim();
}

export function groupKey(transaction: RecurringTransaction): string {
  const label = normalizeLabel(transaction.merchant ?? transaction.description);
  return `${transaction.accountId}|${label}`;
}

function detectFrequency(intervals: number[]): RecurringFrequency | null {
  if (intervals.length === 0) return null;

  const medianInterval = median(intervals);
  if (medianInterval === null) return null;

  const match = FREQUENCY_RANGES.find(
    (range) => medianInterval >= range.min && medianInterval <= range.max,
  );
  if (!match) return null;

  // 间隔稳定性：最大偏差不超过中位数的 30%
  const maxDeviation = Math.max(...intervals.map((value) => Math.abs(value - medianInterval)));
  if (maxDeviation > medianInterval * 0.3) return null;

  return match.frequency;
}

function nextExpectedDateOf(last: Date, frequency: RecurringFrequency, now: Date): string {
  const step = (date: Date) =>
    frequency === 'weekly'
      ? addDays(date, 7)
      : frequency === 'monthly'
        ? addMonths(date, 1)
        : addYears(date, 1);

  let next = step(last);
  // 已错过多个周期时顺延到下一个尚未到来的日期，但不无限循环
  let guard = 0;
  while (next <= now && guard < 60) {
    next = step(next);
    guard += 1;
  }

  return next.toISOString().slice(0, 10);
}

/**
 * 周期识别：纯函数、确定性，不写库、不读时钟。
 * 只输出候选与置信度，由调用方决定如何展示。
 */
export function detectRecurring(input: RecurringInput): RecurringCandidate[] {
  const minOccurrences = input.minOccurrences ?? RECURRING_MIN_OCCURRENCES;
  const groups = new Map<string, RecurringTransaction[]>();

  for (const transaction of input.transactions) {
    if (!transaction.amount.isPositive()) continue;
    const key = groupKey(transaction);
    const list = groups.get(key) ?? [];
    list.push(transaction);
    groups.set(key, list);
  }

  const candidates: RecurringCandidate[] = [];

  for (const [key, items] of groups) {
    // 同一天出现多笔只取第一笔，避免批量导入重复行放大计数
    const byDay = new Map<string, RecurringTransaction>();
    for (const item of [...items].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
      const day = item.occurredAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, item);
    }

    const occurrences = [...byDay.values()].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );

    if (occurrences.length < minOccurrences) continue;

    const intervals: number[] = [];
    for (let index = 1; index < occurrences.length; index += 1) {
      intervals.push(differenceInCalendarDays(occurrences[index]!.occurredAt, occurrences[index - 1]!.occurredAt));
    }

    const frequency = detectFrequency(intervals);
    if (!frequency) continue;

    const medianInterval = median(intervals) ?? 30;
    const last = occurrences[occurrences.length - 1]!;

    // 最近活跃：最后一笔距今超过 1.5 个周期视为已停止
    const idleDays = differenceInCalendarDays(input.now, last.occurredAt);
    if (idleDays > medianInterval * 1.5) continue;

    const amounts = occurrences.map((item) => item.amount);
    const variation = coefficientOfVariation(amounts);
    if (!variation || variation.greaterThan(0.2)) continue;

    const maxDeviation = Math.max(...intervals.map((value) => Math.abs(value - medianInterval)));
    const countScore = Math.min(occurrences.length / 6, 1);
    const intervalScore = Math.max(0, 1 - maxDeviation / medianInterval);
    const amountScore = Math.max(0, 1 - Math.min(variation.toNumber() / 0.2, 1));

    const confidence = new Decimal(0.4)
      .mul(countScore)
      .plus(new Decimal(0.3).mul(intervalScore))
      .plus(new Decimal(0.3).mul(amountScore));

    if (confidence.lessThan(0.5)) continue;

    candidates.push({
      key,
      label: last.merchant?.trim() || normalizeLabel(last.description) || last.description,
      accountId: last.accountId,
      accountName: last.accountName,
      frequency,
      amount: last.amount,
      amountVariation: variation.toDecimalPlaces(4),
      occurrences: occurrences.length,
      lastOccurredAt: last.occurredAt,
      nextExpectedDate: nextExpectedDateOf(last.occurredAt, frequency, input.now),
      confidence: confidence.toDecimalPlaces(4),
      recentSamples: occurrences.slice(-3).map((item) => ({
        transactionId: item.id,
        occurredAt: item.occurredAt,
        amount: item.amount,
        description: item.description,
      })),
    });
  }

  return candidates
    .sort((a, b) => b.confidence.comparedTo(a.confidence))
    .slice(0, 50);
}
