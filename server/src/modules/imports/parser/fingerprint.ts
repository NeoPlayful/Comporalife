import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { localDateKey } from './date.js';

/**
 * 指纹用于识别「同一笔交易被重复导入」。
 * 有外部流水号时不纳入描述，避免银行改写摘要造成漏判。
 */

export interface FingerprintInput {
  userId: string;
  accountId: string;
  occurredAt: Date;
  timezone: string;
  amount: Decimal;
  currency: string;
  externalId?: string | null;
  description?: string | null;
  balanceAfter?: Decimal | null;
}

/** 尾部形如 -1234 / _8888 的流水后缀在无外部号时补充进描述，降低误判 */
const TRAILING_SERIAL = /[-_\s]\d{3,}$/;

export function normalizeDescription(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .trim()
    .replace(TRAILING_SERIAL, '')
    .trim();
}

export function buildFingerprint(input: FingerprintInput): string {
  const dateKey = localDateKey(input.occurredAt, input.timezone);
  const externalId = normalizeDescription(input.externalId ?? '');

  const parts = [
    input.userId,
    input.accountId,
    dateKey,
    input.amount.toFixed(6),
    input.currency,
    externalId.length > 0 ? externalId : normalizeDescription(input.description),
  ];

  // 无外部流水号时，账单余额是区分「同额同日不同笔」的强信号
  if (externalId.length === 0 && input.balanceAfter && !input.balanceAfter.isZero()) {
    parts.push(input.balanceAfter.toFixed(6));
  }

  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

/** 表头签名：按顺序 join 后哈希，用于模板自动推荐 */
export function buildHeaderSignature(headers: string[]): string {
  const normalized = headers.map((header) => normalizeDescription(header));
  return createHash('sha256').update(normalized.join('|'), 'utf8').digest('hex');
}
