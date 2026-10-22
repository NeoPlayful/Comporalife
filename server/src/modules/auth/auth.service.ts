import { randomBytes } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { env, isProduction } from '../../config/env.js';
import { PASSWORD_RESET_TTL_SECONDS } from '../../config/constants.js';
import { hashToken, signAccessToken } from '../../lib/auth.js';
import { errors } from '../../lib/errors.js';
import { describeClient, newSessionValues } from '../../lib/session.js';
import { CATEGORY_TEMPLATE } from '../categories/category-template.js';

const MAX_ACTIVE_SESSIONS = 10;
const RESET_KEY_PREFIX = 'pwdreset:';

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  role: string;
  status: string;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async register(input: { email: string; password: string; nickname: string }) {
    const email = input.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw errors.emailExists();
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          nickname: input.nickname.trim(),
          role: 'user',
          status: 'active',
          settings: {
            create: {
              baseCurrency: env.DEFAULT_CURRENCY,
              timezone: 'Asia/Shanghai',
              theme: 'dark',
            },
          },
        },
      });

      // 系统预设分类在建号时复制为用户私有数据，避免 userId 可空的权限分支
      for (const [kind, nodes] of Object.entries(CATEGORY_TEMPLATE) as [
        'income' | 'expense',
        (typeof CATEGORY_TEMPLATE)['income'],
      ][]) {
        let sortOrder = 0;
        for (const node of nodes) {
          const parent = await tx.category.create({
            data: { userId: created.id, kind, name: node.name, sortOrder: sortOrder++ },
          });

          let childOrder = 0;
          for (const child of node.children) {
            await tx.category.create({
              data: {
                userId: created.id,
                kind,
                name: child,
                parentId: parent.id,
                sortOrder: childOrder++,
              },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: { userId: created.id, action: 'auth.register', targetType: 'user', targetId: created.id },
      });

      return created;
    });

    return { user: toPublicUser(user) };
  }

  async login(input: {
    email: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ user: PublicUser; accessToken: string; refreshToken: string }> {
    const email = input.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // 邮箱不存在与密码错误返回同一错误，避免账号枚举
    if (!user) {
      throw errors.unauthorized('邮箱或密码错误');
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw errors.unauthorized('邮箱或密码错误');
    }

    if (user.status !== 'active') {
      throw errors.userDisabled();
    }

    const session = newSessionValues();

    await this.prisma.$transaction(async (tx) => {
      // 活跃会话过多时清理最早的一条，避免无限增长
      const activeSessions = await tx.userSession.findMany({
        where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      if (activeSessions.length >= MAX_ACTIVE_SESSIONS) {
        const excess = activeSessions.slice(0, activeSessions.length - MAX_ACTIVE_SESSIONS + 1);
        await tx.userSession.updateMany({
          where: { id: { in: excess.map((s) => s.id) } },
          data: { revokedAt: new Date() },
        });
      }

      const created = await tx.userSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: session.tokenHash,
          userAgent: describeClient(input.userAgent),
          ip: input.ip ?? null,
          expiresAt: session.expiresAt,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), lastLoginIp: input.ip ?? null },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'auth.login',
          targetType: 'session',
          targetId: created.id,
          ip: input.ip ?? null,
        },
      });
    });

    const createdSession = await this.prisma.userSession.findFirst({
      where: { refreshTokenHash: session.tokenHash },
      select: { id: true },
    });

    const accessToken = await signAccessToken({
      sub: user.id,
      role: user.role,
      sessionId: createdSession?.id ?? '',
      sv: user.sessionVersion,
    });

    return { user: toPublicUser(user), accessToken, refreshToken: session.token };
  }

  /** 刷新时轮换令牌：旧令牌立即失效，重放会命中不存在的哈希 */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = hashToken(refreshToken);

    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { user: true },
    });

    if (!session) {
      // 哈希查不到通常说明旧令牌已被轮换：可能是并发请求或另一标签页抢先刷新。
      // 此时浏览器已持有新 Cookie，清除它反而会踢掉有效会话，因此不动 Cookie。
      throw errors.unauthorized('刷新令牌已失效，请重试');
    }

    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw errors.sessionExpired();
    }

    if (session.user.status !== 'active') {
      throw errors.userDisabled();
    }

    const next = newSessionValues();

    await this.prisma.$transaction(async (tx) => {
      await tx.userSession.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: next.tokenHash,
          expiresAt: next.expiresAt,
          lastUsedAt: new Date(),
        },
      });
    });

    const accessToken = await signAccessToken({
      sub: session.user.id,
      role: session.user.role,
      sessionId: session.id,
      sv: session.user.sessionVersion,
    });

    return { accessToken, refreshToken: next.token };
  }

  async logout(refreshToken?: string, sessionId?: string) {
    if (sessionId) {
      await this.prisma.userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }

    if (refreshToken) {
      await this.prisma.userSession.updateMany({
        where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string, currentSessionId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const valid = await argon2.verify(user.passwordHash, oldPassword);
    if (!valid) {
      throw errors.unauthorized('原密码不正确');
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          // 递增会话版本，使所有已签发的访问令牌立即失效
          sessionVersion: { increment: 1 },
        },
      });

      await tx.userSession.updateMany({
        where: { userId, id: { not: currentSessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: { userId, action: 'auth.password_changed', targetType: 'user', targetId: userId },
      });
    });

    return this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  }

  async requestPasswordReset(email: string): Promise<{ token?: string }> {
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });

    // 无论邮箱是否存在都返回相同结果，避免账号枚举
    if (!user || user.status !== 'active') {
      return {};
    }

    if (isProduction && !env.SMTP_HOST) {
      throw errors.mailNotConfigured();
    }

    const token = randomBytes(32).toString('base64url');
    await this.redis.set(`${RESET_KEY_PREFIX}${hashToken(token)}`, user.id, 'EX', PASSWORD_RESET_TTL_SECONDS);

    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'auth.password_reset_requested', targetType: 'user', targetId: user.id },
    });

    // 开发环境不发送邮件，由路由层把链接写入日志；生产环境由 SMTP 发送
    return { token };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const key = `${RESET_KEY_PREFIX}${hashToken(token)}`;
    const userId = await this.redis.get(key);

    if (!userId) {
      throw errors.validation('重置链接无效或已过期');
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      });

      // 重置密码后所有会话失效，要求重新登录
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: { userId, action: 'auth.password_reset', targetType: 'user', targetId: userId },
      });
    });

    // 令牌一次性使用
    await this.redis.del(key);
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });

    return sessions.map((session) => ({
      ...session,
      current: session.id === currentSessionId,
    }));
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw errors.notFound('会话不存在');
    }
  }

  async revokeOtherSessions(userId: string, currentSessionId: string) {
    const result = await this.prisma.userSession.updateMany({
      where: { userId, id: { not: currentSessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count;
  }
}
