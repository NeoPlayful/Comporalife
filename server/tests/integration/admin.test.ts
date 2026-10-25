import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('admin');

let app: FastifyInstance;
let superToken: string;
let superId: string;
let adminToken: string;
let adminId: string;
let userToken: string;
let userId: string;
let originalRegistration: { key: string; value: Prisma.JsonValue } | null = null;

/** 直接改库提权：测试注册接口只能创建 user，管理员必须另行设置 */
async function promote(id: string, role: 'admin' | 'super_admin') {
  await app.prisma.user.update({ where: { id }, data: { role } });
  // 角色变化会递增 sessionVersion，旧 token 立即失效；重新登录拿新 token
  const user = await app.prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: user.email, password: 'TestPass123' },
  });
  return res.json().data.accessToken as string;
}

beforeAll(async () => {
  app = await buildApp();
  // 注册开关是全局配置，测试结束后要还原成本地原值而不是一律删除
  originalRegistration = await app.prisma.systemSetting.findUnique({
    where: { key: 'registration.enabled' },
  });
});

afterAll(async () => {
  if (originalRegistration) {
    await app.prisma.systemSetting.upsert({
      where: { key: 'registration.enabled' },
      create: {
        key: originalRegistration.key,
        value: originalRegistration.value as Prisma.InputJsonValue,
      },
      update: { value: originalRegistration.value as Prisma.InputJsonValue },
    });
  } else {
    await app.prisma.systemSetting.deleteMany({ where: { key: 'registration.enabled' } });
  }
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await app.prisma.systemSetting.deleteMany({ where: { key: 'registration.enabled' } });
  await cleanupUsers(app, DOMAIN);

  const superUser = await createUser(app, DOMAIN, 'super');
  superId = superUser.userId;
  superToken = await promote(superId, 'super_admin');

  const adminUser = await createUser(app, DOMAIN, 'admin');
  adminId = adminUser.userId;
  adminToken = await promote(adminId, 'admin');

  const plain = await createUser(app, DOMAIN, 'plain');
  userId = plain.userId;
  userToken = plain.token;
});

describe('访问控制', () => {
  it('普通用户访问管理接口返回 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/overview',
      headers: auth(userToken),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ADMIN_FORBIDDEN');
  });

  it('普通用户看不到管理员列表', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/admins', headers: auth(userToken) });
    expect(res.statusCode).toBe(403);
  });

  it('admin 访问仅限 super_admin 的接口返回 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/admins', headers: auth(adminToken) });
    expect(res.statusCode).toBe(403);
  });

  it('未登录返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('permissions/me 返回当前管理员可用操作', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions/me', headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe('admin');
    expect(res.json().data.permissions).not.toContain('admins:write');
  });
});

describe('仪表板聚合', () => {
  it('总览只返回聚合计数', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/overview',
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.users.total).toBeGreaterThanOrEqual(3);

    // 不得出现任何账号级明细
    expect(JSON.stringify(data)).not.toContain('@');
  });

  it('注册趋势按日期聚合', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/registrations',
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const points = res.json().data.points as Array<{ date: string; count: number }>;
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('安全与任务聚合返回计数而非明细', async () => {
    const security = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/security',
      headers: auth(adminToken),
    });
    const jobs = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard/jobs',
      headers: auth(adminToken),
    });

    expect(security.statusCode).toBe(200);
    expect(typeof security.json().data.loginCount).toBe('number');
    expect(jobs.statusCode).toBe(200);
    expect(typeof jobs.json().data.active).toBe('number');
  });
});

describe('用户管理', () => {
  it('列表默认脱敏邮箱', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(adminToken) });

    expect(res.statusCode).toBe(200);
    const users = res.json().data.users as Array<{ email: string }>;
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((item) => item.email.includes('***'))).toBe(true);
  });

  it('reveal=true 时返回完整邮箱并写审计', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${userId}?reveal=true`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.email).toContain('@');
    expect(res.json().data.user.email).not.toContain('***');

    // 查看明文账号属于隐私操作，必须留痕，否则谁看过无从追溯
    const log = await app.prisma.auditLog.findFirst({
      where: { userId: adminId, action: 'admin.user_revealed', targetId: userId },
    });
    expect(log).not.toBeNull();
  });

  it('未 reveal 时不写查看审计', async () => {
    await app.inject({
      method: 'GET',
      url: `/api/admin/users/${userId}`,
      headers: auth(adminToken),
    });

    const log = await app.prisma.auditLog.findFirst({
      where: { userId: adminId, action: 'admin.user_revealed' },
    });
    expect(log).toBeNull();
  });

  it('用户列表返回服务端分页信息', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users?page=1&pageSize=2',
      headers: auth(adminToken),
    });

    const pagination = res.json().meta.pagination;
    expect(pagination.page).toBe(1);
    expect(pagination.pageSize).toBe(2);
    expect(pagination.total).toBeGreaterThanOrEqual(3);
    expect(pagination.totalPages).toBeGreaterThanOrEqual(2);
    expect((res.json().data.users as unknown[]).length).toBeLessThanOrEqual(2);
  });

  it('详情不含任何财务字段', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${userId}`,
      headers: auth(adminToken),
    });

    const serialized = JSON.stringify(res.json().data.user).toLowerCase();
    for (const forbidden of ['balance', 'amount', 'portfolio', 'transaction', 'goal', 'report', 'networth', 'expense', 'income']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('按角色筛选生效', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users?role=admin',
      headers: auth(adminToken),
    });

    const users = res.json().data.users as Array<{ role: string }>;
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((item) => item.role === 'admin')).toBe(true);
  });

  it('禁用用户后其 access token 立即失效', async () => {
    const target = await createUser(app, DOMAIN, 'victim');

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/disable`,
      headers: auth(adminToken),
    });
    expect(res.statusCode).toBe(200);

    // sessionVersion 已递增，旧令牌必须被拒
    const me = await app.inject({ method: 'GET', url: '/api/profile', headers: auth(target.token) });
    expect(me.statusCode).toBe(401);

    const updated = await app.prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(updated.status).toBe('disabled');
  });

  it('禁用会撤销全部会话', async () => {
    const target = await createUser(app, DOMAIN, 'revoke-me');

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/disable`,
      headers: auth(adminToken),
    });

    const active = await app.prisma.userSession.count({
      where: { userId: target.userId, revokedAt: null },
    });
    expect(active).toBe(0);
  });

  it('启用后可重新登录', async () => {
    const target = await createUser(app, DOMAIN, 'toggle');

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/disable`,
      headers: auth(adminToken),
    });
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/enable`,
      headers: auth(adminToken),
    });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: target.email, password: 'TestPass123' },
    });

    expect(login.statusCode).toBe(200);
  });

  it('撤销会话后旧 token 失效', async () => {
    const target = await createUser(app, DOMAIN, 'session');

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/revoke-sessions`,
      headers: auth(adminToken),
    });

    const me = await app.inject({ method: 'GET', url: '/api/profile', headers: auth(target.token) });
    expect(me.statusCode).toBe(401);
  });

  it('登录记录只返回网段 IP', async () => {
    const target = await createUser(app, DOMAIN, 'loginlog');

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${target.userId}/login-logs`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    const logs = res.json().data.logs as Array<{ ip: string | null }>;
    expect(logs.every((item) => item.ip === null || item.ip.includes('x'))).toBe(true);
  });

  it('没有申请时不能批准注销', async () => {
    const target = await createUser(app, DOMAIN, 'no-request');

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/deletion-review`,
      headers: auth(adminToken),
      payload: { decision: 'approve' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DELETION_NOT_REVIEWABLE');
  });

  it('冷却期未满时不能批准注销', async () => {
    const target = await createUser(app, DOMAIN, 'cooling');
    await app.inject({
      method: 'POST',
      url: '/api/profile/delete-request',
      headers: auth(target.token),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/deletion-review`,
      headers: auth(adminToken),
      payload: { decision: 'approve' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.reason).toBe('cooling_off_not_elapsed');
  });

  it('冷却期满后批准为软删除，不物理删除', async () => {
    const target = await createUser(app, DOMAIN, 'deletion');
    await app.inject({
      method: 'POST',
      url: '/api/profile/delete-request',
      headers: auth(target.token),
    });

    // 把申请时间回拨到冷却期之前，模拟已满 7 天
    await app.prisma.user.update({
      where: { id: target.userId },
      data: { deletionRequestedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/deletion-review`,
      headers: auth(adminToken),
      payload: { decision: 'approve' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.disposition).toBe('soft_deleted');

    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(row.status).toBe('disabled');
    expect(row.deletedAt).not.toBeNull();
  });

  it('已注销的账号不能被重新启用', async () => {
    // 直接把账号置为已批准注销的状态
    await app.prisma.user.update({
      where: { id: userId },
      data: { status: 'disabled', deletedAt: new Date(), deletionRequestedAt: new Date(Date.now() - 30 * 86_400_000) },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/enable`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.details?.reason).toBe('account_deleted');

    // 状态未被改动
    const user = await app.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });
    expect(user.status).toBe('disabled');
  });

  it('列表返回注销时间供前端区分「已注销」与「已禁用」', async () => {
    const deletedAt = new Date();
    await app.prisma.user.update({
      where: { id: userId },
      data: { status: 'disabled', deletedAt },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(adminToken) });
    const users = res.json().data.users as Array<{ id: string; deletedAt: string | null }>;
    const target = users.find((item) => item.id === userId);

    expect(target?.deletedAt).toBeTruthy();
  });

  it('驳回注销申请会清空申请时间', async () => {
    const target = await createUser(app, DOMAIN, 'reject');
    await app.inject({
      method: 'POST',
      url: '/api/profile/delete-request',
      headers: auth(target.token),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/deletion-review`,
      headers: auth(adminToken),
      payload: { decision: 'reject' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.decision).toBe('reject');

    const row = await app.prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
    expect(row.deletionRequestedAt).toBeNull();
    expect(row.status).toBe('active');
  });
});

describe('权限保护', () => {
  it('不能禁用自己', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${adminId}/disable`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ADMIN_SELF_MODIFICATION');
  });

  it('不能给自己授予管理员权限', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/admins/${superId}/grant`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ADMIN_SELF_MODIFICATION');
  });

  it('不能撤销自己的权限', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/admins/${superId}/revoke`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(422);
  });

  it('管理员不能禁用唯一的超级管理员', async () => {
    // 开发库里可能存在真实超管，降级范围必须可回滚，否则跑测试会破坏本地账号
    const others = await app.prisma.user.findMany({
      where: { role: 'super_admin', id: { not: superId } },
      select: { id: true },
    });
    const otherIds = others.map((item) => item.id);

    try {
      if (otherIds.length > 0) {
        await app.prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { role: 'user' } });
      }

      // admin 有禁用账号的权限，但目标是最后一位超管时必须被拦住
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${superId}/disable`,
        headers: auth(adminToken),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('ADMIN_LAST_SUPER_ADMIN');
      expect((await app.prisma.user.findUniqueOrThrow({ where: { id: superId } })).status).toBe('active');
    } finally {
      if (otherIds.length > 0) {
        await app.prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { role: 'super_admin' } });
      }
    }
  });

  it('存在多个超管时可以正常降级其中一个', async () => {
    const second = await createUser(app, DOMAIN, 'second-super');
    await app.prisma.user.update({ where: { id: second.userId }, data: { role: 'super_admin' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/admins/${second.userId}/revoke`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(200);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: second.userId } })).role).toBe('user');
  });

  it('授予管理员后旧 token 因 sessionVersion 递增而失效', async () => {
    const target = await createUser(app, DOMAIN, 'become-admin');

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/admins/${target.userId}/grant`,
      headers: auth(superToken),
    });
    expect(res.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/profile', headers: auth(target.token) });
    expect(me.statusCode).toBe(401);
  });
});

describe('管理员检索', () => {
  it('按邮箱片段检索候选账号并返回完整邮箱', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users/search?query=plain',
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(200);
    const users = res.json().data.users as Array<{ email: string }>;
    expect(users.length).toBeGreaterThan(0);
    // 提权前必须能确认对象是谁，因此这里不脱敏
    expect(users.some((item) => item.email.includes('@') && !item.email.includes('***'))).toBe(true);
  });

  it('检索写审计，且审计里不记录检索词', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/admin/users/search?query=plain',
      headers: auth(superToken),
    });

    const log = await app.prisma.auditLog.findFirstOrThrow({
      where: { userId: superId, action: 'admin.user_searched' },
    });
    // 检索词本身可能包含邮箱片段，不落库
    expect(JSON.stringify(log.metadata ?? {})).not.toContain('plain');
  });

  it('检索词过短返回 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users/search?query=a',
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(400);
  });

  it('普通管理员不能调用账号检索（仅超管）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users/search?query=plain',
      headers: auth(adminToken),
    });

    // 本用例里 adminToken 是 admin 角色，应被拒
    expect(res.statusCode).toBe(403);
  });
});

describe('系统与设置', () => {
  it('设置总览只返回开关与参数，不含密钥', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth(adminToken) });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(typeof data.registrationEnabled).toBe('boolean');
    expect(typeof data.mailConfigured).toBe('boolean');
    expect(data.auditLogRetentionDays).toBeGreaterThan(0);
    expect(data.capabilities.canManageAdmins).toBe(false);

    const serialized = JSON.stringify(data);
    for (const secret of ['SMTP_PASSWORD', 'SMTP_HOST', 'JWT_SECRET', 'FILE_ENCRYPTION_KEY']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('任务聚合把任务与模拟分开计数', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard/jobs', headers: auth(adminToken) });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.tasks).toBeDefined();
    expect(data.runs).toBeDefined();
    expect(typeof data.tasks.active).toBe('number');
    expect(typeof data.runs.active).toBe('number');
  });

  it('系统信息只读进程状态', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/system/info', headers: auth(adminToken) });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.database).toBe('ok');
    expect(typeof data.version).toBe('string');
    expect(JSON.stringify(data)).not.toContain('DATABASE_URL');
  });

  it('注册开关默认开启', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings/registration',
      headers: auth(adminToken),
    });

    expect(res.json().data.enabled).toBe(true);
  });

  it('关闭注册后注册接口返回 403', async () => {
    const off = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings/registration',
      headers: auth(adminToken),
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `blocked-${Date.now()}${DOMAIN}`,
        password: 'TestPass123',
        nickname: '被拦截',
      },
    });

    expect(register.statusCode).toBe(403);
    expect(register.json().error.code).toBe('REGISTRATION_DISABLED');
  });

  it('管理写操作写审计且不含财务内容', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable`,
      headers: auth(adminToken),
    });

    const log = await app.prisma.auditLog.findFirstOrThrow({
      where: { userId: adminId, action: 'admin.user_disabled' },
    });

    const serialized = JSON.stringify(log.metadata ?? {});
    expect(serialized).not.toContain('balance');
    expect(serialized).not.toContain('amount');
  });

  it('管理员操作审计可查询且只含管理动作', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable`,
      headers: auth(adminToken),
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs', headers: auth(adminToken) });
    const logs = res.json().data.logs as Array<{ action: string }>;

    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((item) => item.action.startsWith('admin.'))).toBe(true);
  });

  it('管理员审计带操作者脱敏邮箱，不含明文', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable`,
      headers: auth(adminToken),
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/audit-logs', headers: auth(adminToken) });
    const logs = res.json().data.logs as Array<{ action: string; actorEmail: string | null }>;
    const entry = logs.find((item) => item.action === 'admin.user_disabled');

    expect(entry).toBeDefined();
    // 操作者是追责的核心字段，必须非空且已脱敏
    expect(entry!.actorEmail).toBeTruthy();
    expect(entry!.actorEmail).toContain('***');
  });

  it('审计支持按动作与操作者筛选', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable`,
      headers: auth(adminToken),
    });
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/enable`,
      headers: auth(adminToken),
    });

    const byAction = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?action=admin.user_disabled',
      headers: auth(adminToken),
    });
    const actions = byAction.json().data.logs as Array<{ action: string }>;
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((item) => item.action === 'admin.user_disabled')).toBe(true);

    const byActor = await app.inject({
      method: 'GET',
      url: `/api/admin/audit-logs?actorId=${adminId}`,
      headers: auth(adminToken),
    });
    expect((byActor.json().data.logs as unknown[]).length).toBeGreaterThan(0);

    // 同样的动作换成另一个操作者：本测试里超管没做过禁用，应为空
    const otherActor = await app.inject({
      method: 'GET',
      url: `/api/admin/audit-logs?action=admin.user_disabled&actorId=${superId}`,
      headers: auth(adminToken),
    });
    expect((otherActor.json().data.logs as unknown[]).length).toBe(0);
  });

  it('审计支持按日期区间筛选', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable`,
      headers: auth(adminToken),
    });

    const today = new Date().toISOString().slice(0, 10);
    const inRange = await app.inject({
      method: 'GET',
      url: `/api/admin/audit-logs?from=${today}&to=${today}`,
      headers: auth(adminToken),
    });
    expect((inRange.json().data.logs as unknown[]).length).toBeGreaterThan(0);

    // 一个明显在过去的区间应为空，证明筛选真的生效
    const past = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?from=2000-01-01&to=2000-01-02',
      headers: auth(adminToken),
    });
    expect((past.json().data.logs as unknown[]).length).toBe(0);
  });

  it('审计分页返回总数与总页数', async () => {
    for (let index = 0; index < 3; index += 1) {
      await app.inject({
        method: 'POST',
        url: `/api/admin/users/${userId}/revoke-sessions`,
        headers: auth(adminToken),
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?page=1&pageSize=2',
      headers: auth(adminToken),
    });

    const pagination = res.json().meta.pagination;
    expect(pagination.pageSize).toBe(2);
    expect(pagination.total).toBeGreaterThanOrEqual(3);
    expect((res.json().data.logs as unknown[]).length).toBe(2);
  });
});
