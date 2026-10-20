import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE_NAME } from '../../config/constants.js';
import { isProduction } from '../../config/env.js';
import { ok } from '../../lib/api-utils.js';
import { errors } from '../../lib/errors.js';
import { requireAuth } from '../../plugins/auth.js';
import { clearRefreshCookie, setRefreshCookie } from '../../lib/session.js';
import { AuthService } from './auth.service.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdSchema,
} from './auth.schema.js';

export default async function authRoutes(app: FastifyInstance) {
  const service = new AuthService(app.prisma, app.redis);

  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const { user } = await service.register(body);

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
      // 刷新失败必须清除 Cookie，否则前端会在无效令牌上反复重试
      clearRefreshCookie(reply);
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
    const { token } = await service.requestPasswordReset(body.email);

    // 开发环境把重置链接写入日志，便于本地调试；生产依赖 SMTP
    if (token && !isProduction) {
      request.log.info({ resetUrl: `/reset-password?token=${token}` }, '开发环境密码重置链接');
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
