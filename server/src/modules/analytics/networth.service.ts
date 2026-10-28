import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import { addDays, addMonths } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
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
      baseCurrency: params.baseCurrency,
      asOf: params.asOf,
      items: assetsToConvert,
    }),
    convertMany(prisma, {
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
      baseCurrency: params.baseCurrency,
      asOf: params.asOf,
      items: assetItems,
    }),
    convertMany(prisma, {
      baseCurrency: params.baseCurrency,
      asOf: params.asOf,
      items: liabilityItems,
    }),
    convertMany(prisma, {
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

/** 趋势采样点：period 供 x 轴展示，asOf 是该点计入流水的截止时刻 */
export interface NetWorthSample {
  period: string;
  asOf: Date;
}

/**
 * 按日 / 按月的采样点。
 *
 * 边界按用户时区计算：跨时区用户看到的「某一天」必须是他的那一天，
 * 而不是服务器所在时区的那一天。
 *
 * 每个点的 asOf 取该日（或该月）的结束时刻，但不晚于 now：
 * 这样最后一个点包含今天已入账的流水，与顶部净资产卡片口径一致。
 */
export function buildNetWorthSamples(params: {
  from: Date;
  to: Date;
  granularity: 'day' | 'month';
  timezone: string;
  now: Date;
}): NetWorthSample[] {
  const samples: NetWorthSample[] = [];
  const lastDayKey = formatInTimeZone(params.to, params.timezone, 'yyyy-MM-dd');

  if (params.granularity === 'day') {
    let cursorKey = formatInTimeZone(params.from, params.timezone, 'yyyy-MM-dd');

    // 以「日」为单位推进：用 zoned 的零点做加一天，避免夏令时把 24 小时算错
    while (cursorKey <= lastDayKey) {
      const dayStart = fromZonedTime(`${cursorKey}T00:00:00.000`, params.timezone);
      const nextDayStart = addDays(dayStart, 1);
      // 取当日最后一毫秒；夏令时当天可能是 23 或 25 小时，不能硬加 86400000
      let asOf = new Date(nextDayStart.getTime() - 1);
      if (asOf > params.now) asOf = params.now;
      samples.push({ period: cursorKey, asOf });
      cursorKey = formatInTimeZone(nextDayStart, params.timezone, 'yyyy-MM-dd');
    }

    return samples;
  }

  const lastMonthKey = formatInTimeZone(params.to, params.timezone, 'yyyy-MM');
  let cursorKey = formatInTimeZone(params.from, params.timezone, 'yyyy-MM');

  while (cursorKey <= lastMonthKey) {
    const monthStart = fromZonedTime(`${cursorKey}-01T00:00:00.000`, params.timezone);
    const nextMonthStart = addMonths(monthStart, 1);
    let asOf = new Date(nextMonthStart.getTime() - 1);
    if (asOf > params.now) asOf = params.now;
    samples.push({ period: cursorKey, asOf });
    cursorKey = formatInTimeZone(nextMonthStart, params.timezone, 'yyyy-MM');
  }

  return samples;
}

/** 时间序列上的一个点：按 at 升序排列，取值时二分找最后一个不晚于 asOf 的 */
interface DatedPoint {
  at: Date;
  value: Decimal;
}

/**
 * 净资产趋势序列。
 *
 * 与 computeNetWorth 逐点重算不同，这里把全部原始数据一次性取回，
 * 再沿采样点增量累计：采样点数量不再决定查询次数。
 * 逐点重算在 365 天视图下会放大成数千次串行查询，这是必须避开的部分。
 *
 * 口径与 computeNetWorth 保持一致：活跃账户余额 + 证券市值 + 其他资产 − 负债。
 */
export async function buildNetWorthSeries(
  prisma: PrismaClient,
  params: {
    userId: string;
    baseCurrency: string;
    samples: NetWorthSample[];
  },
): Promise<{ series: Array<{ period: string; value: Decimal }>; usedRateFallback: boolean }> {
  if (params.samples.length === 0) return { series: [], usedRateFallback: false };

  const lastAsOf = params.samples[params.samples.length - 1]!.asOf;

  const accounts = await prisma.account.findMany({
    where: { userId: params.userId, status: 'active' },
    select: {
      id: true,
      type: true,
      currency: true,
      openingBalance: true,
      openingBalanceDate: true,
    },
  });

  const accountIds = accounts.map((account) => account.id);

  const entries =
    accountIds.length === 0
      ? []
      : await prisma.transactionEntry.findMany({
          where: {
            userId: params.userId,
            accountId: { in: accountIds },
            transaction: { status: 'posted', occurredAt: { lte: lastAsOf } },
          },
          select: { accountId: true, amount: true, transaction: { select: { occurredAt: true } } },
          orderBy: { transaction: { occurredAt: 'asc' } },
        });

  const [assets, liabilities, portfolios, trades] = await Promise.all([
    prisma.asset.findMany({
      where: { userId: params.userId, status: 'active' },
      select: {
        currency: true,
        valuations: {
          where: { valuationDate: { lte: lastAsOf } },
          orderBy: { valuationDate: 'asc' },
          select: { valuationDate: true, value: true },
        },
      },
    }),
    prisma.liability.findMany({
      where: { userId: params.userId, status: 'active' },
      select: {
        currency: true,
        snapshots: {
          where: { snapshotDate: { lte: lastAsOf } },
          orderBy: { snapshotDate: 'asc' },
          select: { snapshotDate: true, balance: true },
        },
      },
    }),
    prisma.portfolio.findMany({
      where: { userId: params.userId, status: 'active' },
      select: { id: true, currency: true },
    }),
    prisma.portfolioTrade.findMany({
      where: {
        userId: params.userId,
        voidedAt: null,
        tradeDate: { lte: lastAsOf },
      },
      select: {
        portfolioId: true,
        instrumentId: true,
        kind: true,
        tradeDate: true,
        quantity: true,
        price: true,
      },
      orderBy: [{ tradeDate: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  const portfolioIds = new Set(portfolios.map((portfolio) => portfolio.id));
  const instrumentIds = [
    ...new Set(
      trades
        .filter((trade) => trade.instrumentId && portfolioIds.has(trade.portfolioId))
        .map((trade) => trade.instrumentId!),
    ),
  ];

  const prices =
    instrumentIds.length === 0
      ? []
      : await prisma.instrumentPrice.findMany({
          where: {
            userId: params.userId,
            instrumentId: { in: instrumentIds },
            priceDate: { lte: lastAsOf },
          },
          select: { instrumentId: true, priceDate: true, price: true },
          orderBy: [{ priceDate: 'asc' }],
        });

  // 序列里出现的所有币种一次取齐，采样点不再单独查汇率
  const currencies = new Set<string>([params.baseCurrency]);
  for (const account of accounts) currencies.add(account.currency);
  for (const asset of assets) currencies.add(asset.currency);
  for (const liability of liabilities) currencies.add(liability.currency);
  for (const portfolio of portfolios) currencies.add(portfolio.currency);

  // 刻意不按 lastAsOf 截断：区间早于首条汇率时要回退到最早那条，
  // 加了上限就取不到它，早期采样点会被算成 0。
  const rateRows = await prisma.exchangeRate.findMany({
    where: {
      OR: [
        { baseCurrency: { in: [...currencies] }, quoteCurrency: params.baseCurrency },
        { baseCurrency: params.baseCurrency, quoteCurrency: { in: [...currencies] } },
      ],
    },
    select: { baseCurrency: true, quoteCurrency: true, rateDate: true, rate: true },
    orderBy: { rateDate: 'asc' },
  });

  // ===== 前置索引：把「按某个 asOf 取最新一条」变成一次游标推进 =====

  const entriesByAccount = new Map<string, DatedPoint[]>();
  for (const entry of entries) {
    if (!entry.accountId) continue;
    const list = entriesByAccount.get(entry.accountId) ?? [];
    list.push({ at: entry.transaction.occurredAt, value: toDecimal(entry.amount.toString()) });
    entriesByAccount.set(entry.accountId, list);
  }

  const assetValuations = assets.map((asset) => ({
    currency: asset.currency,
    points: asset.valuations.map<DatedPoint>((valuation) => ({
      at: valuation.valuationDate,
      value: toDecimal(valuation.value.toString()),
    })),
  }));

  const liabilitySnapshots = liabilities.map((liability) => ({
    currency: liability.currency,
    points: liability.snapshots.map<DatedPoint>((snapshot) => ({
      at: snapshot.snapshotDate,
      value: toDecimal(snapshot.balance.toString()),
    })),
  }));

  const portfolioCurrency = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio.currency]));

  const tradesByPortfolio = new Map<string, typeof trades>();
  for (const trade of trades) {
    if (!portfolioCurrency.has(trade.portfolioId)) continue;
    const list = tradesByPortfolio.get(trade.portfolioId) ?? [];
    list.push(trade);
    tradesByPortfolio.set(trade.portfolioId, list);
  }

  const pricesByInstrument = new Map<string, DatedPoint[]>();
  for (const row of prices) {
    const list = pricesByInstrument.get(row.instrumentId) ?? [];
    list.push({ at: row.priceDate, value: toDecimal(row.price.toString()) });
    pricesByInstrument.set(row.instrumentId, list);
  }

  // 汇率同样按「不晚于 asOf 的最后一条」取，正反向都备好
  const ratesByPair = new Map<string, DatedPoint[]>();
  for (const row of rateRows) {
    const key = `${row.baseCurrency}->${row.quoteCurrency}`;
    const list = ratesByPair.get(key) ?? [];
    list.push({ at: row.rateDate, value: toDecimal(row.rate.toString()) });
    ratesByPair.set(key, list);
  }

  // 采样点早于该币种的首条汇率时，回退到最早可得的一条。
  // 否则历史区间会被整段算成 0，看起来像「那时候一无所有」，比近似更误导。
  let usedRateFallback = false;

  const rateForPair = (points: DatedPoint[] | undefined, asOf: Date): Decimal | null => {
    if (!points || points.length === 0) return null;
    const exact = latestUpTo(points, asOf);
    if (exact) return exact;
    usedRateFallback = true;
    return points[0]!.value;
  };

  const rateAt = (from: string, to: string, asOf: Date): Decimal | null => {
    if (from === to) return new Decimal(1);

    const direct = rateForPair(ratesByPair.get(`${from}->${to}`), asOf);
    if (direct) return direct;

    const reverse = rateForPair(ratesByPair.get(`${to}->${from}`), asOf);
    if (reverse && !reverse.isZero()) return new Decimal(1).div(reverse);

    return null;
  };

  // ===== 沿采样点累计 =====

  // 期初余额与 computeBalances 保持不变：它是账户的起点，只要账户活跃就计入，
  // 不按 openingBalanceDate 截断，否则早期采样点会凭空少掉整笔期初。
  const accountRunning = new Map<string, Decimal>();
  for (const account of accounts) {
    accountRunning.set(account.id, toDecimal(account.openingBalance.toString()));
  }

  const entryCursor = new Map<string, number>();
  for (const id of accountIds) entryCursor.set(id, 0);

  const series: Array<{ period: string; value: Decimal }> = [];

  for (const sample of params.samples) {
    const cutoff = sample.asOf.getTime();

    // 分录按时间递进推入：所有账户的分录都已按 occurredAt 升序
    for (const account of accounts) {
      const list = entriesByAccount.get(account.id) ?? [];
      let index = entryCursor.get(account.id) ?? 0;
      let running = accountRunning.get(account.id) ?? new Decimal(0);

      while (index < list.length && list[index]!.at.getTime() <= cutoff) {
        running = running.plus(list[index]!.value);
        index += 1;
      }

      accountRunning.set(account.id, running);
      entryCursor.set(account.id, index);
    }

    const addConverted = (amount: Decimal, currency: string): Decimal => {
      const rate = rateAt(currency, params.baseCurrency, sample.asOf);
      // 缺汇率的项不计入，与 computeNetWorth 的「宁可少算也不按 1:1」口径一致
      return rate ? amount.mul(rate) : new Decimal(0);
    };

    let assetsTotal = new Decimal(0);
    let liabilitiesTotal = new Decimal(0);

    for (const account of accounts) {
      const balance = accountRunning.get(account.id) ?? new Decimal(0);
      if (LIABILITY_TYPES.has(account.type)) {
        liabilitiesTotal = liabilitiesTotal.plus(addConverted(balance.abs(), account.currency));
      } else {
        assetsTotal = assetsTotal.plus(addConverted(balance, account.currency));
      }
    }

    // 其他资产 / 负债：取该点之前最后一条估值或快照
    for (const asset of assetValuations) {
      const value = latestUpTo(asset.points, sample.asOf);
      if (value === null) continue;
      assetsTotal = assetsTotal.plus(addConverted(value, asset.currency));
    }

    for (const liability of liabilitySnapshots) {
      const value = latestUpTo(liability.points, sample.asOf);
      if (value === null) continue;
      liabilitiesTotal = liabilitiesTotal.plus(addConverted(value, liability.currency));
    }

    // 证券市值：该点持仓 × 当时最近价格，再折算。
    // 证券账户现金已由账户余额计入，这里只加持仓市值，避免重复。
    for (const portfolio of portfolios) {
      const holdings = replayHoldingsUpTo(tradesByPortfolio.get(portfolio.id) ?? [], sample.asOf);
      let marketValue = new Decimal(0);

      for (const holding of holdings) {
        if (holding.quantity.lte(0)) continue;
        const price = latestUpTo(pricesByInstrument.get(holding.instrumentId), sample.asOf);
        if (!price) continue;
        marketValue = marketValue.plus(holding.quantity.mul(price));
      }

      if (marketValue.gt(0)) {
        assetsTotal = assetsTotal.plus(addConverted(roundMoney(marketValue), portfolio.currency));
      }
    }

    series.push({ period: sample.period, value: roundMoney(assetsTotal.minus(liabilitiesTotal)) });
  }

  return { series, usedRateFallback };
}

/** 取不晚于 asOf 的最后一条；列表按时间升序 */
function latestUpTo(points: DatedPoint[] | undefined, asOf: Date): Decimal | null {
  if (!points || points.length === 0) return null;

  let low = 0;
  let high = points.length - 1;
  let found = -1;
  const cutoff = asOf.getTime();

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid]!.at.getTime() <= cutoff) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found === -1 ? null : points[found]!.value;
}

/**
 * 持仓重放：只关心数量，不关心成本与已实现损益。
 * 与 replayTrades 的买卖规则一致，卖出数量超过持仓时不抛错，
 * 而是按可用数量卖出——趋势图的目的是画净值，不应因历史脏数据整段失败。
 */
function replayHoldingsUpTo(
  trades: Array<{
    instrumentId: string | null;
    kind: string;
    tradeDate: Date;
    quantity: unknown;
  }>,
  asOf: Date,
): Array<{ instrumentId: string; quantity: Decimal }> {
  const quantities = new Map<string, Decimal>();
  const cutoff = asOf.getTime();

  for (const trade of trades) {
    if (trade.tradeDate.getTime() > cutoff) break;
    if (!trade.instrumentId) continue;
    if (trade.kind !== 'buy' && trade.kind !== 'sell') continue;
    if (trade.quantity === null || trade.quantity === undefined) continue;

    const quantity = toDecimal(String(trade.quantity));
    const current = quantities.get(trade.instrumentId) ?? new Decimal(0);
    const next = trade.kind === 'buy' ? current.plus(quantity) : Decimal.max(current.minus(quantity), 0);
    quantities.set(trade.instrumentId, next);
  }

  return [...quantities.entries()].map(([instrumentId, quantity]) => ({ instrumentId, quantity }));
}
