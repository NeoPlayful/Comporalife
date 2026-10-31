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
  await app.prisma.systemSetting.deleteMany({ where: { key: 'admin.user_create_enabled' } });
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await app.prisma.systemSetting.deleteMany({ where: { key: 'registration.enabled' } });
  // 代建开关每个用例都从「关闭」开始，个别用例自行打开
  await app.prisma.systemSetting.deleteMany({ where: { key: 'admin.user_create_enabled' } });
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

  it('admin 访问仅限 super_admin 的接口返回 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/settings/user-creation',
      headers: auth(adminToken),
    });
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
  it('列表默认返回完整账号', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(adminToken) });

    expect(res.statusCode).toBe(200);
    const users = res.json().data.users as Array<{ email: string }>;
    expect(users.length).toBeGreaterThan(0);
    // 后台靠完整邮箱确认操作对象，脱敏会放大误操作风险
    expect(users.every((item) => item.email.includes('@') && !item.email.includes('***'))).toBe(true);
  });

  it('详情返回完整账号且不再写查看审计', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${userId}`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.email).toContain('@');
    expect(res.json().data.user.email).not.toContain('***');

    // 查看详情已不是隐私特例，不应再产生单独的留痕噪声
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

  it('分页参数之外的筛选不影响返回结构', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users?page=1&pageSize=5',
      headers: auth(adminToken),
    });
    expect(res.json().meta.pagination.pageSize).toBe(5);
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

  it('修改昵称与邮箱生效，改邮箱同时标记为已验证', async () => {
    const target = await createUser(app, DOMAIN, 'edit');
    const nextEmail = `edited-${Date.now()}${DOMAIN}`;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
      payload: { nickname: '改过昵称', email: nextEmail },
    });

    expect(res.statusCode).toBe(200);
    const user = res.json().data.user;
    expect(user.nickname).toBe('改过昵称');
    expect(user.email).toBe(nextEmail);
    // 新邮箱没走过验证流程，登录又不校验验证状态，留着未验证只会让账号卡在提示里
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('空改动返回 400，邮箱冲突返回 409', async () => {
    const target = await createUser(app, DOMAIN, 'edit-guard');
    const other = await createUser(app, DOMAIN, 'edit-guard-other');

    const empty = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    // 改成另一个已存在账号的邮箱
    const conflict = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
      payload: { email: other.email },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('EMAIL_EXISTS');
  });

  it('修改写审计且只记字段名不记值', async () => {
    const target = await createUser(app, DOMAIN, 'edit-audit');

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
      payload: { nickname: '审计用昵称' },
    });

    const log = await app.prisma.auditLog.findFirst({
      where: { userId: adminId, action: 'admin.user_updated', targetId: target.userId },
    });
    expect(log).not.toBeNull();
    expect(log!.metadata).toMatchObject({ changedFields: 'nickname' });
    // 审计里不能出现昵称原文
    expect(JSON.stringify(log!.metadata)).not.toContain('审计用昵称');
  });

  it('删除为软删除，账号被禁用且会话立即失效', async () => {
    const target = await createUser(app, DOMAIN, 'delete');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.disposition).toBe('soft_deleted');

    // 数据保留而不是物理删除
    const row = await app.prisma.user.findUnique({
      where: { id: target.userId },
      select: { status: true, deletedAt: true },
    });
    expect(row?.status).toBe('disabled');
    expect(row?.deletedAt).not.toBeNull();

    // 已签发的 token 立即失效
    const after = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: auth(target.token),
    });
    expect(after.statusCode).toBe(401);
  });

  it('重复删除与删除后修改都返回 409', async () => {
    const target = await createUser(app, DOMAIN, 'delete-twice');

    await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
    });

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
    });
    expect(again.statusCode).toBe(409);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
      payload: { nickname: '不能改' },
    });
    expect(patch.statusCode).toBe(409);
  });

  it('不能删除自己', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${adminId}`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ADMIN_SELF_MODIFICATION');
  });

  it('永久删除会物理清除账号及其全部数据', async () => {
    const target = await createUser(app, DOMAIN, 'purge');

    // 造一点关联数据，确认级联生效而不是只删了用户行
    const account = await app.prisma.account.create({
      data: {
        userId: target.userId,
        name: 'purge-account',
        type: 'cash',
        currency: 'CNY',
        openingBalance: 0,
        openingBalanceDate: new Date('2026-01-01'),
      },
    });
    const category = await app.prisma.category.findFirstOrThrow({
      where: { userId: target.userId, parentId: null },
    });
    await app.prisma.transaction.create({
      data: {
        userId: target.userId,
        type: 'expense',
        description: 'purge-tx',
        occurredAt: new Date(),
        categoryId: category.id,
        entries: {
          create: {
            userId: target.userId,
            accountId: account.id,
            amount: -10,
            currency: 'CNY',
          },
        },
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}?permanent=true`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.disposition).toBe('permanent');

    expect(await app.prisma.user.findUnique({ where: { id: target.userId } })).toBeNull();
    expect(await app.prisma.account.count({ where: { userId: target.userId } })).toBe(0);
    expect(await app.prisma.transaction.count({ where: { userId: target.userId } })).toBe(0);
    expect(await app.prisma.category.count({ where: { userId: target.userId } })).toBe(0);
    expect(await app.prisma.transactionEntry.count({ where: { userId: target.userId } })).toBe(0);

    // 审计必须留下：账号行没了，只能靠这条定位被清除的对象
    const log = await app.prisma.auditLog.findFirst({
      where: { action: 'admin.user_purged', targetId: target.userId },
    });
    expect(log).not.toBeNull();
    expect(log!.metadata).toMatchObject({ disposition: 'permanent', targetEmail: target.email });
  });

  it('永久删除仅超管可执行', async () => {
    const target = await createUser(app, DOMAIN, 'purge-admin');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}?permanent=true`,
      headers: auth(adminToken),
    });

    expect(res.statusCode).toBe(403);
    // 被拒后账号必须还在
    expect(await app.prisma.user.findUnique({ where: { id: target.userId } })).not.toBeNull();
  });

  it('永久删除已软删除的账号是允许的，软删除则不能重复', async () => {
    const target = await createUser(app, DOMAIN, 'purge-twice');

    await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
    });

    const softAgain = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}`,
      headers: auth(adminToken),
    });
    expect(softAgain.statusCode).toBe(409);

    // 先软删、观察后再彻底清掉，这是预期的两步用法
    const purge = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}?permanent=true`,
      headers: auth(superToken),
    });
    expect(purge.statusCode).toBe(200);
    expect(await app.prisma.user.findUnique({ where: { id: target.userId } })).toBeNull();
  });

  it('不能永久删除自己', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${superId}?permanent=true`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ADMIN_SELF_MODIFICATION');
  });

  it('permanent 只接受 true/false，其他值返回 400', async () => {
    const target = await createUser(app, DOMAIN, 'purge-param');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${target.userId}?permanent=1`,
      headers: auth(superToken),
    });

    expect(res.statusCode).toBe(400);
    expect(await app.prisma.user.findUnique({ where: { id: target.userId } })).not.toBeNull();
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

  it('超管可以把普通用户提升为管理员', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${userId}/role`,
      headers: auth(superToken),
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(200);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('admin');
  });

  it('普通管理员不能改角色（仅超管）', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${userId}/role`,
      headers: auth(adminToken),
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(403);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('user');
  });

  it('不能修改自己的角色', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${superId}/role`,
      headers: auth(superToken),
      payload: { role: 'admin' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ADMIN_SELF_MODIFICATION');
  });

  it('存在多个超管时可以降级其中一个', async () => {
    const second = await createUser(app, DOMAIN, 'second-super');
    await promote(second.userId, 'super_admin');

    // 此时至少有两个活跃超管，降级其一不会锁死系统
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${second.userId}/role`,
      headers: auth(superToken),
      payload: { role: 'user' },
    });

    expect(res.statusCode).toBe(200);
    expect((await app.prisma.user.findUniqueOrThrow({ where: { id: second.userId } })).role).toBe('user');
  });

  it('改角色后旧 token 因 sessionVersion 递增而失效', async () => {
    const target = await createUser(app, DOMAIN, 'role-change');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${target.userId}/role`,
      headers: auth(superToken),
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);

    const me = await app.inject({ method: 'GET', url: '/api/profile', headers: auth(target.token) });
    expect(me.statusCode).toBe(401);
  });

  it('管理员可以设置新密码，且撤销该用户所有会话', async () => {
    const target = await createUser(app, DOMAIN, 'pwd-target');

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${target.userId}/password`,
      headers: auth(adminToken),
      payload: { password: 'NewPass456' },
    });
    expect(res.statusCode).toBe(200);

    // 旧 token 失效
    const me = await app.inject({ method: 'GET', url: '/api/profile', headers: auth(target.token) });
    expect(me.statusCode).toBe(401);

    // 旧密码登录失败，新密码可登录
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: target.email, password: 'TestPass123' },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: target.email, password: 'NewPass456' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('改密码弱口令被拒绝，且审计不含密码', async () => {
    const weak = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/password`,
      headers: auth(adminToken),
      payload: { password: 'short' },
    });
    expect(weak.statusCode).toBe(400);

    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/password`,
      headers: auth(adminToken),
      payload: { password: 'Strong789' },
    });

    const log = await app.prisma.auditLog.findFirstOrThrow({
      where: { targetId: userId, action: 'admin.password_set' },
    });
    expect(JSON.stringify(log.metadata ?? {})).not.toContain('Strong789');
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

describe('后台代建账号', () => {
  /** 打开代建开关；调用方自己保证此时是超管 */
  async function enableCreate() {
    await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings/user-creation',
      headers: auth(superToken),
      payload: { enabled: true },
    });
  }

  function createPayload(overrides: Record<string, unknown> = {}) {
    return {
      email: `created-${Math.random().toString(36).slice(2, 10)}${DOMAIN}`,
      nickname: '代建账号',
      password: 'InitPass123',
      ...overrides,
    };
  }

  it('开关默认关闭，关闭时建号返回 403', async () => {
    const settings = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: auth(superToken),
    });
    expect(settings.json().data.adminUserCreateEnabled).toBe(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(superToken),
      payload: createPayload(),
    });
    expect(res.statusCode).toBe(403);
  });

  it('只有超管能切换开关', async () => {
    const denied = await app.inject({
      method: 'PATCH',
      url: '/api/admin/settings/user-creation',
      headers: auth(adminToken),
      payload: { enabled: true },
    });
    expect(denied.statusCode).toBe(403);

    const readDenied = await app.inject({
      method: 'GET',
      url: '/api/admin/settings/user-creation',
      headers: auth(adminToken),
    });
    expect(readDenied.statusCode).toBe(403);
  });

  it('开启后管理员可以建普通用户，邮箱视为已验证', async () => {
    await enableCreate();

    const payload = createPayload();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(adminToken),
      payload,
    });

    expect(res.statusCode).toBe(201);
    const created = res.json().data.user;
    expect(created.email).toBe(payload.email);
    expect(created.role).toBe('user');
    expect(created.emailVerifiedAt).not.toBeNull();

    // 建号不签发会话：管理员不会被切换成新账号
    expect(res.json().data.accessToken).toBeUndefined();

    // 新账号能用自己的初始密码登录
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payload.email, password: payload.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it('代建账号会生成预设分类', async () => {
    await enableCreate();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(adminToken),
      payload: createPayload(),
    });

    const categories = await app.prisma.category.count({
      where: { userId: res.json().data.user.id },
    });
    expect(categories).toBeGreaterThan(0);
  });

  it('重复邮箱返回 409', async () => {
    await enableCreate();

    const payload = createPayload({ email: `dup${DOMAIN}` });
    const first = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(adminToken),
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(adminToken),
      payload,
    });
    expect(second.statusCode).toBe(409);
  });

  it('弱密码被拒绝', async () => {
    await enableCreate();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(adminToken),
      payload: createPayload({ password: '123' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('普通管理员不能代建管理员，超管可以', async () => {
    await enableCreate();

    const denied = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(adminToken),
      payload: createPayload({ role: 'admin' }),
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(superToken),
      payload: createPayload({ role: 'admin' }),
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json().data.user.role).toBe('admin');
  });

  it('建号写审计且不含密码', async () => {
    await enableCreate();

    const payload = createPayload();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: auth(adminToken),
      payload,
    });
    const createdId = res.json().data.user.id;

    const log = await app.prisma.auditLog.findFirst({
      where: { action: 'admin.user_created', targetId: createdId },
    });
    expect(log).not.toBeNull();
    expect(log?.userId).toBe(adminId);
    // 审计不得落密码：连序列化后的整行都不应包含
    expect(JSON.stringify(log)).not.toContain(payload.password);
  });

  it('开关切换写审计', async () => {
    await enableCreate();

    const log = await app.prisma.auditLog.findFirst({
      where: { action: 'admin.user_creation_toggled' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log?.metadata).toEqual({ enabled: true });
  });
});

describe('注销状态筛选', () => {
  it('deletion 参数分别命中待审批、可批准与已注销', async () => {
    const coolingDays = 30;

    // 待审批：刚提交申请，冷却期未满
    await app.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: new Date() },
    });

    const pending = await app.inject({
      method: 'GET',
      url: '/api/admin/users?deletion=pending',
      headers: auth(adminToken),
    });
    expect(pending.json().data.users.some((u: { id: string }) => u.id === userId)).toBe(true);

    const readyBefore = await app.inject({
      method: 'GET',
      url: '/api/admin/users?deletion=ready',
      headers: auth(adminToken),
    });
    expect(readyBefore.json().data.users.some((u: { id: string }) => u.id === userId)).toBe(false);

    // 把申请时间推到冷却期之前，应转到「可批准」
    await app.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: new Date(Date.now() - (coolingDays + 1) * 86_400_000) },
    });

    const ready = await app.inject({
      method: 'GET',
      url: '/api/admin/users?deletion=ready',
      headers: auth(adminToken),
    });
    expect(ready.json().data.users.some((u: { id: string }) => u.id === userId)).toBe(true);

    // 已注销的记录只出现在 deleted 里
    await app.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    const deleted = await app.inject({
      method: 'GET',
      url: '/api/admin/users?deletion=deleted',
      headers: auth(adminToken),
    });
    expect(deleted.json().data.users.some((u: { id: string }) => u.id === userId)).toBe(true);

    const readyAfter = await app.inject({
      method: 'GET',
      url: '/api/admin/users?deletion=ready',
      headers: auth(adminToken),
    });
    expect(readyAfter.json().data.users.some((u: { id: string }) => u.id === userId)).toBe(false);
  });

  it('搜索可按昵称命中', async () => {
    await app.prisma.user.update({ where: { id: userId }, data: { nickname: '独一无二的昵称' } });

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/users?search=${encodeURIComponent('独一无二')}`,
      headers: auth(adminToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.users.some((u: { id: string }) => u.id === userId)).toBe(true);
  });
});
