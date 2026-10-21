import Decimal from 'decimal.js';
import { roundMoney } from '../../../lib/money.js';

/**
 * 金额解析：所有结果走 Decimal，绝不经过 Number()。
 * 支持货币符号、千分位、括号负数、首尾负号与 Unicode 减号。
 */

export type AmountError =
  | 'AMOUNT_INVALID'
  | 'AMOUNT_PRECISION_INVALID'
  | 'AMOUNT_CONFLICT'
  | 'AMOUNT_ZERO_INVALID';

export interface AmountParseResult {
  value: Decimal | null;
  error?: AmountError;
}

const CURRENCY_PATTERN = /[¥￥$€£]|\b(CNY|RMB|USD|EUR|GBP|JPY|HKD)\b/gi;
const SPACE_PATTERN = /[\s 　]/g;
/** 各种减号与破折号归一为 ASCII '-' */
const MINUS_PATTERN = /[−–—﹣－]/g;
const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;

/** 最多 6 位小数，与 DECIMAL(20,6) 对齐 */
const MAX_DECIMALS = 6;

export function parseAmount(input: string | null | undefined): AmountParseResult {
  if (input === null || input === undefined) return { value: null, error: 'AMOUNT_INVALID' };

  // 先剥离币种代码（此时仍有空白，\b 边界有效），再压缩空白与货币符号
  let text = input
    .replace(MINUS_PATTERN, '-')
    .replace(CURRENCY_PATTERN, '')
    .replace(SPACE_PATTERN, '');
  if (text.length === 0) return { value: null, error: 'AMOUNT_INVALID' };

  let negative = false;

  // 会计写法：(123.45) 表示负数
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }

  // 尾部负号 123.45- ；部分银行用尾随 '-' 表示支出
  if (text.endsWith('-')) {
    negative = !negative;
    text = text.slice(0, -1);
  }

  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  }

  text = text.replace(/,/g, '');

  if (!NUMERIC_PATTERN.test(text) && !NUMERIC_PATTERN.test(`-${text}`)) {
    return { value: null, error: 'AMOUNT_INVALID' };
  }

  const decimals = text.includes('.') ? text.split('.')[1]!.length : 0;
  if (decimals > MAX_DECIMALS) return { value: null, error: 'AMOUNT_PRECISION_INVALID' };

  const value = new Decimal(text).negated().abs();
  return { value: negative ? value.negated() : value };
}

export interface DebitCreditResult {
  value: Decimal | null;
  error?: AmountError;
}

/**
 * 借贷双列模式：amount = credit - debit。
 * 两列都有非零值视为冲突，避免同一行被重复计入。
 */
export function parseDebitCredit(debit: string | null | undefined, credit: string | null | undefined): DebitCreditResult {
  const debitValue = parseAmount(debit);
  const creditValue = parseAmount(credit);

  const hasDebit = debitValue.value !== null && !debitValue.value.isZero();
  const hasCredit = creditValue.value !== null && !creditValue.value.isZero();

  if (hasDebit && hasCredit) return { value: null, error: 'AMOUNT_CONFLICT' };

  // 借贷列里的负号是银行的展示惯例，方向由列名决定，统一取绝对值
  const magnitude = hasDebit ? debitValue.value!.abs() : hasCredit ? creditValue.value!.abs() : null;

  if (magnitude === null) {
    // 两列都为空，或其中一列格式非法
    const error = debitValue.error ?? creditValue.error ?? 'AMOUNT_INVALID';
    return { value: null, error };
  }

  return { value: hasDebit ? magnitude.negated() : magnitude };
}

/** 金额入账前的最终校验：非零、精度、范围 */
export function validateAmount(value: Decimal | null, error?: AmountError): { value: Decimal; error?: undefined } | { value: null; error: AmountError } {
  if (error) return { value: null, error };
  if (value === null) return { value: null, error: 'AMOUNT_INVALID' };
  if (value.isZero()) return { value: null, error: 'AMOUNT_ZERO_INVALID' };

  // DECIMAL(20,6) 整数位最多 14 位
  if (value.abs().gte(new Decimal('1e14'))) return { value: null, error: 'AMOUNT_INVALID' };

  return { value: roundMoney(value) };
}
