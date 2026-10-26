import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * 入库密钥的加解密。
 *
 * 复用 FILE_ENCRYPTION_KEY，但走独立模块而不是打包文件那套 API：
 * 那一套以「用户 + 产物」作为 AAD 并落在磁盘上，这里加密的是短字符串、
 * 存在数据库列里，两者的绑定维度不同。
 *
 * AAD 绑定「用途」而不是记录 ID：配置只有一行，如果绑定行 ID，
 * 一旦重建这一行旧密文就再也解不开，管理员必须重新输入密钥。
 * 绑定用途可以防止把这里产出的密文挪到别的配置字段上使用。
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY = Buffer.from(env.FILE_ENCRYPTION_KEY, 'base64');

function buildAad(purpose: string): Buffer {
  return Buffer.from(`secret:${purpose}`, 'utf8');
}

/** 返回 base64(iv | tag | ciphertext)，可直接存进 JSON 列 */
export function sealSecret(plaintext: string, purpose: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  cipher.setAAD(buildAad(purpose));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

/**
 * 解密失败返回 null 而不是抛出。
 *
 * 密文可能因为换过 FILE_ENCRYPTION_KEY、被手工改过或从别的字段挪过来而解不开；
 * 这些情况下同步应当表现为「未配置密钥」，由管理员重新输入，而不是让
 * 状态接口 500。
 */
export function openSecret(payload: string, purpose: string): string | null {
  let raw: Buffer;
  try {
    raw = Buffer.from(payload, 'base64');
  } catch {
    return null;
  }
  if (raw.length < IV_BYTES + TAG_BYTES) return null;

  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = raw.subarray(IV_BYTES + TAG_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAAD(buildAad(purpose));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * 回显用的密钥提示。
 *
 * 只在密钥足够长时给出末四位：短密钥露出末四位等于泄露大半，
 * 因此短于 12 位一律整串遮蔽。
 */
export function keyHint(plaintext: string): string {
  const value = plaintext.trim();
  if (value.length === 0) return '';
  if (value.length < 12) return '••••';
  return `••••${value.slice(-4)}`;
}

/** 常数时间比较，供需要校验「密钥是否变化」的场景使用 */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
