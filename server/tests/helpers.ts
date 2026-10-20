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
