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

export function pickPath(input: unknown, path: string): unknown {
  let cursor: unknown = input;
  for (const segment of path.split('.').filter(Boolean)) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * 发一次 GET 并解析 JSON。
 *
 * 所有预设共用这一段，保证超时、响应上限、状态码映射的口径一致：
 * 三个预设各写一份很容易在某个分支上悄悄漂移（比如一个映射 429、另一个不映射）。
 * redirect 一律拒绝：跟随跳转等于允许对方把请求带到一个未校验的地址。
 */
export async function requestJson(
  url: string,
  options: {
    timeoutMs: number;
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
  },
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json', ...options.headers },
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

  try {
    return JSON.parse(raw);
  } catch {
    throw new RateProviderError('BAD_RESPONSE', '汇率源响应不是合法 JSON');
  }
}

/**
 * 把一张「币种 → 数值」的映射转成报价数组。
 *
 * 单条非数值直接跳过：一个坏值不该让整批都拿不到汇率。
 */
export function quotesFromRateMap(params: {
  table: Record<string, unknown>;
  anchor: string;
  wanted: string[];
  date: string;
}): RateQuote[] {
  const out: RateQuote[] = [];
  for (const code of params.wanted) {
    const value = params.table[code];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.push({ base: params.anchor, quote: code, rate: new Decimal(value), date: params.date });
    } else if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
      out.push({ base: params.anchor, quote: code, rate: new Decimal(value), date: params.date });
    }
  }
  return out;
}

/** 供应商给出的日期，形状不对或来自未来都退回请求日期 */
export function normalizeQuoteDate(raw: unknown, asOf: string, now: Date): string {
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : asOf;
  if (date > todayKey(now)) {
    throw new RateProviderError('BAD_RESPONSE', '汇率源返回了未来日期');
  }
  return date;
}

/**
 * 通用 JSON 适配器。
 *
 * 只做「取一个数值」或「取一个映射」，不支持条件判断、单位换算与多级回退：
 * 需要这些的供应商应当单独实现一个适配器，而不是把配置做成半个脚本。
 */
export function createGenericJsonProvider(config: GenericJsonProviderConfig): RateProvider {
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
        .replace('{key}', encodeURIComponent(config.apiKey ?? ''))
        .replace('{anchor}', encodeURIComponent(config.anchorCurrency.toUpperCase()));

      // 未使用 {key} 占位符时，按参数名注入；两者都没有则视为无需密钥
      const target = new URL(url);
      if (!config.urlTemplate.includes('{key}') && config.apiKey && config.keyParam) {
        target.searchParams.set(config.keyParam, config.apiKey);
      }

      const payload = await requestJson(target.toString(), {
        timeoutMs: config.timeoutMs,
        fetchImpl: config.fetchImpl,
      });

      const table = pickPath(payload, config.ratesPath);
      if (table === null || typeof table !== 'object' || Array.isArray(table)) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应缺少汇率表');
      }

      const rawDate = config.datePath ? pickPath(payload, config.datePath) : undefined;
      const date = normalizeQuoteDate(rawDate, asOf, now());

      return quotesFromRateMap({
        table: table as Record<string, unknown>,
        anchor: config.anchorCurrency.toUpperCase(),
        wanted,
        date,
      });
    },
  };
}

export function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ===== 预设供应商 =====

/** exchangeRate API 的免费公开端点：无需密钥、USD 锚定、覆盖主要币种 */
const EXCHANGERATE_API_FREE = 'https://open.er-api.com/v6/latest';
/** 官方端点：密钥在 URL 路径里，额度高于免费端点 */
const EXCHANGERATE_API_KEYED = 'https://v6.exchangerate-api.com/v6';

const OPEN_EXCHANGE_RATES_API = 'https://openexchangerates.org/api/latest.json';

export interface PresetProviderOptions {
  anchorCurrency: string;
  apiKey?: string;
  /** 仅 custom 使用 */
  customUrl?: string;
  ratesPath?: string;
  datePath?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/**
 * ExchangeRate API。
 *
 * 有密钥走官方 v6 端点（密钥作为路径段），没有就走免费公开端点。
 * 免费端点的 `time_last_update_utc` 是完整英文时间串，不解析它：
 * 用请求日期即可，供应商口径的滞后由同步记录的 startedAt 体现。
 * 该端点用 `result: "error"` + `error-type` 表达失败，需要单独识别。
 */
export function createExchangeRateApiProvider(options: PresetProviderOptions): RateProvider {
  const now = options.now ?? (() => new Date());
  const anchor = options.anchorCurrency.toUpperCase();
  const apiKey = options.apiKey?.trim() ?? '';

  return {
    name: 'exchangerate-api',
    anchorCurrency: anchor,

    async fetch(asOf, quotes) {
      const wanted = quotes.map((item) => item.toUpperCase());
      if (wanted.length === 0) return [];

      const url = apiKey
        ? `${EXCHANGERATE_API_KEYED}/${encodeURIComponent(apiKey)}/latest/${encodeURIComponent(anchor)}`
        : `${EXCHANGERATE_API_FREE}/${encodeURIComponent(anchor)}`;

      const payload = await requestJson(url, {
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });

      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应结构不正确');
      }

      const body = payload as Record<string, unknown>;
      if (body.result === 'error') {
        const type = typeof body['error-type'] === 'string' ? body['error-type'] : '';
        if (type === 'invalid-key' || type === 'inactive-account') {
          throw new RateProviderError('AUTH', '汇率源密钥无效');
        }
        if (type === 'quota-reached') {
          throw new RateProviderError('RATE_LIMIT', '汇率源请求配额已用尽');
        }
        throw new RateProviderError('PROVIDER_ERROR', '汇率源返回错误');
      }

      const table = pickPath(body, 'rates');
      if (table === null || typeof table !== 'object' || Array.isArray(table)) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应缺少汇率表');
      }

      // 这个供应商不给日期字段，用请求日期
      const date = normalizeQuoteDate(undefined, asOf, now());

      return quotesFromRateMap({
        table: table as Record<string, unknown>,
        anchor,
        wanted,
        date,
      });
    },
  };
}

/**
 * Open Exchange Rates。
 *
 * 免费档必须是 USD 锚定，且 app_id 走查询参数；缺 app_id 直接报错，
 * 不发出一次注定失败的请求。失败除了非 2xx 之外还可能以
 * `{ error: true, description }` 的形式返回。
 */
export function createOpenExchangeRatesProvider(options: PresetProviderOptions): RateProvider {
  const now = options.now ?? (() => new Date());
  const anchor = options.anchorCurrency.toUpperCase();
  const apiKey = options.apiKey?.trim() ?? '';

  return {
    name: 'openexchangerates',
    anchorCurrency: anchor,

    async fetch(asOf, quotes) {
      const wanted = quotes.map((item) => item.toUpperCase());
      if (wanted.length === 0) return [];
      if (apiKey.length === 0) {
        throw new RateProviderError('AUTH', '请先配置 Open Exchange Rates 的 app_id');
      }

      const target = new URL(OPEN_EXCHANGE_RATES_API);
      target.searchParams.set('app_id', apiKey);

      const payload = await requestJson(target.toString(), {
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });

      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应结构不正确');
      }

      const body = payload as Record<string, unknown>;
      if (body.error === true) {
        const description =
          typeof body.description === 'string'
            ? body.description
            : typeof body.message === 'string'
              ? body.message
              : '汇率源返回错误';
        throw new RateProviderError('PROVIDER_ERROR', description.slice(0, 200));
      }

      const table = pickPath(body, 'rates');
      if (table === null || typeof table !== 'object' || Array.isArray(table)) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应缺少汇率表');
      }

      // 免费档固定 USD 锚定；请求别的锚定币会得到错误的换算结果
      if (anchor !== 'USD') {
        throw new RateProviderError(
          'PROVIDER_ERROR',
          'Open Exchange Rates 免费档只提供 USD 锚定的报价，请把锚定币设为 USD',
        );
      }

      // timestamp 是秒级 Unix 时间，转成 UTC 日期
      const rawTimestamp = body.timestamp;
      const date =
        typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)
          ? normalizeQuoteDate(
              new Date(rawTimestamp * 1000).toISOString().slice(0, 10),
              asOf,
              now(),
            )
          : normalizeQuoteDate(undefined, asOf, now());

      return quotesFromRateMap({
        table: table as Record<string, unknown>,
        anchor,
        wanted,
        date,
      });
    },
  };
}

/**
 * 自定义 JSON 端点。
 *
 * 接受 `rates`（Open Exchange Rates / Fixer 风格）或
 * `conversion_rates`（ExchangeRate API 风格）两种扁平映射，
 * 也接受管理员指定的点号路径。密钥以 Bearer 头发送，绝不放进 URL——
 * URL 会进代理与访问日志。
 */
export function createCustomProvider(options: PresetProviderOptions): RateProvider {
  const now = options.now ?? (() => new Date());
  const anchor = options.anchorCurrency.toUpperCase();
  const apiKey = options.apiKey?.trim() ?? '';
  const url = options.customUrl?.trim() ?? '';

  return {
    name: 'custom',
    anchorCurrency: anchor,

    async fetch(asOf, quotes) {
      const wanted = quotes.map((item) => item.toUpperCase());
      if (wanted.length === 0) return [];
      if (url.length === 0) {
        throw new RateProviderError('PROVIDER_ERROR', '请先配置自定义 API 地址');
      }

      const payload = await requestJson(url, {
        timeoutMs: options.timeoutMs,
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
        fetchImpl: options.fetchImpl,
      });

      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应结构不正确');
      }

      const body = payload as Record<string, unknown>;
      if (body.error === true) {
        const message =
          typeof body.description === 'string'
            ? body.description
            : typeof body.message === 'string'
              ? body.message
              : '汇率源返回错误';
        throw new RateProviderError('PROVIDER_ERROR', message.slice(0, 200));
      }
      if (typeof body.result === 'string' && body.result !== 'success') {
        throw new RateProviderError('PROVIDER_ERROR', '汇率源返回错误');
      }

      const table = pickPath(body, options.ratesPath || 'rates');
      const fallbackTable =
        table === null || typeof table !== 'object' || Array.isArray(table)
          ? pickPath(body, 'conversion_rates')
          : table;
      if (fallbackTable === null || typeof fallbackTable !== 'object' || Array.isArray(fallbackTable)) {
        throw new RateProviderError('BAD_RESPONSE', '汇率源响应缺少汇率表');
      }

      // 部分实现把日期放在顶层 date 字段，没给就用请求日期
      const date = normalizeQuoteDate(
        options.datePath ? pickPath(body, options.datePath) : body.date,
        asOf,
        now(),
      );

      // 自定义端点的币种键可能大小写不一致，统一按大写匹配
      const normalized: Record<string, unknown> = {};
      for (const [code, value] of Object.entries(fallbackTable as Record<string, unknown>)) {
        normalized[code.trim().toUpperCase()] = value;
      }

      return quotesFromRateMap({ table: normalized, anchor, wanted, date });
    },
  };
}

/** 预设 id → 适配器。未知 id 视为配置被改坏，明确报错而不是静默回退 */
export function createPresetProvider(
  provider: string,
  options: PresetProviderOptions,
): RateProvider {
  switch (provider) {
    case 'exchangerate-api':
      return createExchangeRateApiProvider(options);
    case 'openexchangerates':
      return createOpenExchangeRatesProvider(options);
    case 'custom':
      return createCustomProvider(options);
    default:
      throw new RateProviderError('PROVIDER_ERROR', `不支持的汇率源：${provider}`);
  }
}
