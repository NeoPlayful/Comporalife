import type { PrismaClient } from '@prisma/client';
import type { ExportScope } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { moneyToString, priceToString, roundMoney, toDecimal } from '../../lib/money.js';
import { loadAllPortfolioValuations } from '../portfolios/valuation.service.js';
import { findMissingMonths, findRateLag, findStaleValuations } from '../quality/quality.service.js';

export interface ExportDataset {
  name: string;
  header: string[];
  // 布尔值按原样导出，交给 escapeCell 渲染；不在此处转成 true/false 字符串
  rows: Array<Array<string | number | boolean | null>>;
}

export interface ExportContext {
  userId: string;
  timezone: string;
  baseCurrency: string;
  includeArchived: boolean;
  from: Date | null;
  to: Date | null;
}

/** 每个 scope 需要哪些数据集；依赖域显式列出，避免「导出投资却没有标的」 */
const SCOPE_DATASETS: Record<ExportScope, string[]> = {
  full: [
    'accounts',
    'categories',
    'tags',
    'transactions',
    'entries',
    'transaction_tags',
    'budgets',
    'instruments',
    'instrument_prices',
    'portfolios',
    'portfolio_targets',
    'trades',
    'portfolio_cashflows',
    'valuations',
    'classification_rules',
    'import_templates',
    'reconciliations',
    'simulation_scenarios',
    'goals',
    'reports',
    'exchange_rates',
    'settings',
  ],
  ledger: ['accounts', 'categories', 'tags', 'transactions', 'entries', 'transaction_tags', 'reconciliations'],
  investments: [
    'accounts',
    'instruments',
    'instrument_prices',
    'portfolios',
    'portfolio_targets',
    'trades',
    'portfolio_cashflows',
    'valuations',
  ],
  simulations: ['simulation_scenarios'],
  planning: ['goals', 'reports'],
  settings: ['settings', 'exchange_rates'],
};

export function datasetsForScope(scope: ExportScope): string[] {
  return SCOPE_DATASETS[scope];
}

function dateOnly(value: Date | null, timezone: string): string | null {
  return value ? formatInTimeZone(value, timezone, 'yyyy-MM-dd') : null;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

const SETTINGS_HEADER = [
  'baseCurrency',
  'timezone',
  'dateFormat',
  'theme',
  'language',
  'simulationDefaultsJson',
];

/** 逐域取数。全部只读，且每个查询都带 userId 作用域 */
export async function loadDataset(
  prisma: PrismaClient,
  dataset: string,
  context: ExportContext,
): Promise<ExportDataset> {
  const statusFilter = context.includeArchived ? {} : { status: 'active' as const };
  const occurredAtFilter =
    context.from || context.to
      ? {
          occurredAt: {
            ...(context.from ? { gte: context.from } : {}),
            ...(context.to ? { lte: context.to } : {}),
          },
        }
      : {};

  switch (dataset) {
    case 'accounts': {
      const rows = await prisma.account.findMany({
        where: { userId: context.userId, ...statusFilter },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          type: true,
          institution: true,
          currency: true,
          openingBalance: true,
          openingBalanceDate: true,
          status: true,
          note: true,
          createdAt: true,
        },
      });

      return {
        name: 'accounts.csv',
        header: ['id', 'name', 'type', 'institution', 'currency', 'openingBalance', 'openingBalanceDate', 'status', 'note', 'createdAt'],
        rows: rows.map((row) => [
          row.id,
          row.name,
          row.type,
          row.institution,
          row.currency,
          moneyToString(row.openingBalance),
          dateOnly(row.openingBalanceDate, context.timezone),
          row.status,
          row.note,
          iso(row.createdAt),
        ]),
      };
    }

    case 'categories': {
      const rows = await prisma.category.findMany({
        where: { userId: context.userId },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
        select: { id: true, parentId: true, name: true, kind: true, sortOrder: true, archived: true },
      });

      return {
        name: 'categories.csv',
        header: ['id', 'parentId', 'name', 'kind', 'sortOrder', 'archived'],
        rows: rows.map((row) => [row.id, row.parentId, row.name, row.kind, row.sortOrder, row.archived]),
      };
    }

    case 'tags': {
      const rows = await prisma.tag.findMany({
        where: { userId: context.userId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      });

      return { name: 'tags.csv', header: ['id', 'name'], rows: rows.map((row) => [row.id, row.name]) };
    }

    case 'transactions': {
      const rows = await prisma.transaction.findMany({
        where: { userId: context.userId, ...occurredAtFilter },
        orderBy: { occurredAt: 'asc' },
        select: {
          id: true,
          type: true,
          occurredAt: true,
          description: true,
          merchant: true,
          note: true,
          categoryId: true,
          status: true,
          source: true,
          externalId: true,
          importBatchId: true,
          createdAt: true,
        },
      });

      return {
        name: 'transactions.csv',
        header: ['id', 'type', 'occurredAt', 'description', 'merchant', 'note', 'categoryId', 'status', 'source', 'externalId', 'importBatchId', 'createdAt'],
        rows: rows.map((row) => [
          row.id,
          row.type,
          iso(row.occurredAt),
          row.description,
          row.merchant,
          row.note,
          row.categoryId,
          row.status,
          row.source,
          row.externalId,
          row.importBatchId,
          iso(row.createdAt),
        ]),
      };
    }

    case 'entries': {
      const rows = await prisma.transactionEntry.findMany({
        where: { userId: context.userId, ...(context.from || context.to ? { transaction: occurredAtFilter as never } : {}) },
        orderBy: { createdAt: 'asc' },
        select: { id: true, transactionId: true, accountId: true, amount: true, currency: true },
      });

      return {
        name: 'entries.csv',
        header: ['id', 'transactionId', 'accountId', 'amount', 'currency'],
        rows: rows.map((row) => [row.id, row.transactionId, row.accountId, moneyToString(row.amount), row.currency]),
      };
    }

    case 'budgets': {
      const rows = await prisma.budget.findMany({
        where: { userId: context.userId, ...statusFilter },
        orderBy: [{ year: 'asc' }, { month: 'asc' }],
        select: {
          id: true,
          periodType: true,
          year: true,
          month: true,
          status: true,
          totalAmount: true,
          rollover: true,
          note: true,
          items: { select: { id: true, categoryId: true, amount: true } },
        },
      });

      return {
        name: 'budgets.csv',
        header: ['id', 'periodType', 'year', 'month', 'status', 'totalAmount', 'rollover', 'itemCount', 'itemsTotal', 'note'],
        rows: rows.map((row) => {
          const itemsTotal = row.items.reduce((sum, item) => sum.plus(item.amount), toDecimal(0));
          return [
            row.id,
            row.periodType,
            row.year,
            row.month,
            row.status,
            row.totalAmount ? moneyToString(row.totalAmount) : null,
            row.rollover,
            row.items.length,
            moneyToString(roundMoney(itemsTotal)),
            row.note,
          ];
        }),
      };
    }

    case 'instruments': {
      const rows = await prisma.instrument.findMany({
        where: { userId: context.userId },
        orderBy: { symbol: 'asc' },
        select: { id: true, symbol: true, name: true, assetClass: true, currency: true },
      });

      return {
        name: 'instruments.csv',
        header: ['id', 'symbol', 'name', 'assetClass', 'currency'],
        rows: rows.map((row) => [row.id, row.symbol, row.name, row.assetClass, row.currency]),
      };
    }

    case 'portfolios': {
      const rows = await prisma.portfolio.findMany({
        where: { userId: context.userId, ...(context.includeArchived ? {} : { status: 'active' }) },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, accountId: true, currency: true, status: true, costBasisMethod: true, note: true },
      });

      return {
        name: 'portfolios.csv',
        header: ['id', 'name', 'accountId', 'currency', 'status', 'costBasisMethod', 'note'],
        rows: rows.map((row) => [row.id, row.name, row.accountId, row.currency, row.status, row.costBasisMethod, row.note]),
      };
    }

    case 'trades': {
      const rows = await prisma.portfolioTrade.findMany({
        where: {
          userId: context.userId,
          ...(context.from || context.to
            ? { tradeDate: { ...(context.from ? { gte: context.from } : {}), ...(context.to ? { lte: context.to } : {}) } }
            : {}),
        },
        orderBy: { tradeDate: 'asc' },
        select: {
          id: true,
          portfolioId: true,
          instrumentId: true,
          kind: true,
          quantity: true,
          price: true,
          amount: true,
          fee: true,
          tax: true,
          tradeDate: true,
          voidedAt: true,
          note: true,
        },
      });

      return {
        name: 'trades.csv',
        header: ['id', 'portfolioId', 'instrumentId', 'kind', 'quantity', 'price', 'amount', 'fee', 'tax', 'tradeDate', 'voidedAt', 'note'],
        rows: rows.map((row) => [
          row.id,
          row.portfolioId,
          row.instrumentId,
          row.kind,
          row.quantity ? row.quantity.toFixed(8) : null,
          row.price ? priceToString(row.price) : null,
          moneyToString(row.amount),
          moneyToString(row.fee),
          moneyToString(row.tax),
          iso(row.tradeDate),
          iso(row.voidedAt),
          row.note,
        ]),
      };
    }

    case 'portfolio_cashflows': {
      const rows = await prisma.portfolioCashflow.findMany({
        where: {
          userId: context.userId,
          ...(context.from || context.to
            ? { flowDate: { ...(context.from ? { gte: context.from } : {}), ...(context.to ? { lte: context.to } : {}) } }
            : {}),
        },
        orderBy: { flowDate: 'asc' },
        select: { id: true, portfolioId: true, kind: true, amount: true, flowDate: true, note: true },
      });

      return {
        name: 'portfolio_cashflows.csv',
        header: ['id', 'portfolioId', 'kind', 'amount', 'flowDate', 'note'],
        rows: rows.map((row) => [row.id, row.portfolioId, row.kind, moneyToString(row.amount), iso(row.flowDate), row.note]),
      };
    }

    case 'instrument_prices': {
      const rows = await prisma.instrumentPrice.findMany({
        where: {
          userId: context.userId,
          ...(context.from || context.to
            ? { priceDate: { ...(context.from ? { gte: context.from } : {}), ...(context.to ? { lte: context.to } : {}) } }
            : {}),
        },
        orderBy: [{ instrumentId: 'asc' }, { priceDate: 'asc' }],
        select: { id: true, instrumentId: true, priceDate: true, price: true, source: true, note: true },
      });

      return {
        name: 'instrument_prices.csv',
        header: ['id', 'instrumentId', 'priceDate', 'price', 'source', 'note'],
        rows: rows.map((row) => [
          row.id,
          row.instrumentId,
          dateOnly(row.priceDate, context.timezone),
          priceToString(row.price),
          row.source,
          row.note,
        ]),
      };
    }

    case 'portfolio_targets': {
      const rows = await prisma.portfolioTarget.findMany({
        where: { userId: context.userId },
        orderBy: [{ portfolioId: 'asc' }, { dimension: 'asc' }, { key: 'asc' }],
        select: { id: true, portfolioId: true, dimension: true, key: true, targetWeight: true },
      });

      return {
        name: 'portfolio_targets.csv',
        header: ['id', 'portfolioId', 'dimension', 'key', 'targetWeight'],
        rows: rows.map((row) => [row.id, row.portfolioId, row.dimension, row.key, moneyToString(row.targetWeight)]),
      };
    }

    case 'transaction_tags': {
      const rows = await prisma.transactionTag.findMany({
        where: { transaction: { userId: context.userId } },
        orderBy: [{ transactionId: 'asc' }, { tagId: 'asc' }],
        select: { transactionId: true, tagId: true },
      });

      return {
        name: 'transaction_tags.csv',
        header: ['transactionId', 'tagId'],
        rows: rows.map((row) => [row.transactionId, row.tagId]),
      };
    }

    case 'classification_rules': {
      const rows = await prisma.classificationRule.findMany({
        where: { userId: context.userId },
        orderBy: [{ priority: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          priority: true,
          enabled: true,
          conditions: true,
          actions: true,
          matchCount: true,
          lastAppliedAt: true,
        },
      });

      return {
        name: 'classification_rules.csv',
        header: ['id', 'name', 'priority', 'enabled', 'conditionsJson', 'actionsJson', 'matchCount', 'lastAppliedAt'],
        rows: rows.map((row) => [
          row.id,
          row.name,
          row.priority,
          row.enabled,
          JSON.stringify(row.conditions),
          JSON.stringify(row.actions),
          row.matchCount,
          iso(row.lastAppliedAt),
        ]),
      };
    }

    case 'import_templates': {
      const rows = await prisma.importTemplate.findMany({
        where: { userId: context.userId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, bankName: true, format: true, headerSignature: true, mapping: true },
      });

      return {
        name: 'import_templates.csv',
        header: ['id', 'name', 'bankName', 'format', 'headerSignature', 'mappingJson'],
        rows: rows.map((row) => [
          row.id,
          row.name,
          row.bankName,
          row.format,
          row.headerSignature,
          JSON.stringify(row.mapping),
        ]),
      };
    }

    case 'reconciliations': {
      const rows = await prisma.accountReconciliation.findMany({
        where: { userId: context.userId },
        orderBy: [{ accountId: 'asc' }, { reconciledAt: 'asc' }],
        select: {
          id: true,
          accountId: true,
          statementBalance: true,
          computedBalance: true,
          difference: true,
          reconciledAt: true,
          note: true,
        },
      });

      return {
        name: 'account_reconciliations.csv',
        header: ['id', 'accountId', 'statementBalance', 'computedBalance', 'difference', 'reconciledAt', 'note'],
        rows: rows.map((row) => [
          row.id,
          row.accountId,
          moneyToString(row.statementBalance),
          moneyToString(row.computedBalance),
          moneyToString(row.difference),
          dateOnly(row.reconciledAt, context.timezone),
          row.note,
        ]),
      };
    }

    case 'exchange_rates': {
      // 汇率是全局系统参考数据：导出的是「当时的快照」，不是用户私有数据
      const rows = await prisma.exchangeRate.findMany({
        orderBy: [{ baseCurrency: 'asc' }, { quoteCurrency: 'asc' }, { rateDate: 'asc' }],
        select: { id: true, baseCurrency: true, quoteCurrency: true, rate: true, rateDate: true, source: true },
      });

      return {
        name: 'exchange_rates.csv',
        header: ['id', 'baseCurrency', 'quoteCurrency', 'rate', 'rateDate', 'source'],
        rows: rows.map((row) => [
          row.id,
          row.baseCurrency,
          row.quoteCurrency,
          moneyToString(row.rate),
          dateOnly(row.rateDate, context.timezone),
          row.source,
        ]),
      };
    }

    case 'valuations': {
      const rows = await prisma.portfolioValuation.findMany({
        where: {
          userId: context.userId,
          ...(context.from || context.to
            ? { valuationDate: { ...(context.from ? { gte: context.from } : {}), ...(context.to ? { lte: context.to } : {}) } }
            : {}),
        },
        orderBy: { valuationDate: 'asc' },
        select: { id: true, portfolioId: true, valuationDate: true, marketValue: true, source: true, note: true },
      });

      return {
        name: 'valuations.csv',
        header: ['id', 'portfolioId', 'valuationDate', 'marketValue', 'source', 'note'],
        rows: rows.map((row) => [
          row.id,
          row.portfolioId,
          dateOnly(row.valuationDate, context.timezone),
          moneyToString(row.marketValue),
          row.source,
          row.note,
        ]),
      };
    }

    case 'simulation_scenarios': {
      const [compound, monteCarlo] = await Promise.all([
        prisma.simulationScenario.findMany({
          where: { userId: context.userId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, createdAt: true },
        }),
        prisma.monteCarloScenario.findMany({
          where: { userId: context.userId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, currency: true, years: true, pathCount: true, modelVersion: true, createdAt: true },
        }),
      ]);

      return {
        name: 'simulations.csv',
        header: ['kind', 'id', 'name', 'currency', 'years', 'pathCount', 'modelVersion', 'createdAt'],
        rows: [
          ...compound.map((row) => ['compound', row.id, row.name, null, null, null, null, iso(row.createdAt)]),
          ...monteCarlo.map((row) => [
            'monte-carlo',
            row.id,
            row.name,
            row.currency,
            row.years,
            row.pathCount,
            row.modelVersion,
            iso(row.createdAt),
          ]),
        ],
      };
    }

    case 'goals': {
      const rows = await prisma.financialGoal.findMany({
        where: { userId: context.userId, ...(context.includeArchived ? {} : { status: { not: 'archived' } }) },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          type: true,
          targetAmount: true,
          currency: true,
          targetDate: true,
          startedAt: true,
          initialAmount: true,
          inflationAdjusted: true,
          inflationRate: true,
          expectedAnnualReturn: true,
          monthlyContribution: true,
          fundingSource: true,
          accountId: true,
          portfolioId: true,
          priority: true,
          status: true,
          achievedAt: true,
          note: true,
        },
      });

      return {
        name: 'goals.csv',
        header: [
          'id', 'name', 'type', 'targetAmount', 'currency', 'targetDate', 'startedAt', 'initialAmount',
          'inflationAdjusted', 'inflationRate', 'expectedAnnualReturn', 'monthlyContribution',
          'fundingSource', 'accountId', 'portfolioId', 'priority', 'status', 'achievedAt', 'note',
        ],
        rows: rows.map((row) => [
          row.id,
          row.name,
          row.type,
          moneyToString(row.targetAmount),
          row.currency,
          dateOnly(row.targetDate, context.timezone),
          dateOnly(row.startedAt, context.timezone),
          moneyToString(row.initialAmount),
          row.inflationAdjusted,
          row.inflationRate ? moneyToString(row.inflationRate) : null,
          row.expectedAnnualReturn ? moneyToString(row.expectedAnnualReturn) : null,
          row.monthlyContribution ? moneyToString(row.monthlyContribution) : null,
          row.fundingSource,
          row.accountId,
          row.portfolioId,
          row.priority,
          row.status,
          dateOnly(row.achievedAt, context.timezone),
          row.note,
        ]),
      };
    }

    case 'reports': {
      const rows = await prisma.report.findMany({
        where: { userId: context.userId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          title: true,
          rangeFrom: true,
          rangeTo: true,
          currency: true,
          rowCount: true,
          generatedAt: true,
        },
      });

      return {
        name: 'reports_index.csv',
        header: ['id', 'type', 'title', 'rangeFrom', 'rangeTo', 'currency', 'rowCount', 'generatedAt'],
        rows: rows.map((row) => [
          row.id,
          row.type,
          row.title,
          dateOnly(row.rangeFrom, context.timezone),
          dateOnly(row.rangeTo, context.timezone),
          row.currency,
          row.rowCount,
          iso(row.generatedAt),
        ]),
      };
    }

    case 'settings': {
      const settings = await prisma.userSettings.findUnique({
        where: { userId: context.userId },
        select: {
          baseCurrency: true,
          timezone: true,
          dateFormat: true,
          theme: true,
          language: true,
          simulationDefaults: true,
        },
      });

      return {
        name: 'settings.csv',
        header: SETTINGS_HEADER,
        rows: settings
          ? [[
              settings.baseCurrency,
              settings.timezone,
              settings.dateFormat,
              settings.theme,
              settings.language,
              settings.simulationDefaults ? JSON.stringify(settings.simulationDefaults) : null,
            ]]
          : [],
      };
    }

    case 'report_data': {
      // 报表的冻结数据单独成文件，不与索引混在一张表里
      const rows = await prisma.report.findMany({
        where: { userId: context.userId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, type: true, data: true },
      });

      return {
        name: 'report_data.csv',
        header: ['id', 'type', 'dataJson'],
        rows: rows.map((row) => [row.id, row.type, JSON.stringify(row.data)]),
      };
    }

    default:
      throw new Error(`未知数据集：${dataset}`);
  }
}

/** 导出包的完整性声明，结构与报表口径的 completeness 对齐 */
export async function buildExportCompleteness(
  prisma: PrismaClient,
  context: ExportContext,
): Promise<Record<string, unknown>> {
  const [missing, stale, rateLag] = await Promise.all([
    findMissingMonths(prisma, { userId: context.userId, timezone: context.timezone, baseCurrency: context.baseCurrency }),
    findStaleValuations(prisma, { userId: context.userId, timezone: context.timezone, baseCurrency: context.baseCurrency }),
    findRateLag(prisma, { userId: context.userId, timezone: context.timezone, baseCurrency: context.baseCurrency }),
  ]);

  const unpriced = await loadAllPortfolioValuations(prisma, {
    userId: context.userId,
    asOf: new Date(),
  });

  const unpricedSymbols = [...new Set(unpriced.flatMap((item) => item.missingSymbols))];

  return {
    isComplete: missing.months.length === 0 && stale.total === 0 && rateLag.total === 0,
    missingMonths: missing.months,
    staleValuations: stale.total,
    rateLagPairs: rateLag.items.map((item) => `${item.from}/${item.to}`),
    unpricedSymbols,
  };
}
