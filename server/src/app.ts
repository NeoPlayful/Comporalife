import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { API_PREFIX, SESSION_COOKIE_NAME } from './config/constants.js';
import { env } from './config/env.js';
import { loggerOptions } from './lib/logger.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import securityPlugin from './plugins/security.js';
import accountsRoutes from './modules/accounts/accounts.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import dashboardRoutes from './modules/analytics/dashboard.routes.js';
import categoriesRoutes from './modules/categories/categories.routes.js';
import currenciesRoutes from './modules/currencies/currencies.routes.js';
import ledgerRoutes from './modules/ledger/ledger.routes.js';
import profileRoutes from './modules/profile/profile.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import simulationsRoutes from './modules/simulations/simulations.routes.js';
import tagsRoutes from './modules/tags/tags.routes.js';
import systemRoutes from './routes/system.js';

export interface BuildAppOptions {
  /** 测试时可关闭 Redis，避免强依赖外部服务 */
  withRedis?: boolean;
  withPrisma?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { withRedis = true, withPrisma = true } = options;

  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cookie, {
    secret: env.JWT_SECRET,
    hook: 'onRequest',
    parseOptions: {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
    },
  });

  await app.register(securityPlugin);
  await app.register(errorHandlerPlugin);

  if (withPrisma) {
    await app.register(prismaPlugin);
  }

  if (withRedis) {
    await app.register(redisPlugin);
  }

  await app.register(authPlugin);

  await app.register(systemRoutes, { prefix: `${API_PREFIX}/system` });

  if (withPrisma && withRedis) {
    // 业务路由统一挂在 /api 下，认证路由路径不带前缀冒号前缀
    await app.register(authRoutes, { prefix: `${API_PREFIX}/auth` });
    await app.register(profileRoutes, { prefix: API_PREFIX });
    await app.register(settingsRoutes, { prefix: API_PREFIX });
    await app.register(accountsRoutes, { prefix: API_PREFIX });
    await app.register(categoriesRoutes, { prefix: API_PREFIX });
    await app.register(tagsRoutes, { prefix: API_PREFIX });
    await app.register(ledgerRoutes, { prefix: API_PREFIX });
    await app.register(currenciesRoutes, { prefix: API_PREFIX });
    await app.register(dashboardRoutes, { prefix: API_PREFIX });
    await app.register(simulationsRoutes, { prefix: API_PREFIX });
  }

  Object.defineProperty(app, 'sessionCookieName', { value: SESSION_COOKIE_NAME });

  return app;
}
