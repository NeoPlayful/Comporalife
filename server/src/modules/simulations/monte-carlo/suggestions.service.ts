import Decimal from 'decimal.js';
import type { PrismaClient } from '@prisma/client';
import {
  MONTE_CARLO_HIGH_CONFIDENCE_SAMPLES,
  MONTE_CARLO_MIN_SAMPLES,
} from '../../../config/constants.js';
import { errors } from '../../../lib/errors.js';
import { roundMoney } from '../../../lib/money.js';
import { portfolioPositions, valueHoldings } from '../../portfolios/valuation.service.js';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface SuggestionAsset {
  key: string;
  label: string;
  weight: string;
  /** 样本不足时为 null，界面据此显示「数据不足」而不是给一个假数字 */
  expectedAnnualReturn: string | null;
  annualVolatility: string | null;
}

export interface SuggestionResult {
  portfolio: { id: string; name: string; currency: string };
  assets: SuggestionAsset[];
  /** 相关性永远不由系统猜测：样本不足时自动生成的相关性比噪声更危险 */
  correlation: null;
  history: { from: string | null; to: string | null; samples: number; frequency: 'daily' };
  confidence: ConfidenceLevel;
  notes: string[];
}

const TRADING_DAYS = 250;

/**
 * 从真实组合反填模拟参数。
 * 只读：不修改组合、不触发估值重算、不写审计记录。
 * 收益与波动只在样本足够时给出——短历史估计出的年化收益极不稳定，
 * 直接当成「预期收益」会显著误导用户。
 */
export async function suggestFromPortfolio(
  prisma: PrismaClient,
  userId: string,
  portfolioId: string,
): Promise<SuggestionResult> {
  const portfolio = await prisma.portfolio.findFirst({
    where: { id: portfolioId, userId, status: 'active' },
    select: { id: true, name: true, currency: true },
  });

  if (!portfolio) throw errors.portfolioNotFound();

  const positions = await portfolioPositions(prisma, { userId, portfolioId });
  const holdings = positions.ok ? positions.holdings.filter((holding) => holding.quantity.gt(0)) : [];

  if (holdings.length === 0) {
    return {
      portfolio,
      assets: [],
      correlation: null,
      history: { from: null, to: null, samples: 0, frequency: 'daily' },
      confidence: 'low',
      notes: ['no_holdings'],
    };
  }

  const valuation = await valueHoldings(prisma, {
    userId,
    currency: portfolio.currency,
    holdings,
  });

  const instrumentIds = holdings.map((holding) => holding.instrumentId);
  const instruments = await prisma.instrument.findMany({
    where: { userId, id: { in: instrumentIds } },
    select: { id: true, symbol: true, name: true, assetClass: true },
  });
  const meta = new Map(instruments.map((item) => [item.id, item]));
  const priceByInstrument = new Map(valuation.holdingValues.map((value) => [value.instrumentId, value]));

  const totalMarketValue = valuation.marketValue;

  const assets: SuggestionAsset[] = holdings
    .filter((holding) => holding.quantity.gt(0))
    .map((holding) => {
      const instrument = meta.get(holding.instrumentId);
      const held = priceByInstrument.get(holding.instrumentId);
      const weight = totalMarketValue.isZero()
        ? new Decimal(0)
        : (held?.marketValue ?? new Decimal(0)).div(totalMarketValue);

      return {
        key: `instrument:${holding.instrumentId}`,
        label: instrument ? `${instrument.symbol} ${instrument.name}` : holding.instrumentId,
        weight: roundMoney(weight).toFixed(6),
        expectedAnnualReturn: null,
        annualVolatility: null,
      };
    });

  const stats = await estimateStats(prisma, userId, instrumentIds);

  for (const asset of assets) {
    const instrumentId = asset.key.replace('instrument:', '');
    const estimate = stats.get(instrumentId);
    if (estimate && estimate.samples >= MONTE_CARLO_MIN_SAMPLES && estimate.years >= 1) {
      asset.expectedAnnualReturn = estimate.annualReturn.toFixed(6);
      asset.annualVolatility = estimate.annualVolatility.toFixed(6);
    }
  }

  const statList = [...stats.values()];
  // 只有每个标的都有历史才谈得上「整体样本量」；缺任一标的直接算最低档
  const minSamples = statList.length > 0 ? Math.min(...statList.map((value) => value.samples)) : 0;
  const totalSamples = statList.reduce((max, value) => Math.max(max, value.samples), 0);
  const coverageYears = statList.length > 0 ? Math.min(...statList.map((value) => value.years)) : 0;

  const notes: string[] = [];
  let confidence: ConfidenceLevel = 'high';

  if (stats.size < instrumentIds.length) {
    // 某些标的完全没有价格历史，无法估计
    notes.push('insufficient_history');
    confidence = 'low';
  } else if (coverageYears < 1) {
    notes.push('samples_below_1_year');
    confidence = 'low';
  } else if (coverageYears < 3 || minSamples < MONTE_CARLO_HIGH_CONFIDENCE_SAMPLES) {
    notes.push('samples_below_3_years');
    confidence = 'medium';
  }

  // 相关性需用户填写：系统不猜测
  notes.push('correlation_requires_manual_input');

  const range = earliestAndLatest([...stats.values()]);

  return {
    portfolio,
    assets,
    correlation: null,
    history: {
      from: range.from,
      to: range.to,
      samples: totalSamples,
      frequency: 'daily',
    },
    confidence,
    notes,
  };
}

interface InstrumentStats {
  samples: number;
  years: number;
  annualReturn: number;
  annualVolatility: number;
  from: string;
  to: string;
}

/**
 * 用日价格序列估计年化收益与波动。
 * 计算方法为对数收益差年化（×250）与年化波动（×√250），不扣除无风险利率；
 * 结果只是样本统计量，不是「预期收益」。
 */
async function estimateStats(
  prisma: PrismaClient,
  userId: string,
  instrumentIds: string[],
): Promise<Map<string, InstrumentStats>> {
  const result = new Map<string, InstrumentStats>();

  for (const instrumentId of instrumentIds) {
    const prices = await prisma.instrumentPrice.findMany({
      where: { userId, instrumentId },
      orderBy: { priceDate: 'asc' },
      select: { priceDate: true, price: true },
    });

    if (prices.length < MONTE_CARLO_MIN_SAMPLES) continue;

    const returns: number[] = [];
    for (let i = 1; i < prices.length; i += 1) {
      const previous = Number(prices[i - 1]!.price.toString());
      const current = Number(prices[i]!.price.toString());
      if (previous > 0 && current > 0) returns.push(Math.log(current / previous));
    }

    if (returns.length < MONTE_CARLO_MIN_SAMPLES) continue;

    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;

    const from = prices[0]!.priceDate;
    const to = prices[prices.length - 1]!.priceDate;
    const days = (to.getTime() - from.getTime()) / 86_400_000;

    result.set(instrumentId, {
      samples: returns.length,
      years: days / 365,
      annualReturn: Math.exp(mean * TRADING_DAYS) - 1,
      annualVolatility: Math.sqrt(variance) * Math.sqrt(TRADING_DAYS),
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
  }

  return result;
}

function earliestAndLatest(stats: InstrumentStats[]): { from: string | null; to: string | null } {
  if (stats.length === 0) return { from: null, to: null };

  let from = stats[0]!.from;
  let to = stats[0]!.to;

  for (const item of stats) {
    if (item.from < from) from = item.from;
    if (item.to > to) to = item.to;
  }

  return { from, to };
}

