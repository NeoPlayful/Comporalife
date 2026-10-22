import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { LIABILITY_ACCOUNT_TYPES } from '../../config/constants.js';
import { roundMoney, toDecimal } from '../../lib/money.js';
import { convertMany } from '../currencies/currency.service.js';
import { computeBalances } from '../accounts/balance.service.js';
import { loadAllPortfolioValuations } from '../portfolios/valuation.service.js';

export interface NetWorthResult {
  totalAssets: Decimal;
  totalLiabilities: Decimal;
  netWorth: Decimal;
  /** 证券市值（已折算基准币种），不含证券账户现金 */
  securitiesValue: Decimal;
  baseCurrency: string;
  asOf: Date;
  missingPairs: string[];
  rateDates: string[];
  excludedAccounts: Array<{ id: string; name: string; currency: string; reason: string }>;
  staleValuations: Array<{ portfolioId: string; name: string; priceDate: string | null }>;
  unpriced: Array<{ portfolioId: string; name: string; symbols: string[] }>;
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

  // 证券市值是净资产里的增量部分：证券账户的现金已经计入账户余额，
  // 这里只加持仓市值，绝不再加组合现金
  const portfolioValuations = await loadAllPortfolioValuations(prisma, {
    userId: params.userId,
    asOf: params.asOf,
  });

  const securitiesItems = portfolioValuations
    .filter((item) => item.marketValue.gt(0))
    .map((item) => ({ amount: item.marketValue, currency: item.currency }));

  const [assetConversion, liabilityConversion, securitiesConversion] = await Promise.all([
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
    convertMany(prisma, {
      userId: params.userId,
      baseCurrency: params.baseCurrency,
      asOf: params.asOf,
      items: securitiesItems,
    }),
  ]);

  const missingPairs = [
    ...new Set([
      ...assetConversion.missingPairs,
      ...liabilityConversion.missingPairs,
      ...securitiesConversion.missingPairs,
    ]),
  ];
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

  const totalAssets = assetConversion.total.plus(securitiesConversion.total);

  return {
    totalAssets,
    totalLiabilities: liabilityConversion.total,
    netWorth: roundMoney(totalAssets.minus(liabilityConversion.total)),
    securitiesValue: securitiesConversion.total,
    baseCurrency: params.baseCurrency,
    asOf: params.asOf,
    missingPairs,
    rateDates: [params.asOf.toISOString().slice(0, 10)],
    excludedAccounts,
    // 过期估值与无价标的必须显式暴露，不能让用户以为市值是实时的
    staleValuations: portfolioValuations
      .filter((item) => item.stale && item.marketValue.gt(0))
      .map((item) => ({ portfolioId: item.portfolioId, name: item.name, priceDate: item.priceDate })),
    unpriced: portfolioValuations
      .filter((item) => item.missingSymbols.length > 0)
      .map((item) => ({ portfolioId: item.portfolioId, name: item.name, symbols: item.missingSymbols })),
  };
}
