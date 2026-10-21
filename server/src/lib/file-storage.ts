import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

const KEY = Buffer.from(env.FILE_ENCRYPTION_KEY, 'base64');
const ROOT = resolve(process.cwd(), env.FILE_STORAGE_DIR);

/** 批次文件被清理后存储键置为该值，避免与「文件从未写入」混淆 */
export const PURGED_KEY = 'purged';

export interface StoredFile {
  storageKey: string;
  iv: string;
  tag: string;
  size: number;
  sha256: string;
}

export interface StoredFileRef {
  storageKey: string;
  iv: string;
  tag: string;
}

function absolutePath(storageKey: string): string {
  // 存储键由服务端生成（userId/batchId.bin），此处仍做一次越界校验
  const path = resolve(ROOT, storageKey);
  if (!path.startsWith(ROOT)) {
    throw new Error('非法的存储路径');
  }
  return path;
}

/**
 * AAD 绑定用户与批次，文件被移动到其他批次时解密失败，
 * 防止通过替换文件绕过归属校验。
 */
function buildAad(userId: string, batchId: string): Buffer {
  return Buffer.from(`${userId}:${batchId}`, 'utf8');
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function saveEncrypted(buffer: Buffer, userId: string, batchId: string): Promise<StoredFile> {
  const storageKey = join('imports', userId, `${batchId}.bin`);
  const target = absolutePath(storageKey);

  await mkdir(dirname(target), { recursive: true, mode: 0o700 });

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  cipher.setAAD(buildAad(userId, batchId));

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  await writeFile(target, encrypted, { mode: 0o600 });

  return {
    storageKey,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    size: buffer.length,
    sha256: sha256Hex(buffer),
  };
}

export async function readEncrypted(ref: StoredFileRef, userId: string, batchId: string): Promise<Buffer> {
  if (ref.storageKey === PURGED_KEY) {
    throw new Error('原始账单文件已按保留策略清理');
  }

  const encrypted = await readFile(absolutePath(ref.storageKey));

  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ref.iv, 'base64'));
  decipher.setAAD(buildAad(userId, batchId));
  decipher.setAuthTag(Buffer.from(ref.tag, 'base64'));

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export async function deleteStored(storageKey: string): Promise<void> {
  if (storageKey === PURGED_KEY) return;
  await rm(absolutePath(storageKey), { force: true });
}
