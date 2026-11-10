import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 复用 tsconfig 的 paths，避免测试解析与类型检查两套配置漂移
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // 限制并行 worker 数：每个 worker 进程独立开一个 Prisma 连接池，
    // 32 核机器默认会开数十个 worker，连接总数轻易超过 PostgreSQL 的
    // max_connections（默认 100），表现为随机 P2037「too many clients」。
    maxWorkers: 6,
    // 通过 vitest 注入到 worker 进程，不依赖开发者本地 .env
    env: {
      NODE_ENV: 'test',
      // 测试必须连独立库：汇率等表是全局共享的，测试套件会整表清理，
      // 指向开发库就会把开发数据删掉。默认库名加 _test 后缀，
      // 需要临时覆盖时可显式传 TEST_DATABASE_URL。
      // connection_limit 限制单个 worker 的连接池上限，与 maxWorkers 一起
      // 保证 6 × 5 = 30 个连接以内，远低于 max_connections。
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://comporalife:comporalife@localhost:5432/comporalife_test?connection_limit=5',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-at-least-32-characters-long',
      LOG_LEVEL: 'fatal',
      // 测试用固定密钥，仅用于本地与 CI，不是生产凭据
      FILE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      FILE_STORAGE_DIR: './data/test-imports',
    },
  },
});
