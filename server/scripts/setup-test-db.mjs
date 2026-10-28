// 初始化测试库：建库（若不存在）+ 跑迁移。
//
// 测试跑在独立库上，因为汇率等表是全局共享的，套件会整表清理；
// 与开发库共用会把开发数据删掉。
//
// 直接调用 Prisma 的 JS 入口而不是 npx：
// Windows 下 spawnSync('npx.cmd') 拿不到 stdout 且退出码为 null，无法判断成败。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prismaBin = require.resolve('prisma/build/index.js');

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://comporalife:comporalife@localhost:5432/comporalife_test';

const url = new URL(TEST_DATABASE_URL);
const dbName = url.pathname.replace(/^\//, '');
if (!dbName) {
  console.error('TEST_DATABASE_URL 里没有库名');
  process.exit(1);
}

url.pathname = '/postgres';
const adminUrl = url.toString();

function runPrisma(args, { input, env } = {}) {
  return spawnSync(process.execPath, [prismaBin, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// CREATE DATABASE 没有 IF NOT EXISTS，重复执行会报 42P04，按幂等处理
const create = runPrisma(['db', 'execute', '--url', adminUrl, '--stdin'], {
  input: `CREATE DATABASE "${dbName}"`,
});
const createErr = create.stderr ?? '';
if (create.status !== 0 && !createErr.includes('already exists') && !createErr.includes('42P04')) {
  console.error(createErr);
  process.exit(create.status ?? 1);
}
console.log(create.status === 0 ? `已创建测试库：${dbName}` : `测试库已存在：${dbName}`);

const migrate = runPrisma(['migrate', 'deploy'], { env: { DATABASE_URL: TEST_DATABASE_URL } });
if (migrate.status !== 0) {
  console.error(migrate.stderr ?? migrate.stdout);
  process.exit(migrate.status ?? 1);
}

console.log(`测试库就绪：${TEST_DATABASE_URL}`);
