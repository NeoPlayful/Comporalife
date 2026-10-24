import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { simulate } from '@/modules/simulations/compound.engine';
import { computeProgress, findFirstAchieved, inflateTarget, type GoalCoreInput } from '@/modules/goals/goal.engine';
import { buildTimeline, solveEta, solveRequiredMonthly } from '@/modules/goals/projection.engine';

const BASE: GoalCoreInput = {
  targetAmount: '800000',
  currency: 'CNY',
  targetDate: '2035-09-01',
  startedAt: '2026-01-01',
  initialAmount: '0',
  inflationAdjusted: false,
  inflationRate: '0.025',
  expectedAnnualReturn: '0.06',
  monthlyContribution: '3000',
};

describe('目标金额通胀调整', () => {
  it('未开启时返回原始金额', () => {
    expect(inflateTarget(BASE).toNumber()).toBe(800000);
  });

  it('开启后按年数复利增长', () => {
    const adjusted = inflateTarget({ ...BASE, inflationAdjusted: true });
    // 2026-01 到 2035-09 约 9.67 年
    const expected = 800000 * Math.pow(1.025, 116 / 12);
    expect(adjusted.toNumber()).toBeCloseTo(expected, 2);
  });

  it('目标日期早于起算日时不放大', () => {
    const adjusted = inflateTarget({ ...BASE, inflationAdjusted: true, targetDate: '2025-01-01' });
    expect(adjusted.toNumber()).toBe(800000);
  });

  it('关闭通胀调整时结果恒等于目标金额', () => {
    expect(inflateTarget({ ...BASE, inflationRate: '0.9' }).toNumber()).toBe(800000);
  });
});

describe('目标进度', () => {
  it('当前金额达到目标时判定达成且缺口为 0', () => {
    const progress = computeProgress({
      input: BASE,
      currentAmount: new Decimal(800000),
      asOf: '2026-10-24',
    });

    expect(progress.isAchieved).toBe(true);
    expect(progress.gap.toNumber()).toBe(0);
    expect(progress.progress.toNumber()).toBe(1);
  });

  it('进度不封顶，超额完成保留真实数值', () => {
    const progress = computeProgress({
      input: BASE,
      currentAmount: new Decimal(1200000),
      asOf: '2026-10-24',
    });

    expect(progress.progress.toNumber()).toBeCloseTo(1.5, 6);
  });

  it('剩余月数按目标日期计算', () => {
    const progress = computeProgress({
      input: BASE,
      currentAmount: new Decimal(0),
      asOf: '2026-10-24',
    });

    // 2026-10 到 2035-09 共 107 个月
    expect(progress.monthsRemaining).toBe(107);
  });

  it('无目标日期时剩余月数为 null', () => {
    const progress = computeProgress({
      input: { ...BASE, targetDate: null },
      currentAmount: new Decimal(100),
      asOf: '2026-10-24',
    });

    expect(progress.monthsRemaining).toBeNull();
  });

  it('目标金额为 0 时不判定达成，避免除零', () => {
    const progress = computeProgress({
      input: { ...BASE, targetAmount: '0' },
      currentAmount: new Decimal(0),
      asOf: '2026-10-24',
    });

    expect(progress.progress.toNumber()).toBe(0);
    expect(progress.isAchieved).toBe(false);
  });
});

describe('首次达成判定', () => {
  it('取第一个达成的月份', () => {
    const achievedAt = findFirstAchieved([
      { asOf: '2026-01-31', currentAmount: '100', progress: '0.5', isAchieved: false },
      { asOf: '2026-02-28', currentAmount: '200', progress: '1.0', isAchieved: true },
      { asOf: '2026-03-31', currentAmount: '300', progress: '1.5', isAchieved: true },
    ]);

    expect(achievedAt).toBe('2026-02-28');
  });

  it('从未达成时返回 null', () => {
    expect(
      findFirstAchieved([{ asOf: '2026-01-31', currentAmount: '1', progress: '0.1', isAchieved: false }]),
    ).toBeNull();
  });
});

describe('所需月供反推', () => {
  it('零收益时等于线性摊分', () => {
    const result = solveRequiredMonthly({
      targetAmount: new Decimal(120000),
      currentAmount: new Decimal(0),
      months: 12,
      annualReturn: new Decimal(0),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    });

    expect(result.infeasible).toBe(false);
    expect(result.requiredMonthly!.toNumber()).toBeCloseTo(10000, 1);
  });

  it('反推结果回代复利引擎后达到目标', () => {
    const target = new Decimal(800000);
    const monthly = solveRequiredMonthly({
      targetAmount: target,
      currentAmount: new Decimal(50000),
      months: 120,
      annualReturn: new Decimal(0.06),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    }).requiredMonthly!;

    const value = new Decimal(
      simulate({
        principal: 50000,
        contributionAmount: monthly,
        contributionFrequency: 'monthly',
        contributionTiming: 'end',
        annualReturnRate: 0.06,
        years: 10,
        inflationRate: 0,
        feeRate: 0,
      }).finalNominalValue,
    );

    // 月供只精确到分，120 个月的向上取整会累积出几元溢出；
    // 有意义的不变式是"不欠账，且超出不超过一个月供"
    expect(value.greaterThanOrEqualTo(target)).toBe(true);
    expect(value.minus(target).toNumber()).toBeLessThan(monthly.toNumber());
  });

  it('当前资产已足够时所需月供为 0', () => {
    const result = solveRequiredMonthly({
      targetAmount: new Decimal(100000),
      currentAmount: new Decimal(200000),
      months: 60,
      annualReturn: new Decimal(0.05),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    });

    expect(result.alreadyAchieved).toBe(true);
    expect(result.requiredMonthly!.toNumber()).toBe(0);
  });

  it('收益为负且期限已过时无解', () => {
    const result = solveRequiredMonthly({
      targetAmount: new Decimal(100000),
      currentAmount: new Decimal(1000),
      months: 0,
      annualReturn: new Decimal(-0.2),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    });

    expect(result.infeasible).toBe(true);
    expect(result.requiredMonthly).toBeNull();
  });

  it('月供增加时到期值不减（单调性）', () => {
    const low = solveRequiredMonthly({
      targetAmount: new Decimal(500000),
      currentAmount: new Decimal(0),
      months: 120,
      annualReturn: new Decimal(0.07),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    }).requiredMonthly!;

    const high = solveRequiredMonthly({
      targetAmount: new Decimal(900000),
      currentAmount: new Decimal(0),
      months: 120,
      annualReturn: new Decimal(0.07),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    }).requiredMonthly!;

    expect(high.greaterThan(low)).toBe(true);
  });
});

describe('达成时间预测', () => {
  it('已达成时返回 0', () => {
    const result = solveEta({
      targetAmount: new Decimal(100000),
      currentAmount: new Decimal(150000),
      monthlyContribution: new Decimal(0),
      annualReturn: new Decimal(0.05),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    });

    expect(result.etaMonths).toBe(0);
  });

  it('固定月供下给出最小月数，且该月数确实达成', () => {
    const params = {
      targetAmount: new Decimal(500000),
      currentAmount: new Decimal(0),
      monthlyContribution: new Decimal(5000),
      annualReturn: new Decimal(0.05),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    };

    const eta = solveEta(params).etaMonths!;
    expect(eta).toBeGreaterThan(0);

    const atEta = new Decimal(
      simulate({
        principal: 0,
        contributionAmount: 5000,
        contributionFrequency: 'monthly',
        contributionTiming: 'end',
        annualReturnRate: 0.05,
        years: eta / 12,
        inflationRate: 0,
        feeRate: 0,
      }).finalNominalValue,
    );

    expect(atEta.greaterThanOrEqualTo(params.targetAmount)).toBe(true);

    if (eta > 1) {
      const before = new Decimal(
        simulate({
          principal: 0,
          contributionAmount: 5000,
          contributionFrequency: 'monthly',
          contributionTiming: 'end',
          annualReturnRate: 0.05,
          years: (eta - 1) / 12,
          inflationRate: 0,
          feeRate: 0,
        }).finalNominalValue,
      );
      expect(before.lessThan(params.targetAmount)).toBe(true);
    }
  });

  it('超出上限时返回 null 而不是上限值', () => {
    const result = solveEta({
      targetAmount: new Decimal(1_000_000_000),
      currentAmount: new Decimal(0),
      monthlyContribution: new Decimal(1),
      annualReturn: new Decimal(0.01),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
      maxMonths: 24,
    });

    expect(result.etaMonths).toBeNull();
    expect(result.reason).toBe('beyond_horizon');
  });

  it('零收益且零月供时无解', () => {
    const result = solveEta({
      targetAmount: new Decimal(100000),
      currentAmount: new Decimal(0),
      monthlyContribution: new Decimal(0),
      annualReturn: new Decimal(0),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
    });

    expect(result.etaMonths).toBeNull();
    expect(result.reason).toBe('no_growth_no_contribution');
  });
});

describe('预测时间线', () => {
  it('首年按月、之后按年返回抽样点', () => {
    const timeline = buildTimeline({
      startMonth: '2026-10',
      currentAmount: new Decimal(100000),
      monthlyContribution: new Decimal(1000),
      annualReturn: new Decimal(0.06),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
      months: 36,
    });

    // 1..12 + 24 + 36
    expect(timeline).toHaveLength(14);
    expect(timeline[0]!.month).toBe('2026-11');
    expect(timeline[11]!.month).toBe('2027-10');
    expect(timeline[timeline.length - 1]!.month).toBe('2029-10');
  });

  it('时间线数值单调不减', () => {
    const timeline = buildTimeline({
      startMonth: '2026-10',
      currentAmount: new Decimal(100000),
      monthlyContribution: new Decimal(1000),
      annualReturn: new Decimal(0.06),
      inflationRate: new Decimal(0),
      feeRate: new Decimal(0),
      months: 24,
    });

    for (let i = 1; i < timeline.length; i += 1) {
      expect(Number(timeline[i]!.value)).toBeGreaterThanOrEqual(Number(timeline[i - 1]!.value));
    }
  });

  it('零月数返回空数组', () => {
    expect(
      buildTimeline({
        startMonth: '2026-10',
        currentAmount: new Decimal(1),
        monthlyContribution: new Decimal(0),
        annualReturn: new Decimal(0),
        inflationRate: new Decimal(0),
        feeRate: new Decimal(0),
        months: 0,
      }),
    ).toEqual([]);
  });
});
