import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
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
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import dashboardRoutes from './modules/analytics/dashboard.routes.js';
import budgetsRoutes from './modules/budgets/budgets.routes.js';
import portfoliosRoutes from './modules/portfolios/portfolios.routes.js';
import tradesRoutes from './modules/portfolios/trades.routes.js';
import categoriesRoutes from './modules/categories/categories.routes.js';
import currenciesRoutes from './modules/currencies/currencies.routes.js';
import importsRoutes from './modules/imports/imports.routes.js';
import importsCommitRoutes from './modules/imports/imports.commit.routes.js';
import templatesRoutes from './modules/imports/templates.routes.js';
import rulesRoutes from './modules/rules/rules.routes.js';
import ledgerRoutes from './modules/ledger/ledger.routes.js';
import matchRoutes from './modules/ledger/match.routes.js';
import profileRoutes from './modules/profile/profile.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import simulationsRoutes from './modules/simulations/simulations.routes.js';
import monteCarloRoutes from './modules/simulations/monte-carlo/monte-carlo.routes.js';
import { JobExecutor } from './modules/jobs/job.executor.js';
import { createMonteCarloHandler } from './modules/simulations/monte-carlo/monte-carlo.handler.js';
import tagsRoutes from './modules/tags/tags.routes.js';
import systemRoutes from './routes/system.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** 异步作业执行器；仅在启用 prisma 时存在 */
    jobs: JobExecutor;
  }
}

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

  await app.register(multipart, {
    limits: {
      // 只允许单文件，大小上限与导入配置保持一致
      files: 1,
      fileSize: env.IMPORT_MAX_FILE_MB * 1024 * 1024,
      fields: 10,
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

  // 作业执行器依附于 prisma：没有数据库时无法领取与落库，测试可按需关闭
  if (withPrisma) {
    const executor = new JobExecutor(app.prisma, app.log);
    executor.register('monte-carlo', createMonteCarloHandler(app.prisma));
    app.decorate('jobs', executor);
    app.addHook('onClose', async () => {
      executor.stop();
      await executor.drain(5_000);
    });
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
    await app.register(matchRoutes, { prefix: API_PREFIX });
    await app.register(currenciesRoutes, { prefix: API_PREFIX });
    await app.register(dashboardRoutes, { prefix: API_PREFIX });
    await app.register(analyticsRoutes, { prefix: API_PREFIX });
    await app.register(budgetsRoutes, { prefix: API_PREFIX });
    await app.register(portfoliosRoutes, { prefix: API_PREFIX });
    await app.register(tradesRoutes, { prefix: API_PREFIX });
    await app.register(simulationsRoutes, { prefix: API_PREFIX });
    await app.register(monteCarloRoutes, { prefix: API_PREFIX });
    // 模板路由必须先于 /imports/:id 注册，否则会被参数路由吞掉
    await app.register(templatesRoutes, { prefix: API_PREFIX });
    await app.register(importsRoutes, { prefix: API_PREFIX });
    await app.register(importsCommitRoutes, { prefix: API_PREFIX });
    await app.register(rulesRoutes, { prefix: API_PREFIX });
  }

  Object.defineProperty(app, 'sessionCookieName', { value: SESSION_COOKIE_NAME });

  return app;
}
