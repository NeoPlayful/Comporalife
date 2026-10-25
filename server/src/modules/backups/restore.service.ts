import type { Prisma, PrismaClient } from '@prisma/client';
import { RESTORE_PREVIEW_LIMIT } from '../../config/constants.js';
import { errors } from '../../lib/errors.js';
import { BACKUP_DOMAINS, RESTORE_ORDER, type BackupDomain, type BackupPackage } from './backup.package.js';

export type ConflictPolicy = 'skip' | 'overwrite';

export interface DomainImpact {
  domain: BackupDomain;
  insert: number;
  overwrite: number;
  conflict: number;
  skip: number;
}

export interface RestorePreview {
  backupId: string;
  schemaVersion: string;
  createdAt: string;
  domains: DomainImpact[];
  conflicts: Array<{ domain: string; key: string; reason: string }>;
  truncated: boolean;
  /** 当前代码有、但该备份包不含的域：旧包恢复后这些模块会为空 */
  missingDomains: BackupDomain[];
  warnings: string[];
  requiresConfirm: string;
}

type Row = Record<string, unknown>;

/** 恢复时显式按域处理：动态委派虽然短，但任何一处字段拼错都会变成静默写错表 */
interface DomainAdapter {
  countById(tx: Prisma.TransactionClient, userId: string, id: string): Promise<boolean>;
  findNatural(tx: Prisma.TransactionClient, userId: string, row: Row): Promise<string | null>;
  deleteById(tx: Prisma.TransactionClient, userId: string, id: string): Promise<void>;
  create(tx: Prisma.TransactionClient, userId: string, row: Row): Promise<void>;
  update(tx: Prisma.TransactionClient, userId: string, id: string, row: Row): Promise<void>;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'voidedAt',
  'openedAt',
  'occurredAt',
  'openingBalanceDate',
  'tradeDate',
  'flowDate',
  'valuationDate',
  'priceDate',
  'reconciledAt',
  'lastAppliedAt',
  'startedAt',
  'targetDate',
  'achievedAt',
  'generatedAt',
  'rangeFrom',
  'rangeTo',
  'lastRestoredAt',
  'expiresAt',
]);

/** 把 JSON 往返的字符串日期还原成 Date，否则会以文本写入 timestamptz 列 */
function reviveDates(row: Row): Row {
  const copy: Row = { ...row };
  for (const key of Object.keys(copy)) {
    if (DATE_FIELDS.has(key)) {
      const parsed = toDate(copy[key]);
      if (parsed) copy[key] = parsed;
    }
  }
  return copy;
}

function withoutKeys(row: Row, keys: string[]): Row {
  const copy: Row = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

const ADAPTERS: Record<BackupDomain, DomainAdapter> = {
  categories: {
    countById: async (tx, userId, id) => (await tx.category.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      const found = await tx.category.findFirst({
        where: { userId, name: String(row.name), kind: row.kind as never },
        select: { id: true },
      });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.category.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      // 父分类可能尚未写入：先置空，后续按 parentId 回补
      await tx.category.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.category.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  tags: {
    countById: async (tx, userId, id) => (await tx.tag.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      const found = await tx.tag.findFirst({ where: { userId, name: String(row.name) }, select: { id: true } });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.tag.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.tag.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.tag.updateMany({ where: { id, userId }, data: withoutKeys(reviveDates(row), ['id', 'userId']) as never });
    },
  },

  accounts: {
    countById: async (tx, userId, id) => (await tx.account.count({ where: { id, userId } })) > 0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.account.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.account.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.account.updateMany({ where: { id, userId }, data: withoutKeys(reviveDates(row), ['id', 'userId']) as never });
    },
  },

  instruments: {
    countById: async (tx, userId, id) => (await tx.instrument.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      const found = await tx.instrument.findFirst({
        where: { userId, symbol: String(row.symbol) },
        select: { id: true },
      });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.instrument.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.instrument.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.instrument.updateMany({ where: { id, userId }, data: withoutKeys(reviveDates(row), ['id', 'userId']) as never });
    },
  },

  portfolios: {
    countById: async (tx, userId, id) => (await tx.portfolio.count({ where: { id, userId } })) > 0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.portfolio.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.portfolio.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.portfolio.updateMany({ where: { id, userId }, data: withoutKeys(reviveDates(row), ['id', 'userId']) as never });
    },
  },

  transactions: {
    countById: async (tx, userId, id) => (await tx.transaction.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      if (!row.externalId) return null;
      const found = await tx.transaction.findFirst({
        where: { userId, externalId: String(row.externalId) },
        select: { id: true },
      });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.transaction.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      // 导入指纹是用户内唯一：恢复旧包时若指纹与现有行冲突，整体会失败。
      // 备份的目标是还原业务事实，指纹只是导入期去重手段，恢复时置空更安全。
      await tx.transaction.create({
        data: { ...reviveDates(row), userId, importFingerprint: null } as never,
      });
    },
    update: async (tx, userId, id, row) => {
      await tx.transaction.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId', 'importFingerprint']) as never,
      });
    },
  },

  entries: {
    countById: async (tx, userId, id) => (await tx.transactionEntry.count({ where: { id, userId } })) > 0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.transactionEntry.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.transactionEntry.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.transactionEntry.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  budgets: {
    countById: async (tx, userId, id) => (await tx.budget.count({ where: { id, userId } })) > 0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.budget.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      const items = Array.isArray(row.items) ? (row.items as Row[]) : [];
      const created = await tx.budget.create({
        data: { ...reviveDates(withoutKeys(row, ['items'])), userId } as never,
        select: { id: true },
      });

      for (const item of items) {
        await tx.budgetItem.create({
          data: {
            ...reviveDates(item),
            userId,
            budgetId: created.id,
          } as never,
        });
      }
    },
    update: async (tx, userId, id, row) => {
      await tx.budget.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId', 'items']) as never,
      });

      const items = Array.isArray(row.items) ? (row.items as Row[]) : [];
      if (items.length === 0) return;

      // 预算项整体替换：部分合并会产生「预算金额对不上明细」的状态
      await tx.budgetItem.deleteMany({ where: { budgetId: id, userId } });
      for (const item of items) {
        await tx.budgetItem.create({ data: { ...reviveDates(item), userId, budgetId: id } as never });
      }
    },
  },

  trades: {
    countById: async (tx, userId, id) => (await tx.portfolioTrade.count({ where: { id, userId } })) > 0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.portfolioTrade.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.portfolioTrade.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.portfolioTrade.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  portfolio_cashflows: {
    countById: async (tx, userId, id) => (await tx.portfolioCashflow.count({ where: { id, userId } })) > 0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.portfolioCashflow.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.portfolioCashflow.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.portfolioCashflow.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  valuations: {
    countById: async (tx, userId, id) => (await tx.portfolioValuation.count({ where: { id, userId } })) > 0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.portfolioValuation.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.portfolioValuation.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.portfolioValuation.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  instrument_prices: {
    countById: async (tx, userId, id) => (await tx.instrumentPrice.count({ where: { id, userId } })) > 0,
    // 同一标的同一天只允许一条价格，按业务键判定冲突
    findNatural: async (tx, userId, row) => {
      const found = await tx.instrumentPrice.findFirst({
        where: {
          userId,
          instrumentId: String(row.instrumentId),
          priceDate: toDate(row.priceDate) ?? undefined,
        },
        select: { id: true },
      });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.instrumentPrice.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.instrumentPrice.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.instrumentPrice.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  portfolio_targets: {
    countById: async (tx, userId, id) => (await tx.portfolioTarget.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      const found = await tx.portfolioTarget.findFirst({
        where: {
          userId,
          portfolioId: String(row.portfolioId),
          dimension: row.dimension as never,
          key: String(row.key),
        },
        select: { id: true },
      });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.portfolioTarget.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.portfolioTarget.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.portfolioTarget.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  classification_rules: {
    countById: async (tx, userId, id) => (await tx.classificationRule.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      const found = await tx.classificationRule.findFirst({
        where: { userId, name: String(row.name) },
        select: { id: true },
      });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.classificationRule.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.classificationRule.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.classificationRule.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  import_templates: {
    countById: async (tx, userId, id) => (await tx.importTemplate.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      const found = await tx.importTemplate.findFirst({
        where: { userId, name: String(row.name) },
        select: { id: true },
      });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.importTemplate.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.importTemplate.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.importTemplate.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  account_reconciliations: {
    countById: async (tx, userId, id) => (await tx.accountReconciliation.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      const found = await tx.accountReconciliation.findFirst({
        where: {
          userId,
          accountId: String(row.accountId),
          reconciledAt: toDate(row.reconciledAt) ?? undefined,
        },
        select: { id: true },
      });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.accountReconciliation.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.accountReconciliation.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.accountReconciliation.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  transaction_tags: {
    // 复合主键表：没有 id 列，存在性按 (transactionId, tagId) 判定
    countById: async (tx, userId, id) => {
      const [transactionId, tagId] = id.split(':');
      if (!transactionId || !tagId) return false;
      return (
        (await tx.transactionTag.count({
          where: { transactionId, tagId, transaction: { userId } },
        })) > 0
      );
    },
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      const [transactionId, tagId] = id.split(':');
      if (!transactionId || !tagId) return;
      await tx.transactionTag.deleteMany({ where: { transactionId, tagId, transaction: { userId } } });
    },
    create: async (tx, userId, row) => {
      // 复合主键表用 onConflictDoNothing 语义：重复绑定不视为错误
      await tx.transactionTag.createMany({
        data: [
          {
            transactionId: String(row.transactionId),
            tagId: String(row.tagId),
          },
        ],
        skipDuplicates: true,
      });
    },
    update: async () => {
      // 关联表没有可更新字段：存在即已建立关联
    },
  },

  simulation_scenarios: {
    countById: async (tx, userId, id) =>
      (await tx.simulationScenario.count({ where: { id, userId } })) +
        (await tx.monteCarloScenario.count({ where: { id, userId } })) >
      0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.simulationScenario.deleteMany({ where: { id, userId } });
      await tx.monteCarloScenario.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      // 两类方案共用一个域：按是否含资产权重区分，避免为一个字段加判别列
      if (Array.isArray(row.assets)) {
        await tx.monteCarloScenario.create({ data: { ...reviveDates(row), userId } as never });
        return;
      }
      await tx.simulationScenario.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      if (Array.isArray(row.assets)) {
        await tx.monteCarloScenario.updateMany({
          where: { id, userId },
          data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
        });
        return;
      }
      await tx.simulationScenario.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  goals: {
    countById: async (tx, userId, id) => (await tx.financialGoal.count({ where: { id, userId } })) > 0,
    findNatural: async (tx, userId, row) => {
      const found = await tx.financialGoal.findFirst({ where: { userId, name: String(row.name) }, select: { id: true } });
      return found?.id ?? null;
    },
    deleteById: async (tx, userId, id) => {
      await tx.financialGoal.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.financialGoal.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.financialGoal.updateMany({
        where: { id, userId },
        data: withoutKeys(reviveDates(row), ['id', 'userId']) as never,
      });
    },
  },

  reports: {
    countById: async (tx, userId, id) => (await tx.report.count({ where: { id, userId } })) > 0,
    findNatural: async () => null,
    deleteById: async (tx, userId, id) => {
      await tx.report.deleteMany({ where: { id, userId } });
    },
    create: async (tx, userId, row) => {
      await tx.report.create({ data: { ...reviveDates(row), userId } as never });
    },
    update: async (tx, userId, id, row) => {
      await tx.report.updateMany({ where: { id, userId }, data: withoutKeys(reviveDates(row), ['id', 'userId']) as never });
    },
  },

  settings: {
    countById: async (tx, userId) => (await tx.userSettings.count({ where: { userId } })) > 0,
    findNatural: async () => null,
    deleteById: async () => {
      // 设置不删除：没有设置时更新即可创建
    },
    create: async (tx, userId, row) => {
      await tx.userSettings.upsert({
        where: { userId },
        create: { ...reviveDates(withoutKeys(row, ['userId'])), userId } as never,
        update: reviveDates(withoutKeys(row, ['userId'])) as never,
      });
    },
    update: async (tx, userId, _id, row) => {
      await tx.userSettings.upsert({
        where: { userId },
        create: { ...reviveDates(withoutKeys(row, ['userId'])), userId } as never,
        update: reviveDates(withoutKeys(row, ['userId'])) as never,
      });
    },
  },
};

export async function previewRestore(
  prisma: PrismaClient,
  params: { userId: string; backupId: string; pkg: BackupPackage },
): Promise<RestorePreview> {
  const domains: DomainImpact[] = [];
  const conflicts: Array<{ domain: string; key: string; reason: string }> = [];
  let truncated = false;

  for (const domain of BACKUP_DOMAINS) {
    const rows = (params.pkg.domains[domain] ?? []) as Row[];
    if (rows.length === 0) continue;

    const adapter = ADAPTERS[domain];
    let insert = 0;
    let overwrite = 0;
    let conflict = 0;

    for (const row of rows) {
      const id = String(row.id ?? '');
      if (id && (await adapter.countById(prisma, params.userId, id))) {
        overwrite += 1;
        continue;
      }

      const natural = await adapter.findNatural(prisma, params.userId, row);
      if (natural) {
        conflict += 1;
        if (conflicts.length < RESTORE_PREVIEW_LIMIT) {
          conflicts.push({ domain, key: `${String(row.name ?? row.symbol ?? row.externalId ?? id)}`, reason: 'existing_different_id' });
        } else {
          truncated = true;
        }
        continue;
      }

      insert += 1;
    }

    domains.push({ domain, insert, overwrite, conflict, skip: conflict });
  }

  // 旧包（v1）不包含后加的域：必须在确认前让用户看到，否则恢复完才发现投资模块是空的
  const missingDomains = BACKUP_DOMAINS.filter(
    (domain) => !Object.prototype.hasOwnProperty.call(params.pkg.domains, domain),
  );

  // 汇率已改为全局系统数据，旧包中的该域既不写入也不当作缺域，必须显式告知
  const hasLegacyRates = Object.prototype.hasOwnProperty.call(params.pkg.domains, 'exchange_rates');

  return {
    backupId: params.backupId,
    schemaVersion: params.pkg.schemaVersion,
    createdAt: params.pkg.createdAt,
    domains,
    conflicts,
    truncated,
    missingDomains,
    warnings: [
      'restore_does_not_delete_current_data',
      'restore_overwrites_only_same_id',
      ...(hasLegacyRates ? ['exchange_rates_moved_to_system'] : []),
      ...missingDomains.map((domain) => `missing_domain:${domain}`),
    ],
    requiresConfirm: 'RESTORE',
  };
}

/**
 * 执行恢复：单事务，失败整体回滚。
 * 只做「按 ID 覆盖或跳过」，不删除备份中不存在的现有数据。
 */
export async function executeRestore(
  prisma: PrismaClient,
  params: { userId: string; pkg: BackupPackage; domains: BackupDomain[]; policy: ConflictPolicy },
): Promise<{ domains: Array<{ domain: BackupDomain; written: number; skipped: number }> }> {
  const requested = new Set(params.domains);
  const ordered = RESTORE_ORDER.filter((domain) => requested.has(domain));
  const summary: Array<{ domain: BackupDomain; written: number; skipped: number }> = [];

  await prisma.$transaction(
    async (tx) => {
      for (const domain of ordered) {
        const rows = (params.pkg.domains[domain] ?? []) as Row[];
        if (rows.length === 0) {
          summary.push({ domain, written: 0, skipped: 0 });
          continue;
        }

        const adapter = ADAPTERS[domain];
        let written = 0;
        let skipped = 0;

        for (const row of rows) {
          const id = String(row.id ?? '');

          // 设置是单行表，没有 ID 语义，直接 upsert
          if (domain === 'settings') {
            await adapter.create(tx, params.userId, row);
            written += 1;
            continue;
          }

          if (await adapter.countById(tx, params.userId, id)) {
            if (params.policy === 'skip') {
              skipped += 1;
              continue;
            }
            await adapter.update(tx, params.userId, id, row);
            written += 1;
            continue;
          }

          const natural = await adapter.findNatural(tx, params.userId, row);
          if (natural) {
            if (params.policy === 'skip') {
              skipped += 1;
              continue;
            }
            await adapter.deleteById(tx, params.userId, natural);
          }

          await adapter.create(tx, params.userId, row);
          written += 1;
        }

        summary.push({ domain, written, skipped });
      }
    },
    { timeout: 120_000 },
  );

  return { domains: summary };
}

export function assertRestorableDomains(domains: string[]): BackupDomain[] {
  if (domains.length === 0) {
    throw errors.restoreParametersInvalid('至少需要选择一个恢复域');
  }

  return domains.map((domain) => {
    if (!BACKUP_DOMAINS.includes(domain as BackupDomain)) {
      throw errors.restoreParametersInvalid(`未知的恢复域：${domain}`);
    }
    return domain as BackupDomain;
  });
}
