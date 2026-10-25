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
 * 汇率已全局化，测试之间必须清空，否则上一个用例的汇率会让「缺少汇率」类断言失效。
 *
 * 传入 `codes` 时只清理涉及这些币种的行：并行执行的其他套件可能正在使用其他币种对，
 * 全表删除会把它们正在写入的数据一起抹掉。
 */
export async function clearExchangeRates(app: FastifyInstance, codes?: string[]) {
  if (!codes || codes.length === 0) {
    await app.prisma.exchangeRate.deleteMany({});
    return;
  }
  await app.prisma.exchangeRate.deleteMany({
    where: {
      OR: [{ baseCurrency: { in: codes } }, { quoteCurrency: { in: codes } }],
    },
  });
}
