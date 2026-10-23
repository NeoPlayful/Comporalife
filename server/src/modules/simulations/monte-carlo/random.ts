/**
 * 可播种的伪随机数发生器（xoshiro128**）。
 * 不用 Math.random()：它不可播种，无法复现结果。
 * 非密码学用途，绝不可用于生成密钥、令牌或任何安全相关随机量。
 */

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Xoshiro128 {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    const state = splitmix128(seed);
    this.s0 = state[0];
    this.s1 = state[1];
    this.s2 = state[2];
    this.s3 = state[3];
  }

  /**
   * 无符号 32 位整数。
   * xoshiro128** 的输出是 rotl(s1 * 5, 7) * 9，乘法按 32 位取模（不是取高位）；
   * Math.imul 正好是 32 位模乘，与参考实现一致。
   */
  nextUint32(): number {
    const original1 = this.s1;

    const result = Math.imul(rotl(Math.imul(original1, 5) >>> 0, 7), 9) >>> 0;
    const t = (original1 << 9) >>> 0;

    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ original1) >>> 0;
    this.s1 = (original1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);

    return result;
  }

  /** 落在 (0, 1] 的开区间均匀数，避免 ln(0) */
  nextUniform(): number {
    // 加 0.5 使 0 不可能出现，且分布仍均匀
    return (this.nextUint32() + 0.5) / 4294967296;
  }
}

/** splitmix32：把一个种子扩散成 32 位整数 */
export function splitmix32(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/** 用 splitmix32 迭代四次得到 128 位初始状态 */
export function splitmix128(seed: number): [number, number, number, number] {
  let state = seed >>> 0;
  const out: [number, number, number, number] = [0, 0, 0, 0];

  for (let i = 0; i < 4; i += 1) {
    state = splitmix32(state);
    out[i] = state;
  }

  // 全零状态会让 xoshiro 恒为 0，退化成一个永远输出 0 的坏发生器
  if ((out[0] | out[1] | out[2] | out[3]) === 0) out[0] = 1;

  return out;
}

/**
 * 每条路径独立派生随机流。
 * 路径之间互不依赖，因此可以只重算第 k 条路径——
 * 这是「不落库全量路径、按索引再生成」能够成立的前提。
 */
export function pathSeed(seed: number, pathIndex: number): number {
  return splitmix32((seed ^ Math.imul(pathIndex, 0x9e3779b1)) >>> 0);
}

/**
 * 标准正态抽样（Box–Muller）。
 * 每次调用消耗两个均匀数生成一个正态值，不做跨调用缓存：
 * 缓存会让相邻调用产生隐式依赖，破坏「单条路径可独立重算」的性质。
 */
export class NormalSampler {
  private readonly rng: Xoshiro128;

  constructor(rng: Xoshiro128) {
    this.rng = rng;
  }

  next(): number {
    let u1 = this.rng.nextUniform();
    let u2 = this.rng.nextUniform();

    // u1 已在 (0,1]，这里防御性处理浮点下溢
    if (u1 <= 0) u1 = Number.MIN_VALUE;
    if (u2 <= 0) u2 = Number.MIN_VALUE;

    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
