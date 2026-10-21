import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { errors } from '../../lib/errors.js';
import { saveEncrypted, sha256Hex } from '../../lib/file-storage.js';
import { parseFile, ParseError, type ParsedFile } from './parser/index.js';

const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export interface UploadOptions {
  accountId: string;
  encoding?: 'utf-8' | 'gb18030';
  sheetName?: string;
  originalFilename: string;
  force: boolean;
}

export interface PreparedUpload {
  format: 'csv' | 'xlsx';
  parsed: ParsedFile;
  sha256: string;
  fileSize: number;
}

export function detectFormat(filename: string, buffer: Buffer): 'csv' | 'xlsx' {
  const lower = filename.toLowerCase();
  const isZip = buffer.subarray(0, 4).equals(XLSX_SIGNATURE);

  if (lower.endsWith('.xlsx')) {
    if (!isZip) throw errors.importFormatUnsupported('文件扩展名为 .xlsx，但内容不是有效的 XLSX');
    return 'xlsx';
  }

  if (lower.endsWith('.csv')) {
    if (isZip) throw errors.importFormatUnsupported('CSV 文件不能是压缩包');
    return 'csv';
  }

  throw errors.importFormatUnsupported('仅支持 .csv 与 .xlsx 文件');
}

export function assertFileSize(buffer: Buffer): void {
  if (buffer.length > env.IMPORT_MAX_FILE_MB * 1024 * 1024) {
    throw errors.importFileTooLarge(env.IMPORT_MAX_FILE_MB);
  }
  if (buffer.length === 0) throw errors.importEmpty();
}

export function parseOrThrow(
  buffer: Buffer,
  format: 'csv' | 'xlsx',
  options: { encoding?: 'utf-8' | 'gb18030'; sheetName?: string },
): ParsedFile {
  try {
    return parseFile({
      buffer,
      format,
      ...(options.encoding ? { encoding: options.encoding } : {}),
      ...(options.sheetName ? { sheetName: options.sheetName } : {}),
      rowLimit: env.IMPORT_MAX_ROWS,
    });
  } catch (err) {
    if (err instanceof ParseError) {
      if (err.reason === 'ROW_LIMIT') throw errors.importRowLimitExceeded(env.IMPORT_MAX_ROWS);
      if (err.reason === 'ENCODING') throw errors.importParseFailed(err.message);
      if (err.reason === 'FORMAT') throw errors.importFormatUnsupported(err.message);
      throw errors.importParseFailed(err.message);
    }
    throw err;
  }
}

/** 校验账户归属与状态，跨用户与不存在统一返回 404 */
export async function requireActiveAccount(
  prisma: PrismaClient,
  userId: string,
  accountId: string,
): Promise<{ id: string; currency: string; name: string }> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true, currency: true, name: true, status: true },
  });

  if (!account) throw errors.notFound('账户不存在');
  if (account.status === 'archived') throw errors.accountArchived();
  return { id: account.id, currency: account.currency, name: account.name };
}

export async function checkDuplicateFile(
  prisma: PrismaClient,
  userId: string,
  sha256: string,
  force: boolean,
): Promise<void> {
  if (force) return;

  const existing = await prisma.importBatch.findFirst({
    where: { userId, fileSha256: sha256, status: 'completed' },
    select: { id: true },
  });

  if (existing) throw errors.importAlreadyUploaded(existing.id);
}

export async function persistEncrypted(
  buffer: Buffer,
  userId: string,
  batchId: string,
): Promise<{ storageKey: string; iv: string; tag: string; sha256: string }> {
  const saved = await saveEncrypted(buffer, userId, batchId);
  return { storageKey: saved.storageKey, iv: saved.iv, tag: saved.tag, sha256: sha256Hex(buffer) };
}
