import Decimal from 'decimal.js';

export interface RateQuote {
  /** 供应商的锚定币，例如 USD */
  base: string;
  /** 目标币 */
  quote: string;
  /** 1 base = rate quote */
  rate: Decimal;
  /** yyyy-MM-dd，供应商口径的生效日 */
  date: string;
}

export type RateProviderErrorCode =
  | 'TIMEOUT'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'BAD_RESPONSE'
  | 'NETWORK'
  | 'PROVIDER_ERROR';

/** 供应商层失败：只携带原因码与脱敏后的短说明，绝不包含 URL 与密钥 */
export class RateProviderError extends Error {
  constructor(
    readonly code: RateProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RateProviderError';
  }
}

export interface RateProvider {
  readonly name: string;
  readonly anchorCurrency: string;
  /** asOf 是请求日期；实现不得返回晚于它的日期 */
  fetch(asOf: string, quotes: string[]): Promise<RateQuote[]>;
}

export interface GenericJsonProviderConfig {
  urlTemplate: string;
  anchorCurrency: string;
  apiKey?: string;
  keyParam?: string;
  ratesPath: string;
  datePath?: string;
  timeoutMs: number;
  /** 便于测试注入；默认使用全局 fetch */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** 响应体上限：外部服务返回异常大文件时立即放弃，避免把内存打满 */
const MAX_RESPONSE_BYTES = 1024 * 1024;

function pickPath(input: unknown, path: string): unknown {
  let cursor: unknown = input;
  for (const segment of path.split('.').filter(Boolean)) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * 通用 JSON 适配器。
 *
 * 只做「取一个数值」或「取一个映射」，不支持条件判断、单位换算与多级回退：
 * 需要这些的供应商应当单独实现一个适配器，而不是把配置做成半个脚本。
 */
export function createGenericJsonProvider(config: GenericJsonProviderConfig): RateProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());

  return {
    name: 'generic-json',
    anchorCurrency: config.anchorCurrency.toUpperCase(),

    async fetch(asOf, quotes) {
      const wanted = quotes.map((item) => item.toUpperCase());
      if (wanted.length === 0) return [];

      const url = config.urlTemplate
        .replace('{date}', encodeURIComponent(asOf))
        .replace('{quotes}', encodeURIComponent(wanted.join(',')))
        .replace('{key}', encodeURIComponent(config.apiKey ?? ''));

      // 未使用 {key} 占位符时，按参数名注入；两者都没有则视为无需密钥
      const target = new URL(url);
      if (!config.urlTemplate.includes('{key}') && config.apiKey && config.keyParam) {
        target.searchParams.set(config.keyParam, config.apiKey);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      let response: Response;
      try {
        response = await doFetch(target.toString(), {
          method: 'GET',
          signal: controller.signal,
          headers: { accept: 'application/json' },
          redirect: 'error',
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new RateProviderError('TIMEOUT', '汇率源请求超时');
        }
        throw new RateProviderError('NETWORK', '汇率源连接失败');
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401 || response.status === 403) {
        throw new RateProviderError('AUTH', '汇率源鉴权失败');
      }
      if (response.status === 429) {
        throw new RateProviderError('RATE_LIMIT', '汇率源限流');
      }
      if (!response.ok) {
        throw new RateProviderError('PROVIDER_ERROR', `汇率源返回 ${response.status}`);
      }

      const raw = await response.text();
      if (raw.length > MAX_RESPONSE_BYTES) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应过大');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应不是合法 JSON');
      }

      const table = pickPath(payload, config.ratesPath);
      if (table === null || typeof table !== 'object' || Array.isArray(table)) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应缺少汇率表');
      }

      const rawDate = config.datePath ? pickPath(payload, config.datePath) : undefined;
      const date = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : asOf;

      // 供应商给未来日期说明口径或时钟异常，一律不使用
      if (date > todayKey(now())) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源返回了未来日期');
      }

      const quotesOut: RateQuote[] = [];
      for (const code of wanted) {
        const value = (table as Record<string, unknown>)[code];
        // 非数值条目直接跳过：单条异常不应拖垮整批
        if (typeof value === 'number' && Number.isFinite(value)) {
          quotesOut.push({
            base: config.anchorCurrency.toUpperCase(),
            quote: code,
            rate: new Decimal(value),
            date,
          });
        } else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
          quotesOut.push({
            base: config.anchorCurrency.toUpperCase(),
            quote: code,
            rate: new Decimal(value),
            date,
          });
        }
      }

      return quotesOut;
    },
  };
}

export function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}
