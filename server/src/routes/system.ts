import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { ok } from '../lib/api-utils.js';

// 版本以 package.json 为唯一来源，避免多处硬编码漂移。
// 运行时相对编译产物读取，构建产物位于 dist/src/routes，向上三级即 server 根目录。
const VERSION = (() => {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
})();

const PHASE = 'phase-1';

export default async function systemRoutes(app: FastifyInstance) {
  // 存活探针：不访问任何外部依赖，用于容器重启判断
  app.get('/health', async (request) => {
    return ok({ status: 'ok', uptime: Math.floor(process.uptime()) }, request.id);
  });

  // 就绪探针：数据库与 Redis 均可用才视为就绪
  app.get('/ready', async (request, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = {};

    try {
      await app.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }

    try {
      await app.redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'fail';
    }

    const ready = Object.values(checks).every((status) => status === 'ok');

    return reply.status(ready ? 200 : 503).send(ok({ status: ready ? 'ready' : 'not_ready', checks }, request.id));
  });

  app.get('/version', async (request) => {
    return ok({ name: 'comporalife', version: VERSION, phase: PHASE, node: process.version }, request.id);
  });

  // 能力声明：前端据此决定是否渲染尚未交付的入口
  app.get('/capabilities', async (request) => {
    return ok(
      {
        phase: PHASE,
        available: ['auth', 'accounts', 'categories', 'tags', 'transactions', 'transfers', 'dashboard', 'exchange-rates', 'compound-simulations'],
        planned: ['imports', 'budgets', 'portfolios', 'monte-carlo', 'goals', 'reports', 'admin'],
        baseCurrencyDefault: env.DEFAULT_CURRENCY,
        maxSimulationYears: 100,
      },
      request.id,
    );
  });
}
