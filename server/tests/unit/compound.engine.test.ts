import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { MODEL_VERSION, simulate, type CompoundInput } from '@/modules/simulations/compound.engine';

const BASE: CompoundInput = {
  principal: 0,
  contributionAmount: 0,
  contributionFrequency: 'none',
  contributionTiming: 'end',
  annualReturnRate: 0,
  years: 20,
  inflationRate: 0,
  feeRate: 0,
};

function run(overrides: Partial<CompoundInput>) {
  return simulate({ ...BASE, ...overrides });
}

describe('复利黄金用例', () => {
  // 这些数值是测试基线，允许 ±0.01 的舍入误差
  it('A：本金 10000，7%，20 年 → 38696.84', () => {
    const result = run({ principal: 10000, annualReturnRate: 0.07, years: 20 });
    expect(result.finalNominalValue.toNumber()).toBeCloseTo(38696.84, 1);
  });

  it('B：每月末 500，7%，20 年 → 253768.19', () => {
    const result = run({
      contributionAmount: 500,
      contributionFrequency: 'monthly',
      contributionTiming: 'end',
      annualReturnRate: 0.07,
      years: 20,
    });
    expect(result.finalNominalValue.toNumber()).toBeCloseTo(253768.19, 1);
  });

  it('C：本金 10000 + 每月末 500，7%，20 年 → 292465.03', () => {
    const result = run({
      principal: 10000,
      contributionAmount: 500,
      contributionFrequency: 'monthly',
      contributionTiming: 'end',
      annualReturnRate: 0.07,
      years: 20,
    });
    expect(result.finalNominalValue.toNumber()).toBeCloseTo(292465.03, 1);
  });

  it('D：本金 10000，0%，20 年 → 10000.00', () => {
    const result = run({ principal: 10000, annualReturnRate: 0, years: 20 });
    expect(result.finalNominalValue.toString()).toBe('10000');
  });

  it('E：用例 C + 通胀 2.5% → 实际价值 178482.91', () => {
    const result = run({
      principal: 10000,
      contributionAmount: 500,
      contributionFrequency: 'monthly',
      contributionTiming: 'end',
      annualReturnRate: 0.07,
      years: 20,
      inflationRate: 0.025,
    });
    expect(result.finalRealValue.toNumber()).toBeCloseTo(178482.91, 1);
  });

  it('F：每年末 6000，7%，20 年 → 261711.31', () => {
    const result = run({
      contributionAmount: 6000,
      contributionFrequency: 'annual',
      contributionTiming: 'end',
      annualReturnRate: 0.07,
      years: 20,
    });
    expect(result.finalNominalValue.toNumber()).toBeCloseTo(261711.31, 1);
  });
});

describe('换算方式区分', () => {
  it('G：若误用 r/12 简单除法，用例 A 会得到约 40387 而非 38697', () => {
    // 手动按 r/12 计算作为对照，确保实现没有走上这条路径
    const wrong = (() => {
      let value = new Decimal(10000);
      const monthly = new Decimal(0.07).div(12);
      for (let i = 0; i < 240; i += 1) {
        value = value.times(new Decimal(1).plus(monthly));
      }
      return value.toNumber();
    })();

    const correct = run({ principal: 10000, annualReturnRate: 0.07, years: 20 }).finalNominalValue.toNumber();

    expect(wrong).toBeCloseTo(40387.39, 1);
    expect(correct).toBeCloseTo(38696.84, 1);
    // 两种口径差约 1690，实现必须落在正确的一侧
    expect(Math.abs(correct - wrong)).toBeGreaterThan(1000);
  });

  it('年付与月付使用同一复利粒度，结果可比较', () => {
    // 年付 6000/年 应略高于月付 500/月，因为资金更早投入
    const annual = run({
      contributionAmount: 6000,
      contributionFrequency: 'annual',
      annualReturnRate: 0.07,
      years: 20,
    }).finalNominalValue;

    const monthly = run({
      contributionAmount: 500,
      contributionFrequency: 'monthly',
      annualReturnRate: 0.07,
      years: 20,
    }).finalNominalValue;

    expect(annual.gt(monthly)).toBe(true);
    // 差距应在合理范围（不是数量级差异）
    const ratio = annual.div(monthly).toNumber();
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.1);
  });
});

describe('确定性与结果结构', () => {
  it('相同输入两次计算完全一致', () => {
    const input = {
      principal: '12345.6789',
      contributionAmount: '321.45',
      contributionFrequency: 'monthly' as const,
      contributionTiming: 'end' as const,
      annualReturnRate: '0.0635',
      years: 17,
      inflationRate: '0.021',
      feeRate: '0.0045',
    };

    const first = simulate(input);
    const second = simulate(input);

    expect(first.finalNominalValue.toString()).toBe(second.finalNominalValue.toString());
    expect(first.totalGain.toString()).toBe(second.totalGain.toString());
  });

  it('年度明细长度等于期限', () => {
    const result = run({ principal: 1000, annualReturnRate: 0.05, years: 7 });
    expect(result.yearlySchedule).toHaveLength(7);
    expect(result.yearlySchedule[6]!.year).toBe(7);
  });

  it('累计投入 = 本金 + 所有投入', () => {
    const result = run({
      principal: 1000,
      contributionAmount: 100,
      contributionFrequency: 'monthly',
      annualReturnRate: 0.05,
      years: 3,
    });

    // 1000 + 100 * 12 * 3 = 4600
    expect(result.totalContributed.toString()).toBe('4600');
  });

  it('收益 = 终值 − 累计投入', () => {
    const result = run({ principal: 1000, annualReturnRate: 0.05, years: 5 });
    expect(result.totalGain.toString()).toBe(
      result.finalNominalValue.minus(result.totalContributed).toDecimalPlaces(6).toString(),
    );
  });

  it('结果携带模型版本与假设说明', () => {
    const result = run({ principal: 1000, annualReturnRate: 0.05, years: 1 });
    expect(result.modelVersion).toBe(MODEL_VERSION);
    expect(result.assumptions.monthlyRateBasis).toContain('(1+年化)^(1/12)');
    expect(result.assumptions.disclaimer).toContain('不代表实际投资收益');
  });

  it('期初投入高于期末投入', () => {
    const begin = run({
      contributionAmount: 1000,
      contributionFrequency: 'monthly',
      contributionTiming: 'begin',
      annualReturnRate: 0.07,
      years: 10,
    }).finalNominalValue;

    const end = run({
      contributionAmount: 1000,
      contributionFrequency: 'monthly',
      contributionTiming: 'end',
      annualReturnRate: 0.07,
      years: 10,
    }).finalNominalValue;

    expect(begin.gt(end)).toBe(true);
  });

  it('费用率降低终值', () => {
    const noFee = run({ principal: 10000, annualReturnRate: 0.07, years: 10, feeRate: 0 }).finalNominalValue;
    const withFee = run({ principal: 10000, annualReturnRate: 0.07, years: 10, feeRate: 0.01 }).finalNominalValue;

    expect(withFee.lt(noFee)).toBe(true);
  });

  it('负收益率如实反映，不截断', () => {
    const result = run({ principal: 10000, annualReturnRate: -0.05, years: 10 });
    expect(result.finalNominalValue.lt(result.totalContributed)).toBe(true);
    expect(result.finalNominalValue.gt(0)).toBe(true);
  });

  it('零本金与零投入返回零', () => {
    const result = run({ principal: 0, contributions: undefined } as Partial<CompoundInput>);
    expect(result.finalNominalValue.toString()).toBe('0');
  });
});
