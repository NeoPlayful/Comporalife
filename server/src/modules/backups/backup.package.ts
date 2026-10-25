import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { BACKUP_SCHEMA_VERSION } from '../../config/constants.js';

/**
 * 备份是逻辑数据包，结构版本随包一起冻结。
 *
 * 与导出不同：导出是给人看的 CSV，备份是给程序原样还原的 JSON。
 * 两者共用「按用户域取数」的思路，但字段与容错策略完全不同——
 * 备份宁可写不进去也不允许写一半。
 */

export type BackupDomain =
  | 'accounts'
  | 'categories'
  | 'tags'
  | 'transactions'
  | 'entries'
  | 'budgets'
  | 'instruments'
  | 'instrument_prices'
  | 'portfolios'
  | 'portfolio_targets'
  | 'trades'
  | 'portfolio_cashflows'
  | 'valuations'
  | 'classification_rules'
  | 'import_templates'
  | 'account_reconciliations'
  | 'transaction_tags'
  | 'simulation_scenarios'
  | 'goals'
  | 'reports'
  | 'settings';

export const BACKUP_DOMAINS = [
  'accounts',
  'categories',
  'tags',
  'transactions',
  'entries',
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
  'account_reconciliations',
  'transaction_tags',
  'simulation_scenarios',
  'goals',
  'reports',
  'settings',
] as const satisfies readonly BackupDomain[];

/** 恢复时按此顺序写入，保证外键依赖先满足 */
export const RESTORE_ORDER: BackupDomain[] = [
  'categories',
  'tags',
  'accounts',
  'instruments',
  'instrument_prices',
  'portfolios',
  'portfolio_targets',
  'transactions',
  'entries',
  'transaction_tags',
  'budgets',
  'trades',
  'portfolio_cashflows',
  'valuations',
  'classification_rules',
  'import_templates',
  'account_reconciliations',
  'simulation_scenarios',
  'goals',
  'reports',
  'settings',
];

export interface BackupPackage {
  schemaVersion: string;
  createdAt: string;
  currency: string;
  domains: Partial<Record<BackupDomain, unknown[]>>;
  counts: Partial<Record<BackupDomain, number>>;
  excluded: string[];
  notes: string[];
}

/**
 * 序列化：金额与比率一律走字符串，不经过浮点。
 * Prisma 的 Decimal 直接 JSON.stringify 会得到字符串，正好符合要求；
 * 但 Date 会被转成 ISO 字符串，恢复时需要显式转回。
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function buildBackupPackage(
  prisma: PrismaClient,
  params: { userId: string; baseCurrency: string; includeRates?: boolean },
): Promise<{ pkg: BackupPackage; sha256: string }> {
  const userId = params.userId;

  const [
    categories,
    tags,
    accounts,
    instruments,
    instrumentPrices,
    portfolios,
    portfolioTargets,
    transactions,
    entries,
    transactionTags,
    budgets,
    trades,
    cashflows,
    valuations,
    classificationRules,
    importTemplates,
    reconciliations,
    simulationScenarios,
    goals,
    reports,
    settings,
  ] = await Promise.all([
    prisma.category.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.tag.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.account.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.instrument.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.instrumentPrice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.portfolio.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.portfolioTarget.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.transactionEntry.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.transactionTag.findMany({ where: { transaction: { userId } }, orderBy: { transactionId: 'asc' } }),
    prisma.budget.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      include: { items: true },
    }),
    prisma.portfolioTrade.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.portfolioCashflow.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.portfolioValuation.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.classificationRule.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.importTemplate.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.accountReconciliation.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    // 模拟只带方案与参数快照，结果体按种子可重算
    prisma.monteCarloScenario.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.financialGoal.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.report.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.userSettings.findMany({ where: { userId } }),
  ]);

  const compoundScenarios = await prisma.simulationScenario.findMany({ where: { userId }, orderBy: { id: 'asc' } });

  // 汇率已是全局系统参考数据（Phase 10）。个人备份不得回滚所有人共用的汇率，
  // 因此该域不再进包；恢复旧包时按「已迁移为系统数据」忽略。
  const domains: Partial<Record<BackupDomain, unknown[]>> = {
    accounts: plain(accounts),
    categories: plain(categories),
    tags: plain(tags),
    transactions: plain(transactions),
    entries: plain(entries),
    // 复合主键表没有 id 列：导出时补一个稳定合成键，恢复时据此判定存在性
    transaction_tags: plain(
      transactionTags.map((row) => ({ id: `${row.transactionId}:${row.tagId}`, ...row })),
    ),
    budgets: plain(budgets),
    instruments: plain(instruments),
    instrument_prices: plain(instrumentPrices),
    portfolios: plain(portfolios),
    portfolio_targets: plain(portfolioTargets),
    classification_rules: plain(classificationRules),
    import_templates: plain(importTemplates),
    account_reconciliations: plain(reconciliations),
    trades: plain(trades),
    portfolio_cashflows: plain(cashflows),
    valuations: plain(valuations),
    simulation_scenarios: plain([...compoundScenarios, ...simulationScenarios]),
    goals: plain(goals),
    reports: plain(
      reports.map((report) => ({
        id: report.id,
        type: report.type,
        title: report.title,
        rangeFrom: report.rangeFrom,
        rangeTo: report.rangeTo,
        currency: report.currency,
        params: report.params,
        basis: report.basis,
        data: report.data,
        rowCount: report.rowCount,
        modelVersions: report.modelVersions,
        generatedAt: report.generatedAt,
      })),
    ),
    settings: plain(settings),
  };

  const counts: Partial<Record<BackupDomain, number>> = {};
  for (const [domain, rows] of Object.entries(domains) as Array<[BackupDomain, unknown[]]>) {
    counts[domain] = rows.length;
  }

  const pkg: BackupPackage = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    currency: params.baseCurrency,
    domains,
    counts,
    excluded: ['original_statement_files', 'password_hash', 'refresh_tokens', 'sessions', 'audit_logs', 'monte_carlo_results'],
    notes: [
      '备份为逻辑数据包，不包含原始账单文件与登录凭据',
      '汇率属于系统参考数据，由后台统一维护，不随个人备份回滚',
      '蒙特卡罗运行只保留方案参数，结果可按种子与模型版本重算',
      '恢复不会删除备份中不存在的现有数据',
    ],
  };

  const serialized = JSON.stringify(pkg);
  const sha256 = createHash('sha256').update(serialized, 'utf8').digest('hex');

  return { pkg, sha256 };
}

export interface ParsedBackup {
  pkg: BackupPackage;
  sha256: string;
}

/** 解析并校验结构：版本不符直接拒绝，不做「尽力而为」的兼容 */
export function parseBackupPackage(buffer: Buffer): ParsedBackup {
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  let pkg: BackupPackage;
  try {
    pkg = JSON.parse(buffer.toString('utf8')) as BackupPackage;
  } catch {
    throw new Error('BACKUP_PARSE_FAILED');
  }

  if (typeof pkg !== 'object' || pkg === null || !pkg.domains || !pkg.schemaVersion) {
    throw new Error('BACKUP_STRUCTURE_INVALID');
  }

  return { pkg, sha256 };
}
