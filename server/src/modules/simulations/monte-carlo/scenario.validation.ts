import {
  MONTE_CARLO_MAX_ASSETS,
  MONTE_CARLO_MAX_PATHS,
  MONTE_CARLO_MAX_YEARS,
} from '../../../config/constants.js';
import { errors } from '../../../lib/errors.js';
import { cholesky, identityMatrix, validateCorrelation, type Matrix } from './correlation.js';
import type { Frequency, MonteCarloAsset, Rebalance, Timing } from './monte-carlo.engine.js';

export interface NormalizedScenario {
  years: number;
  pathCount: number;
  rebalance: Rebalance;
  assets: MonteCarloAsset[];
  /** 已通过校验并分解的下三角矩阵 */
  cholesky: Matrix;
  correlation: Matrix;
  initialValue: number;
  contribution: { amount: number; frequency: Frequency; timing: Timing };
  withdrawal: { amount: number; frequency: Frequency; startYear: number };
  inflationRate: number;
  feeRate: number;
  targetAmount: number | null;
}

export interface RawScenario {
  years: number;
  pathCount: number;
  rebalance: Rebalance;
  assets: Array<{
    key: string;
    label: string;
    weight: number;
    expectedAnnualReturn: number;
    annualVolatility: number;
  }>;
  correlation: Matrix;
  settings: {
    initialValue: number;
    contribution: { amount: number; frequency: Frequency; timing: Timing };
    withdrawal: { amount: number; frequency: Frequency; startYear: number };
    inflationRate: number;
    feeRate: number;
    targetAmount: number | null;
  };
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw errors.mcParametersInvalid(`${field} 必须是有限数值`);
  }
}

/**
 * 参数归一化与校验。
 * 校验顺序本身是规范（客户端依赖错误码定位到具体 Tab）：
 * 标量 → 权重 → 相关矩阵 → Cholesky → 现金流一致性 → 提款起止。
 */
export function normalizeScenario(raw: RawScenario): NormalizedScenario {
  // 1. 标量范围
  if (!Number.isInteger(raw.years) || raw.years < 1 || raw.years > MONTE_CARLO_MAX_YEARS) {
    throw errors.mcParametersInvalid(`模拟年限必须在 1 到 ${MONTE_CARLO_MAX_YEARS} 年之间`);
  }

  if (!Number.isInteger(raw.pathCount) || raw.pathCount < 100 || raw.pathCount > MONTE_CARLO_MAX_PATHS) {
    throw errors.mcParametersInvalid(`路径数必须在 100 到 ${MONTE_CARLO_MAX_PATHS} 之间`);
  }

  assertFinite(raw.settings.initialValue, '初始本金');
  assertFinite(raw.settings.inflationRate, '通胀率');
  assertFinite(raw.settings.feeRate, '费用率');
  assertFinite(raw.settings.contribution.amount, '定投金额');
  assertFinite(raw.settings.withdrawal.amount, '提款金额');

  if (raw.settings.initialValue < 0) throw errors.mcParametersInvalid('初始本金不能为负');
  if (raw.settings.contribution.amount < 0) throw errors.mcParametersInvalid('定投金额不能为负');
  if (raw.settings.withdrawal.amount < 0) throw errors.mcParametersInvalid('提款金额不能为负');
  if (raw.settings.inflationRate < -0.5 || raw.settings.inflationRate > 0.5) {
    throw errors.mcParametersInvalid('通胀率必须在 -50% 到 50% 之间');
  }
  if (raw.settings.feeRate < 0 || raw.settings.feeRate > 0.05) {
    throw errors.mcParametersInvalid('费用率必须在 0 到 5% 之间');
  }
  if (raw.settings.targetAmount !== null && raw.settings.targetAmount < 0) {
    throw errors.mcParametersInvalid('目标金额不能为负');
  }

  // 2. 资产数量与权重
  if (raw.assets.length === 0 || raw.assets.length > MONTE_CARLO_MAX_ASSETS) {
    throw errors.mcParametersInvalid(`资产数量必须在 1 到 ${MONTE_CARLO_MAX_ASSETS} 项之间`);
  }

  const keys = new Set<string>();
  for (const asset of raw.assets) {
    if (!asset.key || asset.key.length > 64) {
      throw errors.mcParametersInvalid('资产标识不合法');
    }
    if (keys.has(asset.key)) {
      throw errors.mcParametersInvalid(`资产标识重复：${asset.key}`);
    }
    keys.add(asset.key);

    assertFinite(asset.weight, `资产「${asset.key}」的权重`);
    assertFinite(asset.expectedAnnualReturn, `资产「${asset.key}」的预期收益`);
    assertFinite(asset.annualVolatility, `资产「${asset.key}」的波动率`);

    if (asset.weight < 0) throw errors.mcWeightsInvalid(String(raw.assets.reduce((s, a) => s + a.weight, 0)));
    if (asset.expectedAnnualReturn < -0.99 || asset.expectedAnnualReturn > 1) {
      throw errors.mcParametersInvalid(`资产「${asset.key}」的预期年化收益必须在 -99% 到 100% 之间`);
    }
    if (asset.annualVolatility < 0 || asset.annualVolatility > 2) {
      throw errors.mcParametersInvalid(`资产「${asset.key}」的年化波动率必须在 0 到 200% 之间`);
    }
  }

  const weightTotal = raw.assets.reduce((sum, asset) => sum + asset.weight, 0);
  if (Math.abs(weightTotal - 1) > 1e-6) {
    throw errors.mcWeightsInvalid(weightTotal.toFixed(6));
  }

  // 3. 相关矩阵
  const correlation = raw.assets.length === 1 ? [[1]] : raw.correlation;
  const validation = validateCorrelation(correlation, raw.assets.length);
  if (!validation.ok) {
    throw errors.mcCorrelationInvalid(validation.reason ?? 'invalid', validation.message);
  }

  // 4. Cholesky：非正定直接拒绝，不做静默修正
  const decomposed = cholesky(correlation);
  if (!decomposed.ok || !decomposed.lower) {
    throw errors.mcCorrelationInvalid('not_positive_definite', decomposed.message);
  }

  // 5. 现金流一致性
  const { contribution, withdrawal, initialValue, targetAmount } = raw.settings;
  if (initialValue === 0 && contribution.amount === 0 && withdrawal.amount === 0) {
    throw errors.mcParametersInvalid('初始本金、定投与提款至少需要一项大于 0');
  }

  // 6. 提款起止与年限
  if (withdrawal.frequency !== 'none') {
    if (withdrawal.amount === 0) {
      throw errors.mcParametersInvalid('启用提款时金额必须大于 0');
    }
    if (!Number.isInteger(withdrawal.startYear) || withdrawal.startYear < 1 || withdrawal.startYear > raw.years) {
      throw errors.mcParametersInvalid('提款起始年必须落在模拟年限内');
    }
  }

  return {
    years: raw.years,
    pathCount: raw.pathCount,
    rebalance: raw.rebalance,
    assets: raw.assets.map((asset) => ({
      key: asset.key,
      label: asset.label.slice(0, 80),
      weight: asset.weight,
      expectedAnnualReturn: asset.expectedAnnualReturn,
      annualVolatility: asset.annualVolatility,
    })),
    cholesky: decomposed.lower,
    correlation,
    initialValue,
    contribution,
    withdrawal,
    inflationRate: raw.settings.inflationRate,
    feeRate: raw.settings.feeRate,
    targetAmount,
  };
}

export { identityMatrix };
