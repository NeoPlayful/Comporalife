import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
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

  // ===== 投资组合 =====
  // 基金账户建为投资组合：入金走账本 investment 类型，买入只做资产转换，
  // 因此演示账号的收支统计不会因为投资而虚高。
  const portfolio = await prisma.portfolio.create({
    data: {
      userId: user.id,
      accountId: accounts.fund.id,
      name: '长期投资',
      currency: 'CNY',
      note: '演示组合',
    },
  });

  const instrumentDefs = [
    { symbol: '510300', name: '沪深300ETF', assetClass: 'etf' as const, buyPrice: 3.95, latest: 4.12 },
    { symbol: '510500', name: '中证500ETF', assetClass: 'etf' as const, buyPrice: 5.6, latest: 5.88 },
    { symbol: '000001', name: '华夏成长混合', assetClass: 'fund' as const, buyPrice: 1.42, latest: 1.51 },
  ];

  const instruments: Record<string, string> = {};

  for (const def of instrumentDefs) {
    const instrument = await prisma.instrument.create({
      data: {
        userId: user.id,
        symbol: def.symbol,
        name: def.name,
        assetClass: def.assetClass,
        currency: 'CNY',
      },
    });
    instruments[def.symbol] = instrument.id;

    // 手工价格：历史点用于收益曲线，最新点用于市值
    for (const [offset, price] of [
      [200, def.buyPrice],
      [110, (def.buyPrice + def.latest) / 2],
      [50, def.latest * 0.97],
      [1, def.latest],
    ] as Array<[number, number]>) {
      await prisma.instrumentPrice.create({
        data: {
          userId: user.id,
          instrumentId: instrument.id,
          priceDate: daysAgo(offset),
          price: price.toFixed(4),
          source: 'manual',
        },
      });
    }
  }

  // 入金：写 investment 账本交易 + 组合现金流，现金流用于收益计算
  const depositDays = [200, 170, 140, 110, 80, 50, 20];
  for (const offset of depositDays) {
    const when = daysAgo(offset);
    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'investment',
        occurredAt: when,
        description: '投资入金',
        entries: {
          create: [
            { userId: user.id, accountId: accounts.salary.id, amount: '-5000', currency: 'CNY' },
            { userId: user.id, accountId: null, amount: '5000', currency: 'CNY' },
          ],
        },
      },
      select: { id: true },
    });

    await prisma.portfolioCashflow.create({
      data: {
        userId: user.id,
        portfolioId: portfolio.id,
        kind: 'deposit',
        flowDate: when,
        amount: '5000',
        transactionId: transaction.id,
        note: '月度定投',
      },
    });

    // 把资金从工资卡转入基金账户，保持账户余额正确
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

  // 买卖与股息：账本腿由投资模块规则生成，这里直接写交易行与分录
  async function addTrade(params: {
    kind: 'buy' | 'sell' | 'dividend';
    symbol?: string;
    quantity?: string;
    price?: string;
    amount?: string;
    fee?: string;
    offsetDays: number;
  }) {
    const when = daysAgo(params.offsetDays);
    const instrumentId = params.symbol ? instruments[params.symbol] : null;
    const tradeAmount =
      params.amount ?? new Decimal(params.quantity!).mul(new Decimal(params.price!)).toFixed(6);
    const fee = params.fee ?? '0';

    let type: 'investment' | 'income';
    let signed: string;

    if (params.kind === 'buy') {
      type = 'investment';
      signed = new Decimal(tradeAmount).plus(fee).negated().toFixed(6);
    } else if (params.kind === 'sell') {
      type = 'investment';
      signed = new Decimal(tradeAmount).minus(fee).toFixed(6);
    } else {
      type = 'income';
      signed = tradeAmount;
    }

    const categoryId =
      params.kind === 'dividend'
        ? findCategory('income', '分红') ?? null
        : null;

    const transaction = await prisma.transaction.create({
      data: {
        userId: user.id,
        type,
        occurredAt: when,
        description:
          params.kind === 'buy' ? '买入' : params.kind === 'sell' ? '卖出' : '股息',
        categoryId,
        entries: {
          create: [
            { userId: user.id, accountId: accounts.fund.id, amount: signed, currency: 'CNY' },
            {
              userId: user.id,
              accountId: null,
              amount: new Decimal(signed).negated().toFixed(6),
              currency: 'CNY',
            },
          ],
        },
      },
      select: { id: true },
    });

    await prisma.portfolioTrade.create({
      data: {
        userId: user.id,
        portfolioId: portfolio.id,
        instrumentId,
        kind: params.kind,
        tradeDate: when,
        quantity: params.quantity ?? null,
        price: params.price ?? null,
        amount: tradeAmount,
        fee,
        transactionId: transaction.id,
      },
    });
  }

  await addTrade({ kind: 'buy', symbol: '510300', quantity: '2500', price: '3.95', fee: '6.2', offsetDays: 195 });
  await addTrade({ kind: 'buy', symbol: '510500', quantity: '1500', price: '5.60', fee: '5.4', offsetDays: 160 });
  await addTrade({ kind: 'buy', symbol: '000001', quantity: '6000', price: '1.42', fee: '4.0', offsetDays: 120 });
  await addTrade({ kind: 'buy', symbol: '510300', quantity: '1500', price: '4.05', fee: '3.8', offsetDays: 60 });
  await addTrade({ kind: 'dividend', symbol: '000001', amount: '860', offsetDays: 35 });
  await addTrade({ kind: 'sell', symbol: '510500', quantity: '500', price: '5.80', fee: '3.2', offsetDays: 15 });

  await prisma.portfolioTarget.createMany({
    data: [
      { userId: user.id, portfolioId: portfolio.id, dimension: 'asset_class', key: 'etf', targetWeight: '0.6' },
      { userId: user.id, portfolioId: portfolio.id, dimension: 'asset_class', key: 'fund', targetWeight: '0.3' },
      { userId: user.id, portfolioId: portfolio.id, dimension: 'asset_class', key: 'cash', targetWeight: '0.1' },
    ],
  });

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
