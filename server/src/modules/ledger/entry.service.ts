import Decimal from 'decimal.js';
import { errors } from '../../lib/errors.js';
import { roundMoney, toDecimal } from '../../lib/money.js';

export type TransactionType = 'income' | 'expense' | 'transfer' | 'adjustment' | 'investment';

export interface EntryDraft {
  accountId: string | null;
  amount: Decimal;
  currency: string;
}

export interface BuildEntriesInput {
  type: TransactionType;
  magnitude: Decimal;
  accountId: string;
  toAccountId?: string;
  currency: string;
  toCurrency?: string;
  /** 仅 investment：买入时现金流出，卖出时现金流入 */
  cashDirection?: 'in' | 'out';
}

/**
 * 复式分录生成规则：
 * - 收入/支出/调整：一条真实账户腿 + 一条外部腿（accountId = null）
 * - 转账：两条真实账户腿，账户不同、币种相同
 * 外部腿代表收入来源或支出用途，使每笔交易在数学上保持借贷平衡。
 */
export function buildEntries(input: BuildEntriesInput): EntryDraft[] {
  const magnitude = roundMoney(input.magnitude);

  if (magnitude.lte(0)) {
    throw errors.validation('金额必须大于 0');
  }

  if (input.type === 'transfer') {
    if (!input.toAccountId) {
      throw errors.validation('转账必须指定转入账户');
    }
    if (input.toAccountId === input.accountId) {
      throw errors.validation('转出与转入账户不能相同');
    }
    if (input.toCurrency && input.toCurrency !== input.currency) {
      throw errors.crossCurrencyTransfer();
    }

    return [
      { accountId: input.accountId, amount: magnitude.negated(), currency: input.currency },
      { accountId: input.toAccountId, amount: magnitude, currency: input.currency },
    ];
  }

  // 收入使账户增加，支出与负向调整使账户减少；
  // 买入/卖出是资产转换，方向由调用方显式给出，不按交易类型推断
  const accountSign =
    input.type === 'income' || (input.type === 'investment' && input.cashDirection === 'in') ? 1 : -1;

  return [
    { accountId: input.accountId, amount: magnitude.mul(accountSign), currency: input.currency },
    { accountId: null, amount: magnitude.mul(accountSign).negated(), currency: input.currency },
  ];
}

/** 写入前校验：至少两条、求和为零、转账腿数与外部腿位置正确 */
export function assertBalanced(entries: EntryDraft[], type: TransactionType): void {
  if (entries.length < 2) {
    throw errors.ledgerUnbalanced('交易至少需要两条分录');
  }

  for (const entry of entries) {
    if (!entry.amount.isFinite()) {
      throw errors.ledgerUnbalanced('分录金额不合法');
    }
  }

  // 跨币种转账在 Phase 1 已被禁止，因此所有分录同币种，整体求和即为平衡校验
  const total = entries.reduce<Decimal>((acc, entry) => acc.plus(entry.amount), new Decimal(0));
  if (!roundMoney(total).isZero()) {
    throw errors.ledgerUnbalanced(`分录不平，合计 ${roundMoney(total).toString()}`);
  }

  if (type === 'transfer') {
    const realLegs = entries.filter((entry) => entry.accountId !== null);
    if (realLegs.length !== 2 || entries.length !== 2) {
      throw errors.ledgerUnbalanced('转账必须恰好包含两条账户分录');
    }
    const [first, second] = realLegs;
    if (first!.currency !== second!.currency) {
      throw errors.crossCurrencyTransfer();
    }
    if (first!.amount.plus(second!.amount).abs().gt(0)) {
      throw errors.ledgerUnbalanced('转账两侧金额必须相等');
    }
    return;
  }

  const realLegs = entries.filter((entry) => entry.accountId !== null);
  const externalLegs = entries.filter((entry) => entry.accountId === null);

  if (realLegs.length !== 1 || externalLegs.length !== 1) {
    throw errors.ledgerUnbalanced('交易必须有且仅有一条账户分录与一条外部分录');
  }
}


/** 校验用户输入的是金额绝对值：方向由交易类型决定，不接受负数 */
export function magnitudeFromInput(amount: string | number): Decimal {
  const value = toDecimal(amount);
  if (value.lte(0)) {
    throw errors.validation('金额必须为正数，方向由交易类型决定');
  }
  return roundMoney(value);
}
