import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { CATEGORY_TEMPLATE } from '../src/modules/categories/category-template.js';
import { seedRateData } from './seed-rate-settings.js';

const prisma = new PrismaClient();

async function main() {
  const rates = await seedRateData(prisma);
  if (rates.settingsApplied.length > 0) {
    console.log(`已写入默认汇率配置：${rates.settingsApplied.join(', ')}`);
  }
  if (rates.written > 0) {
    console.log(`已写入 ${rates.written} 条初始汇率（${rates.date}，锚定 USD）`);
  } else {
    console.log(`初始汇率已存在，跳过写入（${rates.date}）`);
  }

  const email = process.env.ADMIN_EMAIL ?? 'admin@comporalife.com';
  const password = process.env.ADMIN_PASSWORD ?? 'admin123';
  const nickname = '超级管理员';

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`管理员已存在，跳过创建：${email}`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        nickname,
        role: 'super_admin',
        status: 'active',
        settings: {
          create: {
            baseCurrency: process.env.DEFAULT_CURRENCY ?? 'CNY',
            timezone: 'Asia/Shanghai',
            theme: 'dark',
          },
        },
      },
    });

    for (const [kind, nodes] of Object.entries(CATEGORY_TEMPLATE) as [
      'income' | 'expense',
      (typeof CATEGORY_TEMPLATE)['income'],
    ][]) {
      let sortOrder = 0;
      for (const node of nodes) {
        const parent = await tx.category.create({
          data: { userId: user.id, kind, name: node.names['zh-CN'], sortOrder: sortOrder++ },
        });

        let childOrder = 0;
        for (const child of node.children) {
          await tx.category.create({
            data: {
              userId: user.id,
              kind,
              name: child['zh-CN'],
              parentId: parent.id,
              sortOrder: childOrder++,
            },
          });
        }
      }
    }

    console.log(`已创建超级管理员：${email}`);
    console.log('首次登录后请立即修改密码。');
  });
}

main()
  .catch((err) => {
    console.error('Seed 失败：', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
