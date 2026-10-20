import Decimal from 'decimal.js';

export const MODEL_VERSION = 'compound-v1';

export interface CompoundInput {
  principal: Decimal.Value;
  contributionAmount: Decimal.Value;
  contributionFrequency: 'none' | 'monthly' | 'annual';
  contributionTiming: 'begin' | 'end';
  annualReturnRate: Decimal.Value;
  years: number;
  inflationRate: Decimal.Value;
  feeRate: Decimal.Value;
}

export interface YearlyRow {
  year: number;
  contributedThisYear: Decimal;
  totalContributed: Decimal;
  nominalValue: Decimal;
  realValue: Decimal;
  cumulativeGain: Decimal;
}

export interface CompoundResult {
  totalContributed: Decimal;
  finalNominalValue: Decimal;
  totalGain: Decimal;
  finalRealValue: Decimal;
  yearlySchedule: YearlyRow[];
  effectiveAnnualReturn: Decimal;
  modelVersion: string;
  assumptions: Record<string, string | number>;
}

const SCALE = 6;

function monthlyFromAnnual(rate: Decimal): Decimal {
  // 月度有效利率：不采用 r/12 简单除法，两者结果差异显著
  return new Decimal(1).plus(rate).pow(new Decimal(1).div(12)).minus(1);
}

function monthlyFromAnnualFee(rate: Decimal): Decimal {
  return new Decimal(1).minus(new Decimal(1).minus(rate).pow(new Decimal(1).div(12)));
}

/**
 * 复利与定投计算内核。
 * 纯函数：相同输入必得相同输出，不读时钟、不访问数据库。
 * 迭代顺序固定为「收益 → 费用 → 投入」，投入时点由 contributionTiming 决定。
 */
export function simulate(input: CompoundInput): CompoundResult {
  const principal = new Decimal(input.principal).toDecimalPlaces(SCALE);
  const contribution = new Decimal(input.contributionAmount).toDecimalPlaces(SCALE);
  const annualRate = new Decimal(input.annualReturnRate);
  const inflation = new Decimal(input.inflationRate);
  const fee = new Decimal(input.feeRate);

  const monthlyRate = monthlyFromAnnual(annualRate);
  const monthlyFee = monthlyFromAnnualFee(fee);

  const monthlyContribution =
    input.contributionFrequency === 'monthly' ? contribution : new Decimal(0);
  const annualContribution =
    input.contributionFrequency === 'annual' ? contribution : new Decimal(0);

  let value = principal;
  let totalContributed = principal;

  const yearlySchedule: YearlyRow[] = [];

  for (let year = 1; year <= input.years; year += 1) {
    const contributedAtYearStart = totalContributed;

    for (let month = 1; month <= 12; month += 1) {
      // 年付仍按月为子步迭代，投入落在每年第一个月
      const isAnnualContributionMonth = month === 1;
      const contributionThisMonth = monthlyContribution.plus(
        isAnnualContributionMonth ? annualContribution : new Decimal(0),
      );

      const contributeNow =
        contributionThisMonth.gt(0) && input.contributionTiming === 'begin';

      if (contributeNow) {
        value = value.plus(contributionThisMonth);
        totalContributed = totalContributed.plus(contributionThisMonth);
      }

      value = value.times(new Decimal(1).plus(monthlyRate));
      value = value.times(new Decimal(1).minus(monthlyFee));

      if (contributionThisMonth.gt(0) && input.contributionTiming === 'end') {
        value = value.plus(contributionThisMonth);
        totalContributed = totalContributed.plus(contributionThisMonth);
      }
    }

    value = value.toDecimalPlaces(SCALE);
    totalContributed = totalContributed.toDecimalPlaces(SCALE);

    const realValue = value.div(new Decimal(1).plus(inflation).pow(year));

    yearlySchedule.push({
      year,
      contributedThisYear: totalContributed.minus(contributedAtYearStart).toDecimalPlaces(SCALE),
      totalContributed,
      nominalValue: value,
      realValue: realValue.toDecimalPlaces(SCALE),
      cumulativeGain: value.minus(totalContributed).toDecimalPlaces(SCALE),
    });
  }

  const finalRow = yearlySchedule[yearlySchedule.length - 1];
  const finalNominalValue = finalRow?.nominalValue ?? principal;
  const finalRealValue = finalRow?.realValue ?? principal;
  const totalGain = finalNominalValue.minus(totalContributed).toDecimalPlaces(SCALE);

  // 由结果反推有效年化，用于交叉验证输入假设是否与结果一致
  const effectiveAnnualReturn =
    input.years > 0 && principal.gt(0)
      ? finalNominalValue.div(principal).pow(new Decimal(1).div(input.years)).minus(1)
      : new Decimal(0);

  return {
    totalContributed,
    finalNominalValue,
    totalGain,
    finalRealValue,
    yearlySchedule,
    effectiveAnnualReturn: effectiveAnnualReturn.toDecimalPlaces(6),
    modelVersion: MODEL_VERSION,
    assumptions: {
      modelVersion: MODEL_VERSION,
      monthlyRateBasis: '月度有效利率 = (1+年化)^(1/12) - 1',
      monthlyFeeBasis: '月度费用率 = 1 - (1-年费率)^(1/12)',
      iterationOrder: '收益 → 费用 → 投入',
      contributionTiming: input.contributionTiming === 'begin' ? '期初投入' : '期末投入',
      annualContributionMonth: '年付投入落在每年第一个月的子步',
      annualReturnRate: annualRate.toString(),
      inflationRate: inflation.toString(),
      feeRate: fee.toString(),
      disclaimer: '固定收益率仅为数学假设，不代表实际投资收益承诺',
    },
  };
}
