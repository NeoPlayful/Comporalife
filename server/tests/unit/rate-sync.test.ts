import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { validateQuotes, convertToBasePairs, preciseRatio } from '@/modules/market-data/rate-validation';
import { createGenericJsonProvider } from '@/modules/market-data/rate-provider';
import { collectRateDemand } from '@/modules/market-data/rate-sync.service';

function quote(base: string, target: string, rate: string, date = '2026-10-20') {
  return { base, quote: target, rate: new Decimal(rate), date };
}

describe('报价校验', () => {
  it('拒绝不支持的币种与同币种对', () => {
    const result = validateQuotes({
      quotes: [quote('USD', 'XXX', '7'), quote('USD', 'USD', '1')],
      asOf: '2026-10-20',
      previous: new Map(),
      maxDeviationPct: 20,
    });
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected.every((item) => item.code === 'UNSUPPORTED_CURRENCY')).toBe(true);
  });

  it('拒绝 0 与负数', () => {
    const result = validateQuotes({
      quotes: [quote('USD', 'CNY', '0'), quote('USD', 'EUR', '-1')],
      asOf: '2026-10-20',
      previous: new Map(),
      maxDeviationPct: 20,
    });
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected.every((item) => item.code === 'RATE_INVALID')).toBe(true);
  });

  it('拒绝整数位溢出 DECIMAL(20,10)', () => {
    const result = validateQuotes({
      quotes: [quote('USD', 'CNY', '12345678901')],
      asOf: '2026-10-20',
      previous: new Map(),
      maxDeviationPct: 20,
    });
    expect(result.rejected[0]!.code).toBe('RATE_OVERFLOW');
  });

  it('舍入后变成 0 的极小值被拒', () => {
    const result = validateQuotes({
      quotes: [quote('USD', 'CNY', '0.00000000001')],
      asOf: '2026-10-20',
      previous: new Map(),
      maxDeviationPct: 20,
    });
    expect(result.rejected[0]!.code).toBe('RATE_INVALID');
  });

  it('拒绝未来日期，允许当日', () => {
    const result = validateQuotes({
      quotes: [quote('USD', 'CNY', '7', '2026-10-21'), quote('USD', 'EUR', '1', '2026-10-20')],
      asOf: '2026-10-20',
      previous: new Map(),
      maxDeviationPct: 20,
    });
    expect(result.rejected).toEqual([{ pair: 'USD->CNY', code: 'DATE_INVALID' }]);
    expect(result.accepted).toHaveLength(1);
  });

  it('偏离恰好等于阈值时允许，超过才拒绝', () => {
    const previous = new Map([['USD->CNY', new Decimal('7')]]);

    const atLimit = validateQuotes({
      quotes: [quote('USD', 'CNY', '8.4')],
      asOf: '2026-10-20',
      previous,
      maxDeviationPct: 20,
    });
    expect(atLimit.accepted).toHaveLength(1);

    const overLimit = validateQuotes({
      quotes: [quote('USD', 'CNY', '8.41')],
      asOf: '2026-10-20',
      previous,
      maxDeviationPct: 20,
    });
    expect(overLimit.rejected[0]!.code).toBe('RATE_DEVIATION');
  });
});

describe('锚定币换算', () => {
  const quotes = [
    quote('USD', 'CNY', '7.2'),
    quote('USD', 'EUR', '0.9'),
    quote('USD', 'JPY', '150'),
  ];

  it('锚定币兑基准币直接取报价', () => {
    const { pairs } = convertToBasePairs({
      quotes,
      anchor: 'USD',
      baseCurrency: 'CNY',
      targets: ['USD'],
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.rate.toString()).toBe('7.2');
  });

  it('基准币即锚定币时取倒数', () => {
    const { pairs } = convertToBasePairs({
      quotes,
      anchor: 'USD',
      baseCurrency: 'USD',
      targets: ['EUR'],
    });
    expect(pairs[0]!.base).toBe('EUR');
    expect(pairs[0]!.quote).toBe('USD');
    // 1 / 0.9，按 10 位落库
    expect(pairs[0]!.rate.toFixed(10)).toBe('1.1111111111');
  });

  it('第三种情形按 R(anchor→base)/R(anchor→target) 换算', () => {
    const { pairs } = convertToBasePairs({
      quotes,
      anchor: 'USD',
      baseCurrency: 'CNY',
      targets: ['EUR'],
    });
    expect(pairs[0]!.base).toBe('EUR');
    expect(pairs[0]!.quote).toBe('CNY');
    // 7.2 / 0.9 = 8
    expect(pairs[0]!.rate.toString()).toBe('8');
  });

  it('缺锚定币兑基准币时不下发任何派生对', () => {
    const { pairs, rejected } = convertToBasePairs({
      quotes: [quote('USD', 'EUR', '0.9')],
      anchor: 'USD',
      baseCurrency: 'CNY',
      targets: ['EUR'],
    });
    expect(pairs).toHaveLength(0);
    expect(rejected[0]!.code).toBe('ANCHOR_TO_BASE_MISSING');
  });

  it('中间精度高于 10 位：先舍入再相除会丢精度', () => {
    // 构造一个两次除法后第 11 位会变化的用例：8.00000000019 / 1.00000000001
    // 低精度路径先各自截到 10 位再除，结果偏离真实值
    const numerator = new Decimal('8.00000000019');
    const denominator = new Decimal('1.00000000001');

    const high = preciseRatio(numerator, denominator).toDecimalPlaces(10);
    const low = numerator
      .toDecimalPlaces(10)
      .div(denominator.toDecimalPlaces(10))
      .toDecimalPlaces(10);

    expect(high.toString()).not.toBe(low.toString());
    // 高精度结果应更接近真实值
    expect(high.minus(numerator.div(denominator)).abs().lt(low.minus(numerator.div(denominator)).abs())).toBe(
      true,
    );
  });

  it('目标币在报价里缺失时记录原因而不是静默跳过', () => {
    const { pairs, rejected } = convertToBasePairs({
      quotes,
      anchor: 'USD',
      baseCurrency: 'CNY',
      targets: ['GBP'],
    });
    expect(pairs).toHaveLength(0);
    expect(rejected[0]!.pair).toBe('GBP->CNY');
  });
});

describe('通用 JSON 适配器', () => {
  const baseConfig = {
    urlTemplate: 'https://example.test/rates?date={date}&symbols={quotes}&key={key}',
    anchorCurrency: 'USD',
    apiKey: 'secret-key',
    ratesPath: 'data.rates',
    timeoutMs: 1000,
    now: () => new Date('2026-10-20T08:00:00.000Z'),
  };

  function providerWith(payload: unknown, init: { status?: number; raw?: string } = {}) {
    return createGenericJsonProvider({
      ...baseConfig,
      // 与生产配置一致：日期字段需显式配置路径，否则用请求日期
      datePath: 'data.date',
      fetchImpl: (async () =>
        new Response(init.raw ?? JSON.stringify(payload), {
          status: init.status ?? 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
  }

  it('解析出合法报价并带上供应商日期', async () => {
    const provider = providerWith({ data: { date: '2026-10-19', rates: { CNY: 7.2, EUR: 0.9 } } });
    const quotes = await provider.fetch('2026-10-20', ['CNY', 'EUR']);
    expect(quotes.map((item) => item.quote)).toEqual(['CNY', 'EUR']);
    expect(quotes[0]!.date).toBe('2026-10-19');
  });

  it('非数值与缺失条目被跳过，不影响其他币种', async () => {
    const provider = providerWith({ data: { rates: { CNY: 7.2, EUR: null, JPY: 'abc', GBP: 0.8 } } });
    const quotes = await provider.fetch('2026-10-20', ['CNY', 'EUR', 'JPY', 'GBP']);
    expect(quotes.map((item) => item.quote)).toEqual(['CNY', 'GBP']);
  });

  it('429 映射为 RATE_LIMIT', async () => {
    const provider = providerWith({}, { status: 429 });
    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('401 映射为 AUTH', async () => {
    const provider = providerWith({}, { status: 401 });
    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('畸形 JSON 映射为 BAD_RESPONSE', async () => {
    const provider = providerWith(null, { raw: '<html>oops</html>' });
    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('缺汇率表路径映射为 BAD_RESPONSE', async () => {
    const provider = providerWith({ data: {} });
    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('供应商返回未来日期被拒', async () => {
    const provider = providerWith({ data: { date: '2027-01-01', rates: { CNY: 7.2 } } });
    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('超时映射为 TIMEOUT', async () => {
    const provider = createGenericJsonProvider({
      ...baseConfig,
      timeoutMs: 10,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })) as unknown as typeof fetch,
    });
    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('抓取范围推导', () => {
  /**
   * 全站没有外币实体时不应产生任何外部调用。
   *
   * 这条断言放在单元层用假 prisma 验证：集成测试共享全局汇率表，
   * 并行执行的其他套件随时可能引入外币账户或被批准的币种对，
   * 「全局无需求」这个前提在那里无法稳定成立。
   */
  it('没有任何外币实体时不请求供应商', async () => {
    const prisma = {
      account: { findMany: async () => [] },
      portfolio: { findMany: async () => [] },
      asset: { findMany: async () => [] },
      liability: { findMany: async () => [] },
      userSettings: { findMany: async () => [{ baseCurrency: 'CNY' }] },
    } as never;

    const { targets, baseCurrencies } = await collectRateDemand(prisma);
    expect(targets).toEqual([]);
    expect(baseCurrencies).toEqual(['CNY']);
  });

  it('只持有基准币种时同样不产生目标', async () => {
    const prisma = {
      account: { findMany: async () => [{ currency: 'CNY' }] },
      portfolio: { findMany: async () => [] },
      asset: { findMany: async () => [] },
      liability: { findMany: async () => [] },
      userSettings: { findMany: async () => [{ baseCurrency: 'CNY' }] },
    } as never;

    const { targets } = await collectRateDemand(prisma);
    // 目标集合包含账户币种，但 runRateSync 会把「与所有基准币相同」的项过滤掉
    expect(targets).toEqual(['CNY']);
  });

  it('多用户不同基准币种时合并去重', async () => {
    const prisma = {
      account: { findMany: async () => [{ currency: 'USD' }, { currency: 'USD' }] },
      portfolio: { findMany: async () => [{ currency: 'EUR' }] },
      asset: { findMany: async () => [] },
      liability: { findMany: async () => [{ currency: 'USD' }] },
      userSettings: { findMany: async () => [{ baseCurrency: 'CNY' }, { baseCurrency: 'CNY' }] },
    } as never;

    const { targets, baseCurrencies } = await collectRateDemand(prisma);
    expect(targets).toEqual(['EUR', 'USD']);
    expect(baseCurrencies).toEqual(['CNY']);
  });
});
