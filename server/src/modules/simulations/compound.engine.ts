import Decimal from 'decimal.js';

/** v2 为当前默认；v1 实现保留在同一文件下方，供旧场景按 modelVersion 重算 */
export const MODEL_VERSION = 'compound-v2';
export const SUPPORTED_MODEL_VERSIONS = ['compound-v1', 'compound-v2'] as const;

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
export function simulateV1(input: CompoundInput): CompoundResult {
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
    modelVersion: 'compound-v1',
    assumptions: {
      modelVersion: 'compound-v1',
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

export interface CompoundV2Input extends CompoundInput {
  /** 每年追加额递增率，0 表示不递增 */
  annualContributionIncrease?: Decimal.Value;
  /** 定期提款额；frequency = none 时忽略 */
  withdrawalAmount?: Decimal.Value;
  withdrawalFrequency?: 'none' | 'monthly' | 'annual';
  /** 从第几年开始提款，1 表示第一年 */
  withdrawalStartYear?: number;
  /** 收益税率，仅对当年正收益部分计税 */
  taxRate?: Decimal.Value;
}

/**
 * v2 计算内核：在 v1「收益 → 费用 → 投入」的基础上加入递增、提款与税费。
 *
 * 每年结算顺序固定为：计息 → 提款 → 定投 → 税费 → 快照。
 * 参数全为 0 时结果与 v1 一致（见单元测试锁定）。
 */
export function simulateV2(input: CompoundV2Input): CompoundResult {
  const principal = new Decimal(input.principal).toDecimalPlaces(SCALE);
  const baseContribution = new Decimal(input.contributionAmount).toDecimalPlaces(SCALE);
  const annualRate = new Decimal(input.annualReturnRate);
  const inflation = new Decimal(input.inflationRate);
  const fee = new Decimal(input.feeRate);
  const increase = new Decimal(input.annualContributionIncrease ?? 0);
  const withdrawalAmount = new Decimal(input.withdrawalAmount ?? 0).toDecimalPlaces(SCALE);
  const withdrawalFrequency = input.withdrawalFrequency ?? 'none';
  const withdrawalStartYear = input.withdrawalStartYear ?? 1;
  const taxRate = new Decimal(input.taxRate ?? 0);

  const monthlyRate = monthlyFromAnnual(annualRate);
  const monthlyFee = monthlyFromAnnualFee(fee);

  let value = principal;
  let totalContributed = principal;
  let totalWithdrawn = new Decimal(0);
  let totalTax = new Decimal(0);

  const yearlySchedule: YearlyRow[] = [];

  for (let year = 1; year <= input.years; year += 1) {
    const contributedAtYearStart = totalContributed;
    const startOfYearValue = value;

    // 当年追加额随递增率逐年放大
    const yearContribution = baseContribution.times(new Decimal(1).plus(increase).pow(year - 1));

    const yearWithdrawal =
      withdrawalFrequency === 'none' || year < withdrawalStartYear
        ? new Decimal(0)
        : withdrawalFrequency === 'annual'
          ? withdrawalAmount
          : withdrawalAmount.times(12);

    const monthlyContribution =
      input.contributionFrequency === 'monthly' ? yearContribution : new Decimal(0);
    const annualContribution =
      input.contributionFrequency === 'annual' ? yearContribution : new Decimal(0);

    const monthlyWithdrawal =
      withdrawalFrequency === 'monthly' && year >= withdrawalStartYear
        ? withdrawalAmount
        : new Decimal(0);
    const annualWithdrawal =
      withdrawalFrequency === 'annual' && year >= withdrawalStartYear
        ? withdrawalAmount
        : new Decimal(0);

    for (let month = 1; month <= 12; month += 1) {
      const isAnnualMonth = month === 1;
      const contributionThisMonth = monthlyContribution.plus(
        isAnnualMonth ? annualContribution : new Decimal(0),
      );

      if (contributionThisMonth.gt(0) && input.contributionTiming === 'begin') {
        value = value.plus(contributionThisMonth);
        totalContributed = totalContributed.plus(contributionThisMonth);
      }

      value = value.times(new Decimal(1).plus(monthlyRate));
      value = value.times(new Decimal(1).minus(monthlyFee));

      if (contributionThisMonth.gt(0) && input.contributionTiming === 'end') {
        value = value.plus(contributionThisMonth);
        totalContributed = totalContributed.plus(contributionThisMonth);
      }

      // 提款不把余额扣成负数：最多扣到 0，剩余缺口不再记入
      const withdrawalThisMonth = monthlyWithdrawal.plus(isAnnualMonth ? annualWithdrawal : new Decimal(0));
      if (withdrawalThisMonth.gt(0) && value.gt(0)) {
        const actual = Decimal.min(withdrawalThisMonth, value);
        value = value.minus(actual);
        totalWithdrawn = totalWithdrawn.plus(actual);
      }
    }

    // 税费对本年正收益部分计征，从年末余额扣除
    if (taxRate.gt(0)) {
      const gain = value.minus(startOfYearValue).minus(
        totalContributed.minus(contributedAtYearStart),
      );
      // 反加回本年提款：提款不属于亏损，计税收益以「未提款时的增长」为口径
      const taxableGain = gain.plus(yearWithdrawal);
      if (taxableGain.gt(0)) {
        const tax = taxableGain.times(taxRate);
        value = value.minus(tax);
        totalTax = totalTax.plus(tax);
      }
    }

    value = value.toDecimalPlaces(SCALE);
    totalContributed = totalContributed.toDecimalPlaces(SCALE);
    totalWithdrawn = totalWithdrawn.toDecimalPlaces(SCALE);
    totalTax = totalTax.toDecimalPlaces(SCALE);

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
    modelVersion: 'compound-v2',
    assumptions: {
      modelVersion: 'compound-v2',
      monthlyRateBasis: '月度有效利率 = (1+年化)^(1/12) - 1',
      monthlyFeeBasis: '月度费用率 = 1 - (1-年费率)^(1/12)',
      iterationOrder: '计息 → 提款 → 定投 → 税费',
      contributionTiming: input.contributionTiming === 'begin' ? '期初投入' : '期末投入',
      annualContributionMonth: '年付投入落在每年第一个月的子步',
      annualContributionIncrease: increase.toString(),
      withdrawalFrequency,
      withdrawalStartYear: withdrawalStartYear,
      taxRate: taxRate.toString(),
      totalWithdrawn: totalWithdrawn.toString(),
      totalTax: totalTax.toString(),
      annualReturnRate: annualRate.toString(),
      inflationRate: inflation.toString(),
      feeRate: fee.toString(),
      disclaimer: '固定收益率仅为数学假设，不代表实际投资收益承诺',
    },
  };
}

/** 按场景记录的 modelVersion 分派：旧场景结果不得因升级而改变 */
export function simulate(
  input: CompoundV2Input,
  modelVersion: string = MODEL_VERSION,
): CompoundResult {
  if (modelVersion === 'compound-v1') {
    return simulateV1(input);
  }
  return simulateV2(input);
}
