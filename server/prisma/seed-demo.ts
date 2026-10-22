import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { CATEGORY_TEMPLATE } from '../src/modules/categories/category-template.js';

/**
 * 生成演示账号与虚构流水，仅用于截图和本地体验。
 * 数据全部为虚构，不要在生产环境执行。
 */
const prisma = new PrismaClient();

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(10, 0, 0, 0);
  return date;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('演示数据脚本不允许在生产环境运行');
  }

  const email = process.env.DEMO_EMAIL ?? 'demo@comporalife.local';
  const password = process.env.DEMO_PASSWORD ?? 'DemoPass123';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.delete({ where: { email } });
    console.log('已清理旧演示账号');
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        passwordHash,
        nickname: '演示用户',
        role: 'user',
        status: 'active',
        settings: { create: { baseCurrency: 'CNY', timezone: 'Asia/Shanghai', theme: 'dark' } },
      },
    });

    for (const [kind, nodes] of Object.entries(CATEGORY_TEMPLATE) as [
      'income' | 'expense',
      (typeof CATEGORY_TEMPLATE)['income'],
    ][]) {
      let sortOrder = 0;
      for (const node of nodes) {
        const parent = await tx.category.create({
          data: { userId: created.id, kind, name: node.names['zh-CN'], sortOrder: sortOrder++ },
        });
        let childOrder = 0;
        for (const child of node.children) {
          await tx.category.create({
            data: { userId: created.id, kind, name: child['zh-CN'], parentId: parent.id, sortOrder: childOrder++ },
          });
        }
      }
    }

    return created;
  });

  const categories = await prisma.category.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, kind: true },
  });

  const findCategory = (kind: 'income' | 'expense', name: string) =>
    categories.find((c) => c.kind === kind && c.name === name)!.id;

  const accounts = {
    salary: await prisma.account.create({
      data: {
        userId: user.id,
        name: '工资卡',
        type: 'bank',
        institution: '示例银行',
        currency: 'CNY',
        openingBalance: '28000.00',
        openingBalanceDate: daysAgo(180),
      },
    }),
    cash: await prisma.account.create({
      data: {
        userId: user.id,
        name: '日常现金',
        type: 'cash',
        currency: 'CNY',
        openingBalance: '1500.00',
        openingBalanceDate: daysAgo(180),
      },
    }),
    card: await prisma.account.create({
      data: {
        userId: user.id,
        name: '信用卡',
        type: 'credit_card',
        institution: '示例银行',
        currency: 'CNY',
        openingBalance: '3200.00',
        openingBalanceDate: daysAgo(180),
      },
    }),
    fund: await prisma.account.create({
      data: {
        userId: user.id,
        name: '基金账户',
        type: 'brokerage',
        currency: 'CNY',
        openingBalance: '45000.00',
        openingBalanceDate: daysAgo(180),
      },
    }),
  };

  async function addIncome(accountId: string, categoryName: string, amount: string, when: Date, desc: string) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'income',
        occurredAt: when,
        description: desc,
        categoryId: findCategory('income', categoryName),
        entries: {
          create: [
            { userId: user.id, accountId, amount, currency: 'CNY' },
            { userId: user.id, accountId: null, amount: `-${amount}`, currency: 'CNY' },
          ],
        },
      },
    });
  }

  async function addExpense(accountId: string, categoryName: string, amount: string, when: Date, desc: string, merchant?: string) {
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'expense',
        occurredAt: when,
        description: desc,
        merchant: merchant ?? null,
        categoryId: findCategory('expense', categoryName),
        entries: {
          create: [
            { userId: user.id, accountId, amount: `-${amount}`, currency: 'CNY' },
            { userId: user.id, accountId: null, amount, currency: 'CNY' },
          ],
        },
      },
    });
  }

  for (let month = 5; month >= 0; month -= 1) {
    const salaryDate = daysAgo(month * 30 + 5);
    await addIncome(accounts.salary.id, '工资', '18500.00', salaryDate, `${salaryDate.getMonth() + 1} 月工资`);

    await addExpense(accounts.salary.id, '房租', '5500.00', daysAgo(month * 30 + 3), '房租', '示例房东');
    await addExpense(accounts.cash.id, '日常餐饮', '1200.00', daysAgo(month * 30 + 10), '餐饮支出');
    await addExpense(accounts.card.id, '交通', '480.00', daysAgo(month * 30 + 12), '通勤交通', '地铁');
    await addExpense(accounts.card.id, '娱乐', '350.00', daysAgo(month * 30 + 15), '影音订阅', '流媒体');
    await addExpense(accounts.cash.id, '医疗', '260.00', daysAgo(month * 30 + 18), '药品');
  }

  for (const month of [4, 3, 2, 1, 0]) {
    const when = daysAgo(month * 30 + 20);
    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'transfer',
        occurredAt: when,
        description: '工资卡 → 基金账户',
        entries: {
          create: [
            { userId: user.id, accountId: accounts.salary.id, amount: '-5000', currency: 'CNY' },
            { userId: user.id, accountId: accounts.fund.id, amount: '5000', currency: 'CNY' },
          ],
        },
      },
    });
  }

  await prisma.simulationScenario.createMany({
    data: [
      {
        userId: user.id,
        name: '保守 4%',
        principal: '45000',
        contributionAmount: '5000',
        contributionFrequency: 'monthly',
        contributionTiming: 'end',
        annualReturnRate: '0.04',
        years: 15,
        inflationRate: '0.025',
        feeRate: '0.005',
      },
      {
        userId: user.id,
        name: '基准 7%',
        principal: '45000',
        contributionAmount: '5000',
        contributionFrequency: 'monthly',
        contributionTiming: 'end',
        annualReturnRate: '0.07',
        years: 15,
        inflationRate: '0.025',
        feeRate: '0.005',
      },
      {
        userId: user.id,
        name: '乐观 10%',
        principal: '45000',
        contributionAmount: '5000',
        contributionFrequency: 'monthly',
        contributionTiming: 'end',
        annualReturnRate: '0.1',
        years: 15,
        inflationRate: '0.025',
        feeRate: '0.005',
      },
    ],
  });

  console.log(`演示账号已创建：${email} / ${password}`);
}

main()
  .catch((err) => {
    console.error('演示数据生成失败：', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
