import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { LIABILITY_ACCOUNT_TYPES } from '../../config/constants.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import { convertMany } from '../currencies/currency.service.js';
import { computeBalances } from '../accounts/balance.service.js';

export interface NetWorthResult {
  totalAssets: Decimal;
  totalLiabilities: Decimal;
  netWorth: Decimal;
  baseCurrency: string;
  asOf: Date;
  missingPairs: string[];
  rateDates: string[];
  excludedAccounts: Array<{ id: string; name: string; currency: string; reason: string }>;
}

const LIABILITY_TYPES = new Set<string>(LIABILITY_ACCOUNT_TYPES);

/**
 * 净资产 = 资产（非信用卡/贷款账户）− 负债（信用卡/贷款账户余额绝对值）。
 * 余额为负的资产账户按负值计入资产，不自动转成负债，避免口径漂移。
 */
export async function computeNetWorth(
  prisma: PrismaClient,
  params: { userId: string; baseCurrency: string; asOf: Date },
): Promise<NetWorthResult> {
  const accounts = await prisma.account.findMany({
    where: { userId: params.userId, status: 'active' },
    select: { id: true, name: true, type: true, currency: true },
  });

  const balances = await computeBalances(prisma, {
    userId: params.userId,
    accountIds: accounts.map((a) => a.id),
    asOf: params.asOf,
  });

  const assetItems: Array<{ amount: Decimal; currency: string }> = [];
  const liabilityItems: Array<{ amount: Decimal; currency: string }> = [];
  const itemsByAccount = new Map<string, { amount: Decimal; currency: string }>();

  for (const account of accounts) {
    const balance = balances.get(account.id) ?? toDecimal(0);
    const item = { amount: balance, currency: account.currency };
    itemsByAccount.set(account.id, item);

    if (LIABILITY_TYPES.has(account.type)) {
      liabilityItems.push({ amount: balance.abs(), currency: account.currency });
    } else {
      assetItems.push(item);
    }
  }

  const [assetConversion, liabilityConversion] = await Promise.all([
    convertMany(prisma, {
      userId: params.userId,
      baseCurrency: params.baseCurrency,
      asOf: params.asOf,
      items: assetItems,
    }),
    convertMany(prisma, {
      userId: params.userId,
      baseCurrency: params.baseCurrency,
      asOf: params.asOf,
      items: liabilityItems,
    }),
  ]);

  const missingPairs = [...new Set([...assetConversion.missingPairs, ...liabilityConversion.missingPairs])];
  const missingCurrencies = new Set(missingPairs.map((pair) => pair.split('->')[0] ?? ''));

  // 明确列出被排除的账户，而不是只给一个币种对
  const excludedAccounts = accounts
    .filter((account) => missingCurrencies.has(account.currency))
    .map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      reason: `缺少 ${account.currency}→${params.baseCurrency} 汇率`,
    }));

  return {
    totalAssets: assetConversion.total,
    totalLiabilities: liabilityConversion.total,
    netWorth: roundMoney(assetConversion.total.minus(liabilityConversion.total)),
    baseCurrency: params.baseCurrency,
    asOf: params.asOf,
    missingPairs,
    rateDates: [params.asOf.toISOString().slice(0, 10)],
    excludedAccounts,
  };
}
