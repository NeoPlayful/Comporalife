import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_RATE_SYNC_FREQUENCY,
  isRateSyncFrequency,
  SETTING_ADMIN_USER_CREATE_ENABLED,
  SETTING_EMAIL_VERIFICATION_ENABLED,
  SETTING_RATE_SYNC_FREQUENCY,
  SETTING_REGISTRATION_ENABLED,
  type RateSyncFrequency,
} from '../../config/constants.js';

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

/** 邮箱验证默认关闭：没有配置就视为不要求验证 */
export async function isEmailVerificationEnabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTING_EMAIL_VERIFICATION_ENABLED },
    select: { value: true },
  });

  if (!row) return false;
  return row.value === true || row.value === 'true';
}

export async function setEmailVerificationEnabled(
  prisma: PrismaClient,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_EMAIL_VERIFICATION_ENABLED },
    create: { key: SETTING_EMAIL_VERIFICATION_ENABLED, value: enabled, updatedBy },
    update: { value: enabled, updatedBy },
  });
}

/**
 * 后台代建账号。
 *
 * 与注册开关相反，这里默认关闭：管理员手握用户初始密码是额外风险面，
 * 自部署场景下多数实例用不上，开启必须是明确操作而不是默认行为。
 */
export async function isAdminUserCreateEnabled(prisma: PrismaClient): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTING_ADMIN_USER_CREATE_ENABLED },
    select: { value: true },
  });

  if (!row) return false;
  return row.value === true || row.value === 'true';
}

export async function setAdminUserCreateEnabled(
  prisma: PrismaClient,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_ADMIN_USER_CREATE_ENABLED },
    create: { key: SETTING_ADMIN_USER_CREATE_ENABLED, value: enabled, updatedBy },
    update: { value: enabled, updatedBy },
  });
}

/**
 * 汇率同步频率。
 *
 * 库里可能存着被手工改坏的值，因此读到无法识别的取值时回退到每日一次，
 * 而不是抛错——同步停摆比频率不准严重得多。
 */
export async function getRateSyncFrequency(prisma: PrismaClient): Promise<RateSyncFrequency> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTING_RATE_SYNC_FREQUENCY },
    select: { value: true },
  });

  return isRateSyncFrequency(row?.value) ? row.value : DEFAULT_RATE_SYNC_FREQUENCY;
}

export async function setRateSyncFrequency(
  prisma: PrismaClient,
  frequency: RateSyncFrequency,
  updatedBy: string,
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_RATE_SYNC_FREQUENCY },
    create: { key: SETTING_RATE_SYNC_FREQUENCY, value: frequency, updatedBy },
    update: { value: frequency, updatedBy },
  });
}
