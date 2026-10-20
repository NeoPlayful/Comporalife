import { createHash, randomBytes } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  sessionId: string;
  sv: number;
}

const secretKey = new TextEncoder().encode(env.JWT_SECRET);

function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit!] ?? 60);
}

export const ACCESS_TTL_SECONDS = ttlToSeconds(env.SESSION_ACCESS_TTL);
export const REFRESH_TTL_SECONDS = ttlToSeconds(env.SESSION_REFRESH_TTL);

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role, sessionId: payload.sessionId, sv: payload.sv })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secretKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });

  const sub = payload.sub;
  const role = payload.role;
  const sessionId = payload.sessionId;
  const sv = payload.sv;

  if (typeof sub !== 'string' || typeof sessionId !== 'string' || typeof sv !== 'number') {
    throw new Error('令牌载荷不完整');
  }

  return { sub, role: role as UserRole, sessionId, sv };
}

/** 生成刷新令牌明文；仅哈希入库，明文只出现在 Cookie 中 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const REFRESH_COOKIE_PATH = '/api/auth';
