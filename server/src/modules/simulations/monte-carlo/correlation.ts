export type Matrix = number[][];

export interface CorrelationValidation {
  ok: boolean;
  /** 供错误码 details.reason 使用 */
  reason?: 'dimension_mismatch' | 'not_symmetric' | 'diagonal_not_one' | 'out_of_range' | 'not_positive_definite';
  /** 未通过校验时的可读说明，仅用于日志与调试 */
  message?: string;
}

/**
 * 校验相关系数矩阵。
 * 不做任何静默修正：把用户写错的矩阵「修好」会得到一个无法解释的模拟结果，
 * 宁可拒绝，也不给出用户看不懂的数字。
 */
export function validateCorrelation(matrix: Matrix, expectedSize: number): CorrelationValidation {
  if (matrix.length !== expectedSize) {
    return { ok: false, reason: 'dimension_mismatch', message: `矩阵行数应为 ${expectedSize}` };
  }

  for (const row of matrix) {
    if (row.length !== expectedSize) {
      return { ok: false, reason: 'dimension_mismatch', message: `矩阵列数应为 ${expectedSize}` };
    }
  }

  for (let i = 0; i < expectedSize; i += 1) {
    for (let j = 0; j < expectedSize; j += 1) {
      const value = matrix[i]![j]!;

      if (!Number.isFinite(value)) {
        return { ok: false, reason: 'out_of_range', message: `相关系数必须是有限数值（第 ${i + 1} 行第 ${j + 1} 列）` };
      }

      if (value < -1 || value > 1) {
        return { ok: false, reason: 'out_of_range', message: `相关系数必须在 -1 到 1 之间（第 ${i + 1} 行第 ${j + 1} 列）` };
      }

      if (i === j && Math.abs(value - 1) > 1e-9) {
        return { ok: false, reason: 'diagonal_not_one', message: `对角线必须为 1（第 ${i + 1} 行）` };
      }

      if (i !== j && Math.abs(value - matrix[j]![i]!) > 1e-9) {
        return { ok: false, reason: 'not_symmetric', message: `矩阵必须对称（第 ${i + 1} 行第 ${j + 1} 列）` };
      }
    }
  }

  return { ok: true };
}

export interface CholeskyResult {
  ok: boolean;
  /** 下三角矩阵；失败时为 null */
  lower: Matrix | null;
  message?: string;
}

/**
 * Cholesky 分解：求下三角 L 使 L·Lᵀ = Σ。
 * 任一主元 ≤ 0 说明矩阵非正定（用户给出的相关性在数学上不可能同时成立）。
 * 分解只做一次，结果随运行快照送入引擎，不按月重复计算。
 */
export function cholesky(matrix: Matrix): CholeskyResult {
  const n = matrix.length;
  const lower: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i]![j]!;

      for (let k = 0; k < j; k += 1) {
        sum -= lower[i]![k]! * lower[j]![k]!;
      }

      if (i === j) {
        // 浮点噪声可能让理论上为 0 的主元变成极小的负数
        if (sum <= 1e-12) {
          return { ok: false, lower: null, message: '相关系数矩阵不是正定矩阵，各资产的相关性无法同时成立' };
        }
        lower[i]![i] = Math.sqrt(sum);
      } else {
        lower[i]![j] = sum / lower[j]![j]!;
      }
    }
  }

  return { ok: true, lower };
}

/** 单位矩阵，作为界面上相关矩阵编辑的起点 */
export function identityMatrix(n: number): Matrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}
