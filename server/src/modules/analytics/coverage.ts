import Decimal from 'decimal.js';
import { roundMoney } from '../../lib/money.js';
import type { AnalyticsRow, AnalyticsResult, MissingRate } from './query.service.js';

export interface Coverage {
  categorizedAmount: string;
  uncategorizedAmount: string;
  uncategorizedCount: number;
  /** 已分类金额 / 总支出；总支出为 0 时返回 null */
  coverageRatio: string | null;
  missingRates: MissingRate[];
  isComplete: boolean;
  excludedCount: number;
}

/**
 * 分类覆盖率。
 * 未分类金额必须单独暴露：分类占比图只显示已分类部分，
 * 若不给出覆盖率，用户会把「已分类部分」误读成全部支出。
 */
export function computeCoverage(rows: AnalyticsRow[], result: AnalyticsResult): Coverage {
  const expenses = rows.filter((row) => row.type === 'expense');

  let categorized = new Decimal(0);
  let uncategorized = new Decimal(0);
  let uncategorizedCount = 0;

  for (const row of expenses) {
    if (row.categoryId) {
      categorized = categorized.plus(row.amountBase);
    } else {
      uncategorized = uncategorized.plus(row.amountBase);
      uncategorizedCount += 1;
    }
  }

  const total = categorized.plus(uncategorized);

  return {
    categorizedAmount: roundMoney(categorized).toFixed(6),
    uncategorizedAmount: roundMoney(uncategorized).toFixed(6),
    uncategorizedCount,
    coverageRatio: total.isZero() ? null : categorized.div(total).toDecimalPlaces(4).toFixed(4),
    missingRates: result.missingRates,
    isComplete: result.isComplete,
    excludedCount: result.excludedCount,
  };
}

/** 完整的口径说明，随响应返回，前端不得自行编造口径文案 */
export function buildBasis(params: {
  timezone: string;
  baseCurrency: string;
  range: { from: string; to: string; days: number };
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    timezone: params.timezone,
    baseCurrency: params.baseCurrency,
    period: params.range,
    excludes: ['transfer', 'adjustment', 'voided'],
    rateDateMode: 'transaction_date',
    ...params.extra,
  };
}
