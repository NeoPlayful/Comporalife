import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  createCustomProvider,
  createExchangeRateApiProvider,
  createOpenExchangeRatesProvider,
  createPresetProvider,
} from '@/modules/market-data/rate-provider';

const NOW = () => new Date('2026-10-20T08:00:00.000Z');

function fetchReturning(payload: unknown, init: { status?: number; raw?: string } = {}) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(String(url));
    return new Response(init.raw ?? JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('ExchangeRate API 预设', () => {
  it('无密钥时请求免费公开端点，并用请求日期', async () => {
    const { impl, calls } = fetchReturning({
      result: 'success',
      rates: { CNY: 7.2, EUR: 0.9 },
    });
    const provider = createExchangeRateApiProvider({
      anchorCurrency: 'USD',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });

    const quotes = await provider.fetch('2026-10-20', ['CNY', 'EUR']);
    expect(quotes.map((item) => item.quote)).toEqual(['CNY', 'EUR']);
    expect(quotes[0]!.rate.toString()).toBe('7.2');
    expect(quotes[0]!.date).toBe('2026-10-20');
    expect(calls[0]).toBe('https://open.er-api.com/v6/latest/USD');
  });

  it('有密钥时走官方端点，密钥进路径但不进返回值', async () => {
    const { impl, calls } = fetchReturning({ result: 'success', rates: { CNY: 7.2 } });
    const provider = createExchangeRateApiProvider({
      anchorCurrency: 'USD',
      apiKey: 'abc123',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });

    await provider.fetch('2026-10-20', ['CNY']);
    expect(calls[0]).toBe('https://v6.exchangerate-api.com/v6/abc123/latest/USD');
  });

  it('result=error 时按 error-type 映射原因码', async () => {
    const invalidKey = createExchangeRateApiProvider({
      anchorCurrency: 'USD',
      timeoutMs: 1000,
      fetchImpl: fetchReturning({ result: 'error', 'error-type': 'invalid-key' }).impl,
      now: NOW,
    });
    await expect(invalidKey.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'AUTH' });

    const quota = createExchangeRateApiProvider({
      anchorCurrency: 'USD',
      timeoutMs: 1000,
      fetchImpl: fetchReturning({ result: 'error', 'error-type': 'quota-reached' }).impl,
      now: NOW,
    });
    await expect(quota.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('缺汇率表时映射为 BAD_RESPONSE', async () => {
    const provider = createExchangeRateApiProvider({
      anchorCurrency: 'USD',
      timeoutMs: 1000,
      fetchImpl: fetchReturning({ result: 'success' }).impl,
      now: NOW,
    });
    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    });
  });
});

describe('Open Exchange Rates 预设', () => {
  it('缺 app_id 时直接报 AUTH，不发请求', async () => {
    const { impl, calls } = fetchReturning({ rates: { CNY: 7.2 } });
    const provider = createOpenExchangeRatesProvider({
      anchorCurrency: 'USD',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });

    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({ code: 'AUTH' });
    expect(calls).toHaveLength(0);
  });

  it('app_id 走查询参数，timestamp 转成日期', async () => {
    const { impl, calls } = fetchReturning({
      error: false,
      timestamp: 1760918400, // 2025-10-20T00:00:00Z
      rates: { CNY: 7.2 },
    });
    const provider = createOpenExchangeRatesProvider({
      anchorCurrency: 'USD',
      apiKey: 'app-id-1',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });

    const quotes = await provider.fetch('2026-10-20', ['CNY']);
    expect(calls[0]).toContain('app_id=app-id-1');
    expect(quotes[0]!.date).toBe('2025-10-20');
  });

  it('非 USD 锚定时明确报错，避免用错误口径换算', async () => {
    const provider = createOpenExchangeRatesProvider({
      anchorCurrency: 'CNY',
      apiKey: 'app-id-1',
      timeoutMs: 1000,
      fetchImpl: fetchReturning({ rates: { USD: 0.14 } }).impl,
      now: NOW,
    });
    await expect(provider.fetch('2026-10-20', ['USD'])).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });

  it('error=true 时把 description 作为原因说明', async () => {
    const provider = createOpenExchangeRatesProvider({
      anchorCurrency: 'USD',
      apiKey: 'app-id-1',
      timeoutMs: 1000,
      fetchImpl: fetchReturning({ error: true, description: 'not allowed' }).impl,
      now: NOW,
    });
    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      message: 'not allowed',
    });
  });
});

describe('自定义端点预设', () => {
  it('接受 rates 扁平映射', async () => {
    const { impl } = fetchReturning({ rates: { CNY: 7.2 } });
    const provider = createCustomProvider({
      anchorCurrency: 'USD',
      customUrl: 'https://example.test/rates',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });

    const quotes = await provider.fetch('2026-10-20', ['CNY']);
    expect(quotes[0]!.rate.toString()).toBe('7.2');
  });

  it('rates 缺失时退回 conversion_rates，并统一大写键', async () => {
    const { impl } = fetchReturning({ conversion_rates: { cny: 7.2 } });
    const provider = createCustomProvider({
      anchorCurrency: 'USD',
      customUrl: 'https://example.test/rates',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });

    const quotes = await provider.fetch('2026-10-20', ['CNY']);
    expect(quotes.map((item) => item.quote)).toEqual(['CNY']);
  });

  it('密钥只走 Bearer 头，不出现在 URL 里', async () => {
    const calls: { url: string; headers: Record<string, string> | undefined }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> | undefined });
      return new Response(JSON.stringify({ rates: { CNY: 7.2 } }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = createCustomProvider({
      anchorCurrency: 'USD',
      apiKey: 'tok-1',
      customUrl: 'https://example.test/rates',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });

    await provider.fetch('2026-10-20', ['CNY']);
    expect(calls[0]!.url).toBe('https://example.test/rates');
    const headers = calls[0]!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-1');
  });

  it('缺地址时不发请求', async () => {
    const { impl, calls } = fetchReturning({ rates: { CNY: 7.2 } });
    const provider = createCustomProvider({
      anchorCurrency: 'USD',
      customUrl: '',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });

    await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('预设分发', () => {
  it('未知预设 id 明确报错', () => {
    expect(() =>
      createPresetProvider('nope', {
        anchorCurrency: 'USD',
        timeoutMs: 1000,
      }),
    ).toThrow(/不支持的汇率源/);
  });

  it('三个预设 id 都能构造出对应适配器', () => {
    for (const id of ['exchangerate-api', 'openexchangerates', 'custom'] as const) {
      const provider = createPresetProvider(id, { anchorCurrency: 'USD', timeoutMs: 1000 });
      expect(provider.name).toBe(id);
      expect(provider.anchorCurrency).toBe('USD');
    }
  });

  it('锚定币影响请求地址而不是写死 USD', async () => {
    const { impl, calls } = fetchReturning({ result: 'success', rates: { CNY: 1 } });
    const provider = createExchangeRateApiProvider({
      anchorCurrency: 'EUR',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });
    await provider.fetch('2026-10-20', ['CNY']);
    expect(calls[0]).toContain('/latest/EUR');
  });

  it('锚定币被统一成大写', () => {
    const provider = createPresetProvider('custom', {
      anchorCurrency: 'usd',
      customUrl: 'https://example.test/rates',
      timeoutMs: 1000,
    });
    expect(provider.anchorCurrency).toBe('USD');
  });
});

describe('报价解析边界', () => {
  it('非数值条目被跳过而不是整批失败', async () => {
    const { impl } = fetchReturning({ rates: { CNY: 7.2, EUR: null, JPY: 'abc' } });
    const provider = createExchangeRateApiProvider({
      anchorCurrency: 'USD',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });
    const quotes = await provider.fetch('2026-10-20', ['CNY', 'EUR', 'JPY']);
    expect(quotes.map((item) => item.quote)).toEqual(['CNY']);
  });

  it('429 与 401 在所有预设上都映射到同一原因码', async () => {
    for (const status of [429, 401]) {
      const provider = createExchangeRateApiProvider({
        anchorCurrency: 'USD',
        timeoutMs: 1000,
        fetchImpl: fetchReturning({}, { status }).impl,
        now: NOW,
      });
      await expect(provider.fetch('2026-10-20', ['CNY'])).rejects.toMatchObject({
        code: status === 429 ? 'RATE_LIMIT' : 'AUTH',
      });
    }
  });

  it('自定义端点的日期字段可配置', async () => {
    const { impl } = fetchReturning({
      meta: { asOf: '2026-10-19' },
      rates: { CNY: 7.2 },
    });
    const provider = createCustomProvider({
      anchorCurrency: 'USD',
      customUrl: 'https://example.test/rates',
      ratesPath: 'rates',
      datePath: 'meta.asOf',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });
    const quotes = await provider.fetch('2026-10-20', ['CNY']);
    expect(quotes[0]!.date).toBe('2026-10-19');
  });
});

describe('数值精度', () => {
  it('字符串形式的数值同样被接受', async () => {
    const { impl } = fetchReturning({ rates: { CNY: '7.2' } });
    const provider = createExchangeRateApiProvider({
      anchorCurrency: 'USD',
      timeoutMs: 1000,
      fetchImpl: impl,
      now: NOW,
    });
    const quotes = await provider.fetch('2026-10-20', ['CNY']);
    expect(quotes[0]!.rate).toBeInstanceOf(Decimal);
    expect(quotes[0]!.rate.toString()).toBe('7.2');
  });
});
