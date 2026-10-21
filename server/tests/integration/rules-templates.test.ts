import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app';
import { auth, cleanupUsers, createUser, testDomain } from '../helpers';

const DOMAIN = testDomain('rulestpl');

let app: FastifyInstance;
let token: string;
let accountId: string;
let expenseCategoryId: string;
let tagId: string;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await cleanupUsers(app, DOMAIN);
  await app.close();
});

beforeEach(async () => {
  await cleanupUsers(app, DOMAIN);
  const user = await createUser(app, DOMAIN);
  token = user.token;

  const account = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    headers: auth(token),
    payload: {
      name: '规则测试账户',
      type: 'bank',
      currency: 'CNY',
      openingBalance: '10000.00',
      openingBalanceDate: '2026-01-01',
    },
  });
  accountId = account.json().data.account.id;

  const categories = await app.inject({ method: 'GET', url: '/api/categories', headers: auth(token) });
  // 分类接口返回 { categories: 根节点, flat: 扁平列表 }
  const flat = categories.json().data.flat as Array<{ id: string; kind: string; parentId: string | null }>;
  expenseCategoryId = flat.find((item) => item.kind === 'expense' && item.parentId !== null)!.id;

  const tag = await app.inject({
    method: 'POST',
    url: '/api/tags',
    headers: auth(token),
    payload: { name: '规则标签' },
  });
  tagId = tag.json().data.tag.id;
});

const MAPPING = {
  occurredAt: 0,
  amountMode: 'signed',
  amount: 1,
  description: 2,
  dateFormat: 'YYYY-MM-DD',
};

describe('模板', () => {
  it('创建、列出、更新、删除模板', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/imports/templates',
      headers: auth(token),
      payload: {
        name: '示例银行 CSV',
        bankName: '示例银行',
        format: 'csv',
        headerSignature: 'a'.repeat(64),
        mapping: MAPPING,
      },
    });
    expect(created.statusCode).toBe(201);
    const templateId = created.json().data.template.id;

    const list = await app.inject({ method: 'GET', url: '/api/imports/templates', headers: auth(token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.templates).toHaveLength(1);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/imports/templates/${templateId}`,
      headers: auth(token),
      payload: { name: '示例银行 CSV（新）' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.template.name).toBe('示例银行 CSV（新）');

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/imports/templates/${templateId}`,
      headers: auth(token),
    });
    expect(removed.statusCode).toBe(200);
  });

  it('/imports/templates 不会被 /imports/:id 吞掉', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/imports/templates', headers: auth(token) });
    // 若被当成批次 ID，会返回 404 或 UUID 校验失败
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveProperty('templates');
  });

  it('同名模板冲突', async () => {
    const payload = {
      name: '重复模板',
      format: 'csv',
      headerSignature: 'b'.repeat(64),
      mapping: MAPPING,
    };

    await app.inject({ method: 'POST', url: '/api/imports/templates', headers: auth(token), payload });
    const res = await app.inject({ method: 'POST', url: '/api/imports/templates', headers: auth(token), payload });

    expect(res.statusCode).toBe(409);
  });

  it('保存映射为模板后，下一份同格式文件自动套用', async () => {
    const upload = async (filename: string, csv: string) => {
      const boundary = '----tpl' + Math.random().toString(36).slice(2);
      return app.inject({
        method: 'POST',
        url: `/api/imports/upload?accountId=${accountId}`,
        headers: { ...auth(token), 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`,
            'utf8',
          ),
          Buffer.from(csv, 'utf8'),
          Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
        ]),
      });
    };

    // 第一份文件：手工保存映射并顺带存为模板
    const first = await upload('a.csv', '日期,金额,摘要\n2026-03-01,-88.00,模板测试\n');
    expect(first.statusCode).toBe(201);
    expect(first.json().data.template).toBeNull();

    const batchId = first.json().data.batch.id;
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/imports/${batchId}/mapping`,
      headers: auth(token),
      payload: { mapping: MAPPING, templateName: '自动套用模板' },
    });
    expect(saved.statusCode).toBe(200);

    // 第二份文件表头相同、内容不同，应自动命中模板并直接进入 mapped
    const second = await upload('b.csv', '日期,金额,摘要\n2026-03-05,-120.00,第二份账单\n');
    expect(second.statusCode).toBe(201);
    expect(second.json().data.template).not.toBeNull();
    expect(second.json().data.template.name).toBe('自动套用模板');
    expect(second.json().data.batch.status).toBe('mapped');
  });
});

describe('分类规则', () => {
  const rule = {
    name: '商户包含示例餐厅 → 餐饮',
    priority: 10,
    conditions: { logic: 'all', merchant: { op: 'contains' as const, value: '示例餐厅' } },
    actions: {},
  };

  it('创建规则并校验分类与方向匹配', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: {
        ...rule,
        actions: { categoryId: expenseCategoryId, addTagIds: [tagId] },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().data.rule.priority).toBe(10);
  });

  it('无条件规则被拒绝', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: { ...rule, conditions: { logic: 'all' }, actions: { categoryId: expenseCategoryId } },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('RULE_INVALID');
  });

  it('无动作规则被拒绝', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: { ...rule, actions: {} },
    });

    expect(res.statusCode).toBe(422);
  });

  it('归档分类不能被引用', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/categories/${expenseCategoryId}`,
      headers: auth(token),
      payload: { archived: true },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: { ...rule, actions: { categoryId: expenseCategoryId } },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toContain('归档');
  });

  it('金额区间下限大于上限被拒绝', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: {
        ...rule,
        conditions: { amount: { min: '100', max: '10' } },
        actions: { categoryId: expenseCategoryId },
      },
    });

    expect(res.statusCode).toBe(422);
  });

  it('试运行不写库', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: { ...rule, actions: { categoryId: expenseCategoryId } },
    });
    const ruleId = created.json().data.rule.id;

    await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'expense',
        occurredAt: '2026-03-01T02:00:00.000Z',
        description: '午餐',
        merchant: '示例餐厅',
        amount: '50.00',
        accountId,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/classification-rules/${ruleId}/test`,
      headers: auth(token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.matched).toBe(1);

    const rule3 = await app.prisma.classificationRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(rule3.matchCount).toBe(0);

    const tx = await app.prisma.transaction.findFirstOrThrow({ where: { userId: rule3.userId } });
    expect(tx.categoryId).toBeNull();
  });

  it('规则优先级决定分类归属，标签取并集', async () => {
    const secondTag = await app.inject({
      method: 'POST',
      url: '/api/tags',
      headers: auth(token),
      payload: { name: '第二标签' },
    });
    const secondTagId = secondTag.json().data.tag.id;

    await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: {
        name: '低优先级',
        priority: 100,
        conditions: { merchant: { op: 'contains', value: '示例餐厅' } },
        actions: { categoryId: expenseCategoryId, addTagIds: [secondTagId] },
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: {
        name: '高优先级',
        priority: 1,
        conditions: { merchant: { op: 'contains', value: '示例餐厅' } },
        actions: { addTagIds: [tagId] },
      },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/transactions',
      headers: auth(token),
      payload: {
        type: 'expense',
        occurredAt: '2026-03-02T02:00:00.000Z',
        description: '晚餐',
        merchant: '示例餐厅',
        amount: '80.00',
        accountId,
      },
    });
    const transactionId = created.json().data.transaction.id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/classification-rules/apply',
      headers: auth(token),
      payload: { transactionIds: [transactionId] },
    });

    expect(res.statusCode).toBe(200);

    const tx = await app.prisma.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      include: { tags: true },
    });

    expect(tx.categoryId).toBe(expenseCategoryId);
    expect(tx.tags.map((item) => item.tagId).sort()).toEqual([tagId, secondTagId].sort());
  });

  it('规则按用户隔离', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: { ...rule, actions: { categoryId: expenseCategoryId } },
    });
    const ruleId = created.json().data.rule.id;

    const other = await createUser(app, DOMAIN, 'ruleother');

    for (const [method, url] of [
      ['GET', `/api/classification-rules/${ruleId}`],
      ['POST', `/api/classification-rules/${ruleId}/test`],
      ['PATCH', `/api/classification-rules/${ruleId}`],
      ['DELETE', `/api/classification-rules/${ruleId}`],
    ] as const) {
      const res = await app.inject({ method, url, headers: auth(other.token), payload: method === 'PATCH' ? { enabled: false } : undefined });
      expect(res.statusCode).toBe(404);
    }
  });

  it('reorder 持久化优先级', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: { ...rule, name: '规则A', actions: { categoryId: expenseCategoryId } },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/classification-rules',
      headers: auth(token),
      payload: { ...rule, name: '规则B', actions: { categoryId: expenseCategoryId } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/classification-rules/reorder',
      headers: auth(token),
      payload: {
        items: [
          { id: a.json().data.rule.id, priority: 5 },
          { id: b.json().data.rule.id, priority: 1 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/api/classification-rules', headers: auth(token) });
    expect(list.json().data.rules[0].name).toBe('规则B');
  });
});
