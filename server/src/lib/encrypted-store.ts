import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config/env.js';

/**
 * 通用加密文件存储。
 *
 * 与账单文件共用同一套 AES-256-GCM 口径，但位于独立子目录：
 * 账单文件是「导入原始凭证」，导出与备份是「用户数据产物」，
 * 混在一个目录下会让清理策略与权限判断纠缠在一起。
 *
 * IV（12 字节）与认证标签（16 字节）拼在密文头部，不为两个定长值再加表列。
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY = Buffer.from(env.FILE_ENCRYPTION_KEY, 'base64');
const ROOT = resolve(process.cwd(), env.FILE_STORAGE_DIR);

export const PURGED_KEY = 'purged';

export interface SaveOptions {
  /** 子目录，例如 exports / backups */
  namespace: string;
  userId: string;
  artifactId: string;
  /** 文件扩展名，默认 .bin */
  extension?: string;
}

function absolutePath(storageKey: string): string {
  const path = resolve(ROOT, storageKey);
  if (!path.startsWith(ROOT)) throw new Error('非法的存储路径');
  return path;
}

/** AAD 绑定用户与产物 ID：文件被挪到别的用户或别的记录下会解密失败 */
function buildAad(userId: string, artifactId: string): Buffer {
  return Buffer.from(`${userId}:${artifactId}`, 'utf8');
}

export async function saveArtifact(
  buffer: Buffer,
  options: SaveOptions,
): Promise<{ storageKey: string; size: number }> {
  const storageKey = join(options.namespace, options.userId, `${options.artifactId}${options.extension ?? '.bin'}`);
  const target = absolutePath(storageKey);

  await mkdir(dirname(target), { recursive: true, mode: 0o700 });

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  cipher.setAAD(buildAad(options.userId, options.artifactId));

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, tag, encrypted]);
  await writeFile(target, payload, { mode: 0o600 });

  return { storageKey, size: payload.length };
}

/** 读取密文原样字节：下载备份文件时使用，解密只发生在服务端恢复流程内 */
export async function readArtifactRaw(storageKey: string): Promise<Buffer> {
  if (storageKey === PURGED_KEY) throw new Error('文件已被保留策略清理');
  return readFile(absolutePath(storageKey));
}

/** 读取并解密；密钥错误或文件被截断时抛出，调用方据此返回解密失败 */
export async function readArtifact(
  storageKey: string,
  userId: string,
  artifactId: string,
): Promise<Buffer> {
  if (storageKey === PURGED_KEY) throw new Error('文件已被保留策略清理');

  const payload = await readFile(absolutePath(storageKey));
  if (payload.length < IV_BYTES + TAG_BYTES) throw new Error('文件被截断');

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAAD(buildAad(userId, artifactId));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export async function deleteArtifact(storageKey: string): Promise<void> {
  if (storageKey === PURGED_KEY) return;
  await rm(absolutePath(storageKey), { force: true });
}
