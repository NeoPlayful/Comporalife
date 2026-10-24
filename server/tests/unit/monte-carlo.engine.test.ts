import { describe, expect, it } from 'vitest';
import { simulate as simulateCompound } from '@/modules/simulations/compound.engine';
import { cholesky, identityMatrix, validateCorrelation } from '@/modules/simulations/monte-carlo/correlation';
import {
  aggregatePaths,
  simulate,
  simulatePaths,
  simulateSinglePath,
  type MonteCarloInput,
} from '@/modules/simulations/monte-carlo/monte-carlo.engine';
import {
  NormalSampler,
  Xoshiro128,
  pathSeed,
  splitmix32,
} from '@/modules/simulations/monte-carlo/random';
import { STRESS_PRESETS, simulateStress } from '@/modules/simulations/monte-carlo/stress';

function baseInput(overrides: Partial<MonteCarloInput> = {}): MonteCarloInput {
  return {
    years: 5,
    pathCount: 200,
    seed: 12345,
    rebalance: 'none',
    assets: [
      { key: 'equity', label: 'Equity', weight: 1, expectedAnnualReturn: 0.07, annualVolatility: 0 },
    ],
    cholesky: [[1]],
    initialValue: 10_000,
    contribution: { amount: 0, frequency: 'none', timing: 'end' },
    withdrawal: { amount: 0, frequency: 'none', startYear: 1 },
    inflationRate: 0,
    feeRate: 0,
    targetAmount: null,
    ...overrides,
  };
}

describe('随机数发生器', () => {
  it('同一种子产生完全相同的序列', () => {
    const a = new Xoshiro128(42);
    const b = new Xoshiro128(42);
    const seqA = Array.from({ length: 20 }, () => a.nextUint32());
    const seqB = Array.from({ length: 20 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it('不同种子产生不同序列', () => {
    const a = new Xoshiro128(1);
    const b = new Xoshiro128(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it('输出总是无符号 32 位整数', () => {
    const rng = new Xoshiro128(7);
    for (let i = 0; i < 200; i += 1) {
      const value = rng.nextUint32();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('均匀数落在 (0,1) 且分布大致均匀', () => {
    const rng = new Xoshiro128(99);
    const buckets = new Array(10).fill(0);
    const n = 20_000;

    for (let i = 0; i < n; i += 1) {
      const u = rng.nextUniform();
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThanOrEqual(1);
      buckets[Math.min(9, Math.floor(u * 10))]! += 1;
    }

    // 每个桶期望 2000，允许 ±30% 波动
    for (const count of buckets) {
      expect(count).toBeGreaterThan(1400);
      expect(count).toBeLessThan(2600);
    }
  });

  it('路径随机流与顺序无关：同一索引总是同一序列', () => {
    const seed = 777;
    const first = new Xoshiro128(pathSeed(seed, 5));
    const second = new Xoshiro128(pathSeed(seed, 5));

    expect(Array.from({ length: 10 }, () => first.nextUint32())).toEqual(
      Array.from({ length: 10 }, () => second.nextUint32()),
    );
  });

  it('splitmix32 输出非负整数', () => {
    for (const seed of [0, 1, 42, 2 ** 31 - 1]) {
      const value = splitmix32(seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('正态抽样', () => {
  it('均值接近 0、方差接近 1', () => {
    const sampler = new NormalSampler(new Xoshiro128(2024));
    const n = 50_000;
    const values = Array.from({ length: n }, () => sampler.next());

    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;

    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });

  it('不使用跨调用缓存：每次调用都消耗新的均匀数', () => {
    // 若实现缓存成对正态值，两次连续调用会复用同一对，序列会呈强相关
    const sampler = new NormalSampler(new Xoshiro128(5));
    const values = Array.from({ length: 1000 }, () => sampler.next());
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.15);
  });
});

describe('相关矩阵', () => {
  it('单位矩阵通过校验并可分解', () => {
    const matrix = identityMatrix(3);
    expect(validateCorrelation(matrix, 3).ok).toBe(true);

    const result = cholesky(matrix);
    expect(result.ok).toBe(true);
    expect(result.lower?.[0]?.[0]).toBeCloseTo(1, 10);
  });

  it('维度不符被拒绝', () => {
    const result = validateCorrelation([[1, 0]], 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('dimension_mismatch');
  });

  it('不对称矩阵被拒绝', () => {
    const result = validateCorrelation(
      [
        [1, 0.5],
        [0.2, 1],
      ],
      2,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_symmetric');
  });

  it('对角线不为 1 被拒绝', () => {
    const result = validateCorrelation(
      [
        [0.9, 0],
        [0, 1],
      ],
      2,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('diagonal_not_one');
  });

  it('超出 [-1,1] 被拒绝', () => {
    const result = validateCorrelation(
      [
        [1, 1.5],
        [1.5, 1],
      ],
      2,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('out_of_range');
  });

  it('非正定矩阵拒绝分解', () => {
    // 三个两两 +0.9 相关的资产在数学上不可能同时成立
    const matrix = [
      [1, 0.9, 0.9],
      [0.9, 1, -0.9],
      [0.9, -0.9, 1],
    ];
    expect(validateCorrelation(matrix, 3).ok).toBe(true);

    const result = cholesky(matrix);
    expect(result.ok).toBe(false);
    expect(result.lower).toBeNull();
  });

  it('分解结果满足 L·Lᵀ = Σ', () => {
    const matrix = [
      [1, 0.3],
      [0.3, 1],
    ];
    const result = cholesky(matrix);
    const lower = result.lower!;

    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        let sum = 0;
        for (let k = 0; k < 2; k += 1) sum += lower[i]![k]! * lower[j]![k]!;
        expect(sum).toBeCloseTo(matrix[i]![j]!, 10);
      }
    }
  });
});

describe('零波动等价性', () => {
  it('零波动时终值中位数等于复利引擎结果', async () => {
    const years = 20;
    const expected = simulateCompound({
      principal: 10_000,
      contributionAmount: 500,
      contributionFrequency: 'monthly',
      contributionTiming: 'end',
      annualReturnRate: 0.07,
      years,
      inflationRate: 0,
      feeRate: 0,
    });

    const outcome = await simulate(
      baseInput({
        years,
        pathCount: 300,
        initialValue: 10_000,
        contribution: { amount: 500, frequency: 'monthly', timing: 'end' },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // 零波动时各路径完全相同，中位数应与复利引擎一致（允许舍入误差）
    expect(outcome.result.terminal.nominal.p50).toBeCloseTo(
      expected.finalNominalValue.toNumber(),
      1,
    );
  });

  it('零波动时所有路径终值相同', async () => {
    const outcome = await simulate(baseInput({ pathCount: 100 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { terminal } = outcome.result;
    expect(terminal.nominal.p5).toBeCloseTo(terminal.nominal.p95, 6);
    expect(terminal.nominal.sd).toBeLessThan(1e-6);
  });
});

describe('确定性', () => {
  it('相同输入两次调用逐字段相等', async () => {
    const input = baseInput({
      assets: [
        { key: 'a', label: 'A', weight: 0.6, expectedAnnualReturn: 0.08, annualVolatility: 0.18 },
        { key: 'b', label: 'B', weight: 0.4, expectedAnnualReturn: 0.03, annualVolatility: 0.06 },
      ],
      cholesky: cholesky([
        [1, 0.2],
        [0.2, 1],
      ]).lower!,
      pathCount: 300,
    });

    const first = await simulate(input);
    const second = await simulate(input);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.result.terminal.nominal).toEqual(second.result.terminal.nominal);
    expect(first.result.probabilities).toEqual(second.result.probabilities);
    expect(first.result.drawdown).toEqual(second.result.drawdown);
  });

  it('单路径单独重算与全量运行一致', () => {
    const input = baseInput({ pathCount: 50 });

    const batch = simulatePaths(input, 0, 50);
    const single = simulateSinglePath(input, 17);

    expect(single.yearly[single.yearly.length - 1]).toBeCloseTo(batch.terminal[17]!, 6);
  });

  it('分片聚合与一次性聚合结果一致', async () => {
    const input = baseInput({ pathCount: 200 });

    const full = await simulate(input);
    const chunked = aggregatePaths(input, [
      simulatePaths(input, 0, 50),
      simulatePaths(input, 50, 120),
      simulatePaths(input, 120, 200),
    ]);

    expect(full.ok).toBe(true);
    if (!full.ok) return;

    expect(chunked.terminal.nominal).toEqual(full.result.terminal.nominal);
    expect(chunked.probabilities).toEqual(full.result.probabilities);
  });
});

describe('统计口径', () => {
  it('分位数单调递增', async () => {
    const outcome = await simulate(
      baseInput({
        pathCount: 500,
        assets: [
          { key: 'a', label: 'A', weight: 1, expectedAnnualReturn: 0.07, annualVolatility: 0.2 },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const q = outcome.result.terminal.nominal;
    expect(q.p5).toBeLessThanOrEqual(q.p10);
    expect(q.p10).toBeLessThanOrEqual(q.p25);
    expect(q.p25).toBeLessThanOrEqual(q.p50);
    expect(q.p50).toBeLessThanOrEqual(q.p75);
    expect(q.p75).toBeLessThanOrEqual(q.p90);
    expect(q.p90).toBeLessThanOrEqual(q.p95);
  });

  it('概率全部落在 [0,1]', async () => {
    const outcome = await simulate(
      baseInput({
        pathCount: 300,
        targetAmount: 20_000,
        assets: [
          { key: 'a', label: 'A', weight: 1, expectedAnnualReturn: 0.05, annualVolatility: 0.25 },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const p = outcome.result.probabilities;
    for (const value of [p.loss, p.realLoss, p.ruin, p.target!]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('未设目标时达标概率为 null 而不是 0', async () => {
    const outcome = await simulate(baseInput({ targetAmount: null }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.probabilities.target).toBeNull();
  });

  it('无提款时破产概率为 0', async () => {
    const outcome = await simulate(baseInput({ pathCount: 300 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.probabilities.ruin).toBe(0);
  });

  it('回撤落在 [0,1] 且零波动时为 0', async () => {
    const outcome = await simulate(baseInput({ pathCount: 50 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.drawdown.mean).toBeCloseTo(0, 6);
    expect(outcome.result.drawdown.p99).toBeGreaterThanOrEqual(0);
    expect(outcome.result.drawdown.p99).toBeLessThanOrEqual(1);
  });

  it('标准误等于标准差除以根号路径数', async () => {
    const outcome = await simulate(
      baseInput({
        pathCount: 400,
        assets: [
          { key: 'a', label: 'A', weight: 1, expectedAnnualReturn: 0.07, annualVolatility: 0.2 },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const expected = outcome.result.terminal.nominal.sd / Math.sqrt(400);
    expect(outcome.result.standardError).toBeCloseTo(expected, 6);
  });

  it('直方图桶数固定且合计等于路径数', async () => {
    const outcome = await simulate(baseInput({ pathCount: 300 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const { bins } = outcome.result.histogram;
    expect(bins).toHaveLength(20);
    expect(bins.reduce((sum, v) => sum + v, 0)).toBe(300);
  });

  it('年度带每年一个点且 P10 ≤ P50 ≤ P90', async () => {
    const outcome = await simulate(
      baseInput({
        years: 10,
        pathCount: 300,
        assets: [
          { key: 'a', label: 'A', weight: 1, expectedAnnualReturn: 0.07, annualVolatility: 0.2 },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.yearlyBands).toHaveLength(10);
    for (const band of outcome.result.yearlyBands) {
      expect(band.p10).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p90);
    }
  });
});

describe('现金流行为', () => {
  it('提款可导致破产，且破产后不再累计投入', async () => {
    const outcome = await simulate(
      baseInput({
        years: 5,
        pathCount: 100,
        initialValue: 1_000,
        withdrawal: { amount: 1_000, frequency: 'monthly', startYear: 1 },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.probabilities.ruin).toBe(1);
    expect(outcome.result.terminal.nominal.p50).toBe(0);
  });

  it('定投固定时各路径累计投入相同', async () => {
    const outcome = await simulate(
      baseInput({
        years: 3,
        pathCount: 100,
        initialValue: 0,
        contribution: { amount: 100, frequency: 'monthly', timing: 'end' },
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const contributed = outcome.result.contributed.nominal;
    // 36 个月 × 100 = 3600
    expect(contributed.p50).toBeCloseTo(3_600, 6);
    expect(contributed.p5).toBeCloseTo(contributed.p95, 6);
  });

  it('通胀折算降低实际终值', async () => {
    const nominal = await simulate(baseInput({ years: 10, pathCount: 100 }));
    const inflated = await simulate(baseInput({ years: 10, pathCount: 100, inflationRate: 0.03 }));

    expect(nominal.ok && inflated.ok).toBe(true);
    if (!nominal.ok || !inflated.ok) return;

    expect(inflated.result.terminal.real.p50).toBeLessThan(
      inflated.result.terminal.nominal.p50,
    );
    expect(nominal.result.terminal.real.p50).toBeCloseTo(
      nominal.result.terminal.nominal.p50,
      6,
    );
  });
});

describe('压力情景', () => {
  it('每个预设都产出确定性单路径结果', () => {
    for (const preset of STRESS_PRESETS) {
      const result = simulateStress(baseInput({ years: 10 }), preset);

      expect(result.deterministic).toBe(true);
      expect(result.standardError).toBe(0);
      // 确定性情景没有达标概率语义
      expect(result.probabilities.target).toBeNull();
      expect(result.samplePaths).toHaveLength(1);
    }
  });

  it('崩盘情景产生显著回撤，而持平情景没有', () => {
    // 崩盘按设计在 24 个月内恢复到原水平，因此长期终值可能与持平情景相同；
    // 两者的真实差异体现在回撤而不是终值上
    const flat = simulateStress(
      baseInput({ years: 10, assets: [{ key: 'a', label: 'A', weight: 1, expectedAnnualReturn: 0, annualVolatility: 0 }] }),
      STRESS_PRESETS.find((preset) => preset.key === 'lost_decade')!,
    );

    const crash = simulateStress(
      baseInput({ years: 10, assets: [{ key: 'a', label: 'A', weight: 1, expectedAnnualReturn: 0, annualVolatility: 0 }] }),
      STRESS_PRESETS.find((preset) => preset.key === 'crash')!,
    );

    expect(crash.drawdown.mean).toBeGreaterThan(0.3);
    expect(flat.drawdown.mean).toBeCloseTo(0, 6);
    expect(crash.drawdown.mean).toBeGreaterThan(flat.drawdown.mean);
  });

  it('提款下崩盘情景比持平情景更早破产', () => {
    const settings = {
      years: 10,
      initialValue: 100_000,
      withdrawal: { amount: 800, frequency: 'monthly' as const, startYear: 1 },
    };

    const flat = simulateStress(baseInput(settings), STRESS_PRESETS.find((preset) => preset.key === 'lost_decade')!);
    const crash = simulateStress(baseInput(settings), STRESS_PRESETS.find((preset) => preset.key === 'crash')!);

    expect(crash.terminal.nominal.p50).toBeLessThan(flat.terminal.nominal.p50);
  });
});

describe('取消与进度', () => {
  it('shouldCancel 返回 true 时中断并报告 cancelled', async () => {
    const outcome = await simulate(baseInput({ pathCount: 500 }), {
      shouldCancel: () => true,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.cancelled).toBe(true);
  });

  it('onChunk 按递增顺序报告已处理路径数', async () => {
    const reported: number[] = [];
    await simulate(baseInput({ pathCount: 200 }), {
      onChunk: (processed) => {
        reported.push(processed);
      },
    });

    expect(reported.length).toBeGreaterThan(0);
    for (let i = 1; i < reported.length; i += 1) {
      expect(reported[i]!).toBeGreaterThan(reported[i - 1]!);
    }
    expect(reported[reported.length - 1]).toBe(200);
  });
});
