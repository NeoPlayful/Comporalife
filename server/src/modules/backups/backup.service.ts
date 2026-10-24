import type { PrismaClient } from '@prisma/client';
import {
  BACKUP_RETENTION_COUNT,
  BACKUP_RETENTION_DAYS,
  BACKUP_SCHEMA_VERSION,
  BACKUP_SUPPORTED_VERSIONS,
} from '../../config/constants.js';
import { deleteArtifact, PURGED_KEY, readArtifact, saveArtifact } from '../../lib/encrypted-store.js';
import { errors } from '../../lib/errors.js';
import { buildBackupPackage, parseBackupPackage, type BackupPackage } from './backup.package.js';

export async function createBackupArtifact(
  prisma: PrismaClient,
  params: { backupId: string; userId: string; baseCurrency: string; includeRates?: boolean },
): Promise<void> {
  const { pkg, sha256 } = await buildBackupPackage(prisma, {
    userId: params.userId,
    baseCurrency: params.baseCurrency,
    includeRates: params.includeRates,
  });

  const serialized = Buffer.from(JSON.stringify(pkg), 'utf8');
  const artifact = await saveArtifact(serialized, {
    namespace: 'backups',
    userId: params.userId,
    artifactId: params.backupId,
    extension: '.json.enc',
  });

  await prisma.backup.update({
    where: { id: params.backupId },
    data: {
      status: 'ready',
      fileKey: artifact.storageKey,
      sizeBytes: BigInt(artifact.size),
      sha256,
      scope: pkg.counts as unknown as object,
      expiresAt: new Date(Date.now() + BACKUP_RETENTION_DAYS * 86_400_000),
    },
  });

  await pruneBackups(prisma, params.userId);
}

/**
 * 读取并校验备份内容。
 * 解密 → 解析 → 校验结构版本 → 校验 sha256：任何一步失败都拒绝继续。
 */
export async function loadVerifiedBackup(
  prisma: PrismaClient,
  params: { userId: string; backupId: string },
): Promise<BackupPackage> {
  const backup = await prisma.backup.findFirst({
    where: { id: params.backupId, userId: params.userId },
    select: { id: true, status: true, fileKey: true, sha256: true },
  });

  if (!backup) throw errors.backupNotFound();
  if (backup.status !== 'ready' || backup.fileKey === PURGED_KEY) {
    throw errors.backupNotReady(backup.status);
  }

  let buffer: Buffer;
  try {
    buffer = await readArtifact(backup.fileKey, params.userId, backup.id);
  } catch {
    throw errors.backupDecryptFailed();
  }

  let parsed;
  try {
    parsed = parseBackupPackage(buffer);
  } catch {
    throw errors.backupCorrupted();
  }

  // 支持列表内的旧版本继续可读：缺域在预览阶段以 warnings 明示，不在这里拒绝
  if (!(BACKUP_SUPPORTED_VERSIONS as readonly string[]).includes(parsed.pkg.schemaVersion)) {
    throw errors.backupVersionUnsupported(parsed.pkg.schemaVersion, BACKUP_SCHEMA_VERSION);
  }

  if (parsed.sha256 !== backup.sha256) {
    throw errors.backupCorrupted();
  }

  return parsed.pkg;
}

/** 保留策略：超出份数或过期都置 expired 并删文件，行本身保留供追溯 */
export async function pruneBackups(prisma: PrismaClient, userId: string): Promise<number> {
  const ready = await prisma.backup.findMany({
    where: { userId, status: 'ready' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, fileKey: true, createdAt: true, expiresAt: true },
  });

  const now = Date.now();
  const toExpire = ready.filter(
    (item, index) => index >= BACKUP_RETENTION_COUNT || (item.expiresAt ? item.expiresAt.getTime() < now : false),
  );

  for (const item of toExpire) {
    if (item.fileKey !== PURGED_KEY) {
      await deleteArtifact(item.fileKey).catch(() => undefined);
    }
    await prisma.backup.update({
      where: { id: item.id },
      data: { status: 'expired', fileKey: PURGED_KEY },
    });
  }

  return toExpire.length;
}
