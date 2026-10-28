import type { FastifyInstance } from 'fastify';

export const TEST_PASSWORD = 'TestPass123';

/** 每个测试文件用自己的域，避免并行执行时 cleanup 互相删除 */
export function testDomain(suite: string): string {
  return `@${suite}-test.local`;
}

export async function cleanupUsers(app: FastifyInstance, domain: string) {
  await app.prisma.user.deleteMany({ where: { email: { endsWith: domain } } });
}

export async function createUser(
  app: FastifyInstance,
  domain: string,
  prefix = 'user',
): Promise<{ token: string; userId: string; email: string }> {
  const email = `${prefix}-${Math.random().toString(36).slice(2, 10)}${domain}`;

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: TEST_PASSWORD, nickname: '测试用户' },
  });

  if (res.statusCode !== 201) {
    throw new Error(`创建测试用户失败：${res.statusCode} ${res.body}`);
  }

  const body = res.json();
  return { token: body.data.accessToken, userId: body.data.user.id, email };
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/**
 * 把测试用户提为管理员，并返回重新登录后的 token。
 *
 * 角色变化会递增 sessionVersion，旧 token 立即失效；不重新登录会一直 403。
 */
export async function promoteToAdmin(
  app: FastifyInstance,
  userId: string,
  role: 'admin' | 'super_admin' = 'admin',
): Promise<string> {
  await app.prisma.user.update({ where: { id: userId }, data: { role } });

  const user = await app.prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: user.email, password: TEST_PASSWORD },
  });
  if (res.statusCode !== 200) {
    throw new Error(`管理员登录失败：${res.statusCode} ${res.body}`);
  }
  return res.json().data.accessToken as string;
}

/**
 * 清理汇率行。
 *
 * 汇率表已全局化，并行执行的套件共用同一张表，因此清理范围必须与「本套件写入什么」
 * 精确对应：
 *
 * - `pairs`：按「基准币在 froms 且计价币在 tos」清理，只删自己造的方向。
 *   两个套件都以 CNY 为对手币时（例如 GBP→CNY 与 EUR→CNY），双向匹配会互相删除，
 *   这类套件必须用这个模式。
 * - `codes`：双向匹配，任一币种出现在任一侧就删除。适合独占若干币种的套件。
 *
 * 两者都不传则清空全表——仅用于串行执行的场景，并行下会误删其他套件的数据。
 *
 * 注意：测试跑在独立的 comporalife_test 库（见 vitest.config.ts），
 * 这里的删除不会影响开发库；但同一轮内并行套件之间仍会互相干扰，
 * 所以上面的作用域限制依旧要遵守。
 */
export async function clearExchangeRates(
  app: FastifyInstance,
  scope?: string[] | { froms: string[]; tos: string[] },
) {
  if (!scope) {
    await app.prisma.exchangeRate.deleteMany({});
    return;
  }

  if (Array.isArray(scope)) {
    await app.prisma.exchangeRate.deleteMany({
      where: {
        OR: [{ baseCurrency: { in: scope } }, { quoteCurrency: { in: scope } }],
      },
    });
    return;
  }

  await app.prisma.exchangeRate.deleteMany({
    where: {
      baseCurrency: { in: scope.froms },
      quoteCurrency: { in: scope.tos },
    },
  });
}
