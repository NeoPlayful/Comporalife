import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { env, isProduction, isTest } from '../config/env.js';

async function securityPlugin(app: FastifyInstance) {
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: isProduction ? env.APP_BASE_URL : true,
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: [],
    // 集成测试会在短时间内创建大量用户，限流会让测试结果取决于执行顺序
    ...(isTest ? { max: 100_000 } : {}),
  });

  // 认证类接口单独收紧限流，防止暴力破解
  if (!isTest) {
    app.addHook('onRoute', (route) => {
      if (typeof route.url === 'string' && route.url.includes('/auth/')) {
        route.config = {
          ...route.config,
          rateLimit: { max: 20, timeWindow: '1 minute' },
        };
      }
    });
  }
}

export default fp(securityPlugin, { name: 'security' });
