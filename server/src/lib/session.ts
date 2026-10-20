import type { FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { SESSION_COOKIE_NAME } from '../config/constants.js';
import {
  REFRESH_COOKIE_PATH,
  REFRESH_TTL_SECONDS,
  generateRefreshToken,
  hashToken,
} from './auth.js';

export function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_SECONDS,
  });
}

export function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  });
}

export function newSessionValues() {
  const token = generateRefreshToken();
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  };
}

/** 只记录设备与来源的粗粒度信息，便于用户识别会话 */
export function describeClient(userAgent?: string): string | null {
  if (!userAgent) return null;
  return userAgent.slice(0, 180);
}
