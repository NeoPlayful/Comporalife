import type { PrismaClient } from '@prisma/client';
import { SETTING_REGISTRATION_ENABLED } from '../../config/constants.js';

/**
 * 部署级配置。
 *
 * 只放「可在线调整、且不含密钥」的运维参数。密钥类配置永远只来自环境变量：
 * 一旦允许写库，就等于把密钥交给了拥有数据库读权限的人。
 */

export async function isRegistrationEnabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTING_REGISTRATION_ENABLED },
    select: { value: true },
  });

  // 没有配置时视为开启：自部署默认允许注册，关闭必须显式操作
  if (!row) return true;
  return row.value === true || row.value === 'true';
}

export async function setRegistrationEnabled(
  prisma: PrismaClient,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_REGISTRATION_ENABLED },
    create: { key: SETTING_REGISTRATION_ENABLED, value: enabled, updatedBy },
    update: { value: enabled, updatedBy },
  });
}
