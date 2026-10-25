/**
 * Phase 10 迁移前的安全网。
 *
 * 全局化会删除 user_id 并合并重复行，两者都不可逆。执行前先把全表导出、
 * 把冲突组的取舍全部列出来，事后才有据可查。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const OUT_DIR = resolve(process.cwd(), 'prisma/migrations/20261025090000_phase10_global_exchange_rates');

async function main() {
  const prisma = new PrismaClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  // 迁移前读取：此时 user_id 列还在，但客户端类型已去掉了它，因此走原始 SQL
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      user_id: string;
      base_currency: string;
      quote_currency: string;
      rate: string;
      rate_date: Date;
      source: string;
      created_at: Date;
    }>
  >`SELECT id, user_id, base_currency, quote_currency, rate::text AS rate, rate_date, source::text AS source, created_at
    FROM exchange_rates ORDER BY created_at ASC`;

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.base_currency}|${row.quote_currency}|${row.rate_date.toISOString().slice(0, 10)}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const conflicts = [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      // createdAt 升序，首条即迁移后保留的那条
      const [kept, ...dropped] = list;
      return {
        pair: `${kept!.base_currency}->${kept!.quote_currency}`,
        rateDate: kept!.rate_date.toISOString().slice(0, 10),
        kept: {
          rate: kept!.rate,
          source: kept!.source,
          createdAt: kept!.created_at.toISOString(),
          fromUser: kept!.user_id,
        },
        dropped: dropped.map((row) => ({
          rate: row.rate,
          source: row.source,
          createdAt: row.created_at.toISOString(),
          fromUser: row.user_id,
        })),
      };
    });

  const report = {
    generatedAt: new Date().toISOString(),
    totalRowsBefore: rows.length,
    uniqueKeys: groups.size,
    conflictGroups: conflicts.length,
    droppedRows: conflicts.reduce((sum, item) => sum + item.dropped.length, 0),
    conflicts,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const backupPath = resolve(OUT_DIR, `exchange_rates-backup-${stamp}.json`);
  const reportPath = resolve(OUT_DIR, `migration-report-${stamp}.json`);

  await writeFile(backupPath, JSON.stringify(rows, null, 2), 'utf8');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`导出 ${rows.length} 行 → ${backupPath}`);
  console.log(`冲突报告：${conflicts.length} 组，丢弃 ${report.droppedRows} 行 → ${reportPath}`);
  console.log(`迁移后应有 ${groups.size} 行`);

  await prisma.$disconnect();
}

void main();
