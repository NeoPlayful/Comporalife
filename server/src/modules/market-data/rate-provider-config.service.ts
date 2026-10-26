import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_RATE_PROVIDER,
  isRateProviderId,
  RATE_PROVIDER_KEY_PURPOSE,
  SETTING_RATE_PROVIDER,
  SUPPORTED_CURRENCIES,
  type RateProviderId,
} from '../../config/constants.js';
import { env } from '../../config/env.js';
import { keyHint, openSecret, sealSecret } from '../../lib/secret-cipher.js';

/**
 * 汇率源配置的读写。
 *
 * 存储形态：system_settings 一行、JSON 值，密钥字段单独加密。
 * 读取时数据库优先，没有这一行就回退到环境变量——已经用环境变量跑起来的
 * 部署不该因为这次改动突然停掉同步。
 *
 * 这一层对外只暴露「已解析的配置」与「脱敏的回显视图」，调用方拿不到密文，
 * 也不会不小心把它塞进响应或日志。
 */

export interface RateProviderConfig {
  provider: RateProviderId;
  /** 供应商报价锚定币，例如 USD */
  anchorCurrency: string;
  /** 已解密的密钥；空串表示不需要或不提供 */
  apiKey: string;
  /** 仅 custom 使用：完整请求地址 */
  customUrl: string;
  /** 仅 custom 使用：响应中汇率表所在的点号路径 */
  ratesPath: string;
  /** 仅 custom 使用：响应中日期字段路径，空表示用请求日期 */
  datePath: string;
}

/** 接口回显：绝不包含密钥明文或密文 */
export interface RateProviderView {
  provider: RateProviderId;
  anchorCurrency: string;
  /** 是否已配置密钥 */
  keyConfigured: boolean;
  /** 末四位提示；未配置时为空串 */
  keyHint: string;
  customUrl: string;
  ratesPath: string;
  datePath: string;
  /** 配置来自数据库还是部署环境（回退） */
  source: 'database' | 'environment';
}

interface StoredProvider {
  provider?: unknown;
  anchorCurrency?: unknown;
  /** 密文 */
  apiKeySealed?: unknown;
  customUrl?: unknown;
  ratesPath?: unknown;
  datePath?: unknown;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function anchorOf(value: unknown): string {
  const raw = asString(value).toUpperCase();
  return raw.length === 3 ? raw : 'USD';
}

/**
 * 环境变量回退。
 *
 * provider 标成 custom 只是为了让「有没有可用地址」的判定复用同一套规则；
 * 真正构造适配器时按来源分流，环境变量走的仍是通用 JSON 模板适配器。
 */
function fromEnvironment(): RateProviderConfig | null {
  if (!env.RATE_PROVIDER_URL) return null;
  return {
    provider: 'custom',
    anchorCurrency: anchorOf(env.RATE_PROVIDER_ANCHOR),
    apiKey: env.RATE_PROVIDER_KEY ?? '',
    customUrl: env.RATE_PROVIDER_URL,
    ratesPath: env.RATE_PROVIDER_RATES_PATH || 'rates',
    datePath: env.RATE_PROVIDER_DATE_PATH ?? '',
  };
}

function fromStored(stored: StoredProvider): RateProviderConfig {
  const provider = isRateProviderId(stored.provider) ? stored.provider : DEFAULT_RATE_PROVIDER;
  const sealed = asString(stored.apiKeySealed);
  return {
    provider,
    anchorCurrency: anchorOf(stored.anchorCurrency),
    // 解不开就当没有密钥：换过加密密钥或密文被改过时，同步应表现为「缺密钥」
    apiKey: sealed ? (openSecret(sealed, RATE_PROVIDER_KEY_PURPOSE) ?? '') : '',
    customUrl: asString(stored.customUrl),
    ratesPath: asString(stored.ratesPath) || 'rates',
    datePath: asString(stored.datePath),
  };
}

/** 数据库里是否有一行配置（用来区分「读到了空配置」与「没有配置」） */
async function loadStored(prisma: PrismaClient): Promise<StoredProvider | null> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTING_RATE_PROVIDER },
    select: { value: true },
  });
  if (!row || row.value === null || typeof row.value !== 'object' || Array.isArray(row.value)) {
    return null;
  }
  return row.value as StoredProvider;
}

/**
 * 解析当前生效的配置。
 *
 * 数据库里有这一行就以它为准（哪怕字段是空的），因为「管理员清空了自定义地址」
 * 是一个明确决定，不该再悄悄回退到环境变量里的旧值。
 */
export async function getRateProviderConfig(
  prisma: PrismaClient,
): Promise<{ config: RateProviderConfig; source: 'database' | 'environment' } | null> {
  const stored = await loadStored(prisma);
  if (stored) return { config: fromStored(stored), source: 'database' };

  const fallback = fromEnvironment();
  return fallback ? { config: fallback, source: 'environment' } : null;
}

/** 是否构成「可用的供应商」：有地址，且该预设要求的密钥不为空 */
export function isProviderUsable(config: RateProviderConfig): boolean {
  if (config.provider === 'custom' && config.customUrl.length === 0) return false;
  if (config.provider === 'openexchangerates' && config.apiKey.length === 0) return false;
  return true;
}

export async function isRateProviderAvailable(prisma: PrismaClient): Promise<boolean> {
  const resolved = await getRateProviderConfig(prisma);
  return resolved !== null && isProviderUsable(resolved.config);
}

/** 脱敏回显：密钥只给末四位 */
export async function getRateProviderView(prisma: PrismaClient): Promise<RateProviderView> {
  const resolved = await getRateProviderConfig(prisma);
  if (!resolved) {
    return {
      provider: DEFAULT_RATE_PROVIDER,
      anchorCurrency: 'USD',
      keyConfigured: false,
      keyHint: '',
      customUrl: '',
      ratesPath: 'rates',
      datePath: '',
      source: 'environment',
    };
  }

  const { config, source } = resolved;
  return {
    provider: config.provider,
    anchorCurrency: config.anchorCurrency,
    keyConfigured: config.apiKey.length > 0,
    keyHint: keyHint(config.apiKey),
    customUrl: config.customUrl,
    ratesPath: config.ratesPath,
    datePath: config.datePath,
    source,
  };
}

export interface SaveRateProviderInput {
  provider: RateProviderId;
  anchorCurrency: string;
  customUrl?: string;
  ratesPath?: string;
  datePath?: string;
  /**
   * 密钥的处理是三态：
   * - 省略：保持现有密钥不变（管理员只改数据源时不至于把密钥清掉）
   * - 空串：显式清除
   * - 非空：覆盖
   */
  apiKey?: string;
}

export async function saveRateProviderConfig(
  prisma: PrismaClient,
  input: SaveRateProviderInput,
  /** null = 系统写入（seed / 测试 / 部署脚本），与定时任务的 updatedBy 口径一致 */
  updatedBy: string | null,
): Promise<RateProviderView> {
  const existing = await loadStored(prisma);
  const currentSealed = existing ? asString(existing.apiKeySealed) : '';

  let sealed = currentSealed;
  if (input.apiKey !== undefined) {
    const trimmed = input.apiKey.trim();
    sealed = trimmed.length === 0 ? '' : sealSecret(trimmed, RATE_PROVIDER_KEY_PURPOSE);
  }

  const anchor = input.anchorCurrency.toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(anchor)) {
    // 校验放在 schema 层，这里是最后一道防线：锚定币不在支持列表里，
    // 换算会因为「锚定币报价缺失」而把所有币种对都拒掉。
    throw new Error(`不支持的锚定币种：${anchor}`);
  }

  const value: StoredProvider = {
    provider: input.provider,
    anchorCurrency: anchor,
    apiKeySealed: sealed,
    customUrl: input.customUrl?.trim() ?? '',
    ratesPath: input.ratesPath?.trim() || 'rates',
    datePath: input.datePath?.trim() ?? '',
  };

  await prisma.systemSetting.upsert({
    where: { key: SETTING_RATE_PROVIDER },
    create: { key: SETTING_RATE_PROVIDER, value: value as never, updatedBy },
    update: { value: value as never, updatedBy },
  });

  return getRateProviderView(prisma);
}
