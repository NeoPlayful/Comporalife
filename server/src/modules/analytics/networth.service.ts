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
  // ===== 六项分项：三者之和必须严格等于总数，供 UI 分栏展示并自证不重复计数 =====
  accountAssets: Decimal;
  otherAssets: Decimal;
  accountLiabilities: Decimal;
  otherLiabilities: Decimal;
  baseCurrency: string;
  asOf: Date;
  missingPairs: string[];
  rateDates: string[];
  excludedAccounts: Array<{ id: string; name: string; currency: string; reason: string }>;
  staleValuations: Array<{ portfolioId: string; name: string; priceDate: string | null }>;
  unpriced: Array<{ portfolioId: string; name: string; symbols: string[] }>;
  /** 未录估值或估值在未来的资产：不计入净资产，但必须显式返回 */
  unpricedAssets: Array<{ id: string; name: string; reason: string }>;
  unpricedLiabilities: Array<{ id: string; name: string; reason: string }>;
}

const LIABILITY_TYPES = new Set<string>(LIABILITY_ACCOUNT_TYPES);

/**
 * 非交易型资产与负债的折算。
 *
 * 规则：
 * - 取 valuationDate / snapshotDate <= asOf 的最后一条
 * - 全部在 asOf 之后或从未录入 → 不计入，进 unpriced 列表
 * - 外币缺汇率 → 不计入，进 unpriced 列表并上报币种对
 * - 归档的不计入
 */
async function computeOtherAssetsAndLiabilities(
  prisma: PrismaClient,
  params: { userId: string; baseCurrency: string; asOf: Date },
): Promise<{
  otherAssets: Decimal;
  otherLiabilities: Decimal;
  unpricedAssets: Array<{ id: string; name: string; reason: string }>;
  unpricedLiabilities: Array<{ id: string; name: string; reason: string }>;
  extraMissingPairs: string[];
}> {
  const [assets, liabilities] = await Promise.all([
    prisma.asset.findMany({
      where: { userId: params.userId, status: 'active' },
      select: {
        id: true,
        name: true,
        currency: true,
        valuations: {
          orderBy: { valuationDate: 'desc' },
          select: { valuationDate: true, value: true },
        },
      },
    }),
    prisma.liability.findMany({
      where: { userId: params.userId, status: 'active' },
      select: {
        id: true,
        name: true,
        currency: true,
        snapshots: {
          orderBy: { snapshotDate: 'desc' },
          select: { snapshotDate: true, balance: true },
        },
      },
    }),
  ]);

  const unpricedAssets: Array<{ id: string; name: string; reason: string }> = [];
  const unpricedLiabilities: Array<{ id: string; name: string; reason: string }> = [];
  const extraMissingPairs: string[] = [];

  const assetsToConvert: Array<{ amount: Decimal; currency: string }> = [];
  const liabilitiesToConvert: Array<{ amount: Decimal; currency: string }> = [];

  for (const asset of assets) {
    const latest = asset.valuations.find((item) => item.valuationDate.getTime() <= params.asOf.getTime());
    if (!latest) {
      unpricedAssets.push({
        id: asset.id,
        name: asset.name,
        reason: asset.valuations.length > 0 ? 'future_valuation' : 'no_valuation',
      });
      continue;
    }
    assetsToConvert.push({ amount: toDecimal(latest.value.toString()), currency: asset.currency });
  }

  for (const liability of liabilities) {
    const latest = liability.snapshots.find((item) => item.snapshotDate.getTime() <= params.asOf.getTime());
    if (!latest) {
      unpricedLiabilities.push({
        id: liability.id,
        name: liability.name,
        reason: liability.snapshots.length > 0 ? 'future_snapshot' : 'no_snapshot',
      });
      continue;
    }
    liabilitiesToConvert.push({ amount: toDecimal(latest.balance.toString()), currency: liability.currency });
  }

  const [assetConversion, liabilityConversion] = await Promise.all([
    convertMany(prisma, {
      userId: params.userId,
      baseCurrency: params.baseCurrency,
      asOf: params.asOf,
      items: assetsToConvert,
    }),
    convertMany(prisma, {
      userId: params.userId,
      baseCurrency: params.baseCurrency,
      asOf: params.asOf,
      items: liabilitiesToConvert,
    }),
  ]);

  // 缺汇率的条目要按名称列出，只给币种对用户无法定位是哪一项
  const assetMissing = new Set(assetConversion.missingPairs);
  const liabilityMissing = new Set(liabilityConversion.missingPairs);

  for (const asset of assets) {
    const latest = asset.valuations.find((item) => item.valuationDate.getTime() <= params.asOf.getTime());
    if (!latest) continue;
    if (asset.currency === params.baseCurrency) continue;
    const pair = `${asset.currency}->${params.baseCurrency}`;
    if (assetMissing.has(pair)) {
      unpricedAssets.push({ id: asset.id, name: asset.name, reason: 'missing_rate' });
      if (!extraMissingPairs.includes(pair)) extraMissingPairs.push(pair);
    }
  }

  for (const liability of liabilities) {
    const latest = liability.snapshots.find((item) => item.snapshotDate.getTime() <= params.asOf.getTime());
    if (!latest) continue;
    if (liability.currency === params.baseCurrency) continue;
    const pair = `${liability.currency}->${params.baseCurrency}`;
    if (liabilityMissing.has(pair)) {
      unpricedLiabilities.push({ id: liability.id, name: liability.name, reason: 'missing_rate' });
      if (!extraMissingPairs.includes(pair)) extraMissingPairs.push(pair);
    }
  }

  return {
    otherAssets: assetConversion.total,
    otherLiabilities: liabilityConversion.total,
    unpricedAssets,
    unpricedLiabilities,
    extraMissingPairs,
  };
}

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

  // ===== 非交易型资产与负债：按最新快照并入净资产 =====
  const { otherAssets, otherLiabilities, unpricedAssets, unpricedLiabilities, extraMissingPairs } =
    await computeOtherAssetsAndLiabilities(prisma, params);

  for (const pair of extraMissingPairs) {
    if (!missingPairs.includes(pair)) missingPairs.push(pair);
  }

  const totalAssets = assetConversion.total.plus(securitiesConversion.total).plus(otherAssets);
  const totalLiabilities = liabilityConversion.total.plus(otherLiabilities);

  return {
    totalAssets,
    totalLiabilities,
    netWorth: roundMoney(totalAssets.minus(totalLiabilities)),
    securitiesValue: securitiesConversion.total,
    accountAssets: assetConversion.total,
    otherAssets,
    accountLiabilities: liabilityConversion.total,
    otherLiabilities,
    baseCurrency: params.baseCurrency,
    asOf: params.asOf,
    missingPairs,
    rateDates: [params.asOf.toISOString().slice(0, 10)],
    excludedAccounts,
    unpricedAssets,
    unpricedLiabilities,
    // 过期估值与无价标的必须显式暴露，不能让用户以为市值是实时的
    staleValuations: portfolioValuations
      .filter((item) => item.stale && item.marketValue.gt(0))
      .map((item) => ({ portfolioId: item.portfolioId, name: item.name, priceDate: item.priceDate })),
    unpriced: portfolioValuations
      .filter((item) => item.missingSymbols.length > 0)
      .map((item) => ({ portfolioId: item.portfolioId, name: item.name, symbols: item.missingSymbols })),
  };
}
