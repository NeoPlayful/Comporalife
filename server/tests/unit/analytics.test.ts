import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { coefficientOfVariation, median, percentile } from '@/lib/percentile.js';
import {
  accumulateCarryover,
  levelOf,
} from '@/modules/budgets/budget.service.js';
import {
  changeRatio,
  enumeratePeriodKeys,
  previousWindow,
  resolveRange,
} from '@/modules/analytics/period.js';
import {
  detectRecurring,
  groupKey,
  normalizeLabel,
} from '@/modules/analytics/recurring.engine.js';
import { computeSpent } from '@/modules/budgets/budget.service.js';
import type { AnalyticsRow } from '@/modules/analytics/query.service.js';

const TZ = 'Asia/Shanghai';

function money(value: string): Decimal {
  return new Decimal(value);
}

function row(params: {
  type?: 'income' | 'expense' | 'transfer' | 'adjustment';
  categoryId?: string | null;
  amount?: string;
  day?: string;
  merchant?: string | null;
  accountId?: string;
}): AnalyticsRow {
  const amount = params.amount ?? '100';
  return {
    transactionId: Math.random().toString(36).slice(2),
    type: params.type ?? 'expense',
    occurredAt: new Date(`${params.day ?? '2026-03-01'}T02:00:00.000Z`),
    dayKey: params.day ?? '2026-03-01',
    periodKey: (params.day ?? '2026-03-01').slice(0, 7),
    description: 'desc',
    merchant: params.merchant ?? null,
    categoryId: params.categoryId ?? null,
    categoryName: params.categoryId ? '分类' : null,
    categoryParentId: null,
    categoryParentName: null,
    categoryKind: params.categoryId ? 'expense' : null,
    originalAmount: money(amount),
    signedAmount: money(amount),
    amountBase: money(amount),
    currency: 'CNY',
    accountId: params.accountId ?? 'acc-1',
    accountName: '账户',
    accountType: 'bank',
    importBatchId: null,
  };
}

describe('分位数', () => {
  it('线性插值按 (n-1)*p 计算', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([0, 100], 0.95)).toBeCloseTo(95, 6);
  });

  it('空数组返回 null，单元素返回自身', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('越界 p 抛错', () => {
    expect(() => percentile([1, 2], 1.5)).toThrow(RangeError);
  });

  it('中位数与变异系数', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
    // 全等值变异系数为 0；均值为 0 时返回 null 而不是 Infinity
    expect(coefficientOfVariation([money('5'), money('5')])!.toNumber()).toBe(0);
    expect(coefficientOfVariation([money('0'), money('0')])).toBeNull();
  });
});

describe('周期窗口', () => {
  it('按用户时区解析自然日区间', () => {
    const { from, to, days } = resolveRange('2026-03-01', '2026-03-31', TZ);
    expect(days).toBe(31);
    // 上海 3 月 1 日 00:00 = UTC 2 月 28 日 16:00
    expect(from.toISOString()).toBe('2026-02-28T16:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-31T15:59:59.999Z');
  });

  it('自定义区间环比按天数向前平移', () => {
    const previous = previousWindow({ fromText: '2026-03-01', toText: '2026-03-31', mode: 'custom' }, TZ);
    expect(previous.fromText).toBe('2026-01-29');
    expect(previous.toText).toBe('2026-02-28');
  });

  it('自然月环比对齐到上月同一天开始的自然月', () => {
    const previous = previousWindow({ fromText: '2026-03-01', toText: '2026-03-31', mode: 'month' }, TZ);
    expect(previous.fromText).toBe('2026-02-01');
    expect(previous.toText).toBe('2026-02-28');
  });

  it('变化率在上期为 0 时返回 null', () => {
    expect(changeRatio(money('100'), money('0'))).toBeNull();
    expect(changeRatio(money('120'), money('100'))).toBe('0.2000');
    expect(changeRatio(money('80'), money('100'))).toBe('-0.2000');
  });

  it('按粒度枚举周期键', () => {
    const { from, to } = resolveRange('2026-01-01', '2026-03-31', TZ);
    const keys = enumeratePeriodKeys(from, to, TZ, 'month');
    expect(keys).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('周期识别', () => {
  function recurringInput(amounts: string[], days: number[], now = '2026-10-20') {
    return {
      now: new Date(`${now}T00:00:00.000Z`),
      transactions: amounts.map((amount, index) => ({
        id: `tx-${index}`,
        accountId: 'acc-1',
        accountName: '信用卡',
        occurredAt: new Date(`2026-${String(3 + index).padStart(2, '0')}-06T02:00:00.000Z`),
        description: 'NETFLIX',
        merchant: 'NETFLIX',
        amount: money(amount),
      })),
      // days 只用于表达间隔稳定性，实际间隔由 occurredAt 决定
      ...(days.length > 0 ? {} : {}),
    };
  }

  function monthlySeries(count: number, amount = '68', startMonth = 3) {
    return Array.from({ length: count }, (_, index) => {
      const month = startMonth + index;
      return {
        id: `tx-${index}`,
        accountId: 'acc-1',
        accountName: '信用卡',
        occurredAt: new Date(
          `2026-${String(month).padStart(2, '0')}-06T02:00:00.000Z`,
        ),
        description: 'NETFLIX',
        merchant: 'NETFLIX',
        amount: money(amount),
      };
    });
  }

  it('识别稳定的月度订阅', () => {
    const candidates = detectRecurring({
      now: new Date('2026-09-20T00:00:00.000Z'),
      transactions: monthlySeries(6),
    });

    expect(candidates.length).toBe(1);
    expect(candidates[0]!.frequency).toBe('monthly');
    expect(candidates[0]!.occurrences).toBe(6);
    expect(candidates[0]!.confidence.toNumber()).toBeGreaterThan(0.5);
    // 最后一笔在 8 月 6 日，9 月 6 日已过，预计日期顺延到 10 月 6 日
    expect(candidates[0]!.nextExpectedDate).toBe('2026-10-06');
  });

  it('少于 3 笔不识别', () => {
    const candidates = detectRecurring({
      now: new Date('2026-05-20T00:00:00.000Z'),
      transactions: monthlySeries(2),
    });
    expect(candidates).toHaveLength(0);
  });

  it('金额波动超过 20% 不识别', () => {
    const transactions = monthlySeries(5).map((item, index) => ({
      ...item,
      amount: money(index % 2 === 0 ? '100' : '400'),
    }));

    expect(
      detectRecurring({ now: new Date('2026-08-20T00:00:00.000Z'), transactions }),
    ).toHaveLength(0);
  });

  it('间隔不规律不识别', () => {
    const dates = ['2026-03-01', '2026-03-20', '2026-05-15', '2026-08-01'];
    const transactions = dates.map((day, index) => ({
      id: `tx-${index}`,
      accountId: 'acc-1',
      accountName: '现金',
      occurredAt: new Date(`${day}T02:00:00.000Z`),
      description: '餐饮',
      merchant: '小馆',
      amount: money('50'),
    }));

    expect(
      detectRecurring({ now: new Date('2026-08-10T00:00:00.000Z'), transactions }),
    ).toHaveLength(0);
  });

  it('停止超过 1.5 个周期后不再识别', () => {
    const candidates = detectRecurring({
      now: new Date('2026-12-20T00:00:00.000Z'),
      transactions: monthlySeries(5),
    });
    expect(candidates).toHaveLength(0);
  });

  it('相同输入两次调用结果完全一致', () => {
    const input = { now: new Date('2026-09-20T00:00:00.000Z'), transactions: monthlySeries(6) };
    const first = detectRecurring(input);
    const second = detectRecurring(input);

    expect(first.map((c) => [c.key, c.frequency, c.confidence.toFixed(4)])).toEqual(
      second.map((c) => [c.key, c.frequency, c.confidence.toFixed(4)]),
    );
  });

  it('规范化描述并生成分组键', () => {
    expect(normalizeLabel('  NETFLIX  月费-20260301 ')).toBe('netflix 月费');
    expect(normalizeLabel('星巴克')).toBe('星巴克');

    const a = groupKey({
      id: '1', accountId: 'acc', accountName: '卡', occurredAt: new Date(),
      description: 'x', merchant: 'NETFLIX', amount: money('1'),
    });
    const b = groupKey({
      id: '2', accountId: 'acc', accountName: '卡', occurredAt: new Date(),
      description: 'y', merchant: ' netflix ', amount: money('1'),
    });
    expect(a).toBe(b);
  });
});

describe('预算执行', () => {
  it('分类额度包含子分类支出', () => {
    const rows = [
      row({ categoryId: 'child-1', amount: '100' }),
      row({ categoryId: 'parent-1', amount: '50' }),
      row({ categoryId: 'other', amount: '30' }),
      row({ categoryId: null, amount: '20' }),
    ];

    expect(computeSpent(rows, ['parent-1', 'child-1']).toFixed(2)).toBe('150.00');
    expect(computeSpent(rows, null).toFixed(2)).toBe('200.00');
  });

  it('未分类支出计入总额但不计入分类额度', () => {
    const rows = [row({ categoryId: null, amount: '20' })];
    expect(computeSpent(rows, ['parent-1']).toFixed(2)).toBe('0.00');
    expect(computeSpent(rows, null).toFixed(2)).toBe('20.00');
  });

  it('转账与收入不进入预算支出', () => {
    const rows = [
      row({ type: 'transfer', amount: '500' }),
      row({ type: 'income', amount: '900' }),
      row({ type: 'expense', amount: '100' }),
    ];
    expect(computeSpent(rows, null).toFixed(2)).toBe('100.00');
  });

  it('预警等级边界：79.99% ok，80% warning，100% ok，100.01% exceeded', () => {
    expect(levelOf(money('799.9'), money('1000'), true)).toBe('ok');
    expect(levelOf(money('800'), money('1000'), true)).toBe('warning');
    expect(levelOf(money('1000'), money('1000'), true)).toBe('warning');
    expect(levelOf(money('1000.01'), money('1000'), true)).toBe('exceeded');
  });

  it('数据不完整时等级为 unknown', () => {
    expect(levelOf(money('10'), money('100'), false)).toBe('unknown');
  });
});

describe('结转链', () => {
  function period(amount: string, spentRows: AnalyticsRow[], totalAmount = amount, rollover = true) {
    return {
      year: 2026,
      month: 8,
      rollover,
      totalAmount: money(totalAmount),
      itemAmounts: new Map([['cat-1', money(amount)]]),
      rows: spentRows,
      isComplete: true,
    };
  }

  it('只累加正结余，超支不产生负结转', () => {
    const periods = [
      period('1000', [row({ categoryId: 'cat-1', amount: '1200' })]), // 超支 200 → 结转 0
      period('1000', [row({ categoryId: 'cat-1', amount: '600' })]), // 剩 400 → 结转 400
      period('1000', [row({ categoryId: 'cat-1', amount: '1400' })]), // 可用 1400 花 1400 → 0
    ];

    expect(accumulateCarryover(periods, 'cat-1', ['cat-1']).toFixed(2)).toBe('0.00');
  });

  it('连续正结余逐月累加', () => {
    const periods = [
      period('1000', [row({ categoryId: 'cat-1', amount: '900' })]), // 100
      period('1000', [row({ categoryId: 'cat-1', amount: '800' })]), // 300
    ];

    expect(accumulateCarryover(periods, 'cat-1', ['cat-1']).toFixed(2)).toBe('300.00');
  });

  it('总预算结转使用 totalAmount', () => {
    const periods = [period('0', [row({ categoryId: 'cat-1', amount: '200' })], '500')];
    expect(accumulateCarryover(periods, null, null).toFixed(2)).toBe('300.00');
  });
});
