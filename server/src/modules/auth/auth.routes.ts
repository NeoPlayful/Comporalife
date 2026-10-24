import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE_NAME } from '../../config/constants.js';
import { isProduction } from '../../config/env.js';
import { ok } from '../../lib/api-utils.js';
import { AppError, errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { clearRefreshCookie, setRefreshCookie } from '../../lib/session.js';
import { createNotification } from '../notifications/notification.service.js';
import { isEmailVerificationEnabled, isRegistrationEnabled } from '../settings/system-settings.service.js';
import { AuthService } from './auth.service.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdSchema,
  verifyEmailSchema,
} from './auth.schema.js';

export default async function authRoutes(app: FastifyInstance) {
  const service = new AuthService(app.prisma, app.redis);

  app.post('/register', async (request, reply) => {
    // 注册开关是部署级配置，关闭时直接拒绝，不进入参数校验之后的任何流程
    if (!(await isRegistrationEnabled(app.prisma))) {
      throw errors.registrationDisabled();
    }

    const body = registerSchema.parse(request.body);
    const { user } = await service.register(body);

    // 验证邮件是可选增强：开关关闭或 SMTP 未配置时静默跳过，绝不影响注册结果
    if (await isEmailVerificationEnabled(app.prisma)) {
      void service.sendVerificationEmail(user.id, request.log).catch((err) => {
        request.log.warn({ err }, '注册验证邮件发送失败');
      });
    }

    // 注册后直接进入已登录状态
    const login = await service.login({
      email: body.email,
      password: body.password,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    setRefreshCookie(reply, login.refreshToken);

    return reply.status(201).send(
      ok({ user, accessToken: login.accessToken }, request.id),
    );
  });

  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await service.login({
      ...body,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    setRefreshCookie(reply, result.refreshToken);

    return ok({ user: result.user, accessToken: result.accessToken }, request.id);
  });

  app.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies[SESSION_COOKIE_NAME];
    if (!refreshToken) {
      clearRefreshCookie(reply);
      throw errors.unauthorized('会话已失效，请重新登录');
    }

    try {
      const result = await service.refresh(refreshToken);
      setRefreshCookie(reply, result.refreshToken);
      return ok({ accessToken: result.accessToken }, request.id);
    } catch (err) {
      // 只有会话确定已撤销或已过期时才清除 Cookie；
      // 令牌哈希查不到可能只是并发轮换，清掉会误伤另一标签页刚写入的有效令牌
      if (err instanceof AppError && err.code === 'SESSION_EXPIRED') {
        clearRefreshCookie(reply);
      }
      throw err;
    }
  });

  app.post('/logout', async (request, reply) => {
    const refreshToken = request.cookies[SESSION_COOKIE_NAME];
    await service.logout(refreshToken);
    clearRefreshCookie(reply);
    return ok({ loggedOut: true }, request.id);
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const { userId } = requireAuth(request);
    const user = await app.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    return ok({ user }, request.id);
  });

  app.post('/change-password', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request);
    const body = changePasswordSchema.parse(request.body);

    // 改密后 sessionVersion 递增，当前访问令牌随之失效，需要重新登录
    await service.changePassword(auth.userId, body.oldPassword, body.newPassword, auth.sessionId);

    return ok({ changed: true, requiresReauth: true }, request.id);
  });

  app.post('/forgot-password', async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    const { link } = await service.requestPasswordReset(body.email, request.log);

    // 未真正投递时（开发环境无 SMTP、或测试）把链接写日志，便于本地走完流程
    if (link && !isProduction) {
      request.log.info({ resetUrl: link }, '开发环境密码重置链接');
    }

    return reply.status(202).send(
      ok({ message: '若该邮箱已注册，重置链接已发送' }, request.id),
    );
  });

  app.post('/reset-password', async (request) => {
    const body = resetPasswordSchema.parse(request.body);
    await service.resetPassword(body.token, body.newPassword);
    return ok({ reset: true }, request.id);
  });

  app.post('/verify-email', async (request) => {
    if (!(await isEmailVerificationEnabled(app.prisma))) {
      throw errors.emailVerificationDisabled();
    }

    const body = verifyEmailSchema.parse(request.body);
    const { userId } = await service.verifyEmail(body.token);

    await createNotification(app.prisma, {
      userId,
      kind: 'email_verified',
      metadata: {},
      link: '/profile',
    });

    return ok({ verified: true }, request.id);
  });

  app.post('/resend-verification', { preHandler: app.authenticate }, async (request) => {
    if (!(await isEmailVerificationEnabled(app.prisma))) {
      throw errors.emailVerificationDisabled();
    }

    const auth = requireAuth(request);
    const { link } = await service.resendVerification(auth.userId, request.log);

    // 与密码重置一致：未真正投递时才在非生产环境把链接写日志
    if (link && !isProduction) {
      request.log.info({ verifyUrl: link }, '开发环境邮箱验证链接');
    }

    return ok({ sent: true }, request.id);
  });

  app.get('/sessions', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request);
    const sessions = await service.listSessions(auth.userId, auth.sessionId);
    return ok({ sessions }, request.id);
  });

  app.delete('/sessions/:id', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request);
    const params = sessionIdSchema.parse(request.params);
    await service.revokeSession(auth.userId, params.id);
    return ok({ revoked: true }, request.id);
  });

  app.delete('/sessions', { preHandler: app.authenticate }, async (request) => {
    const auth = requireAuth(request);
    const count = await service.revokeOtherSessions(auth.userId, auth.sessionId);
    return ok({ revokedCount: count }, request.id);
  });
}
