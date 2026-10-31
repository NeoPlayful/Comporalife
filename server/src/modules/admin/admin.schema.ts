import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '../../config/constants.js';
import { passwordSchema } from '../auth/auth.schema.js';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

export const adminUserListSchema = z.object({
  search: z.string().max(120).optional(),
  role: z.enum(['super_admin', 'admin', 'user']).optional(),
  status: z.enum(['active', 'disabled', 'pending_verification']).optional(),
  /**
   * 注销生命周期是三个独立时间字段，不在 UserStatus 枚举里，
   * 因此单独给一个筛选维度：待审批、冷却已满可批准、已注销。
   */
  deletion: z.enum(['pending', 'ready', 'deleted']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminUserIdSchema = z.object({
  id: z.string().uuid('用户 ID 必须是 UUID'),
});

export const adminRegistrationSchema = z.object({
  enabled: z.boolean(),
});

export const adminEmailVerificationSchema = z.object({
  enabled: z.boolean(),
});

export const adminUserCreateToggleSchema = z.object({
  enabled: z.boolean(),
});

/**
 * 后台代建账号。
 *
 * 密码规则与前台注册共用同一套 passwordSchema，避免出现「后台能设弱密码」的旁路。
 * 角色只接受三档枚举，越权判断在路由层做（非超管只能建 user）。
 */
export const adminUserCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不正确').max(255),
  nickname: z.string().trim().min(1, '昵称不能为空').max(50, '昵称最多 50 个字符'),
  password: passwordSchema,
  role: z.enum(['super_admin', 'admin', 'user']).default('user'),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
});

/**
 * 后台修改账号资料。
 *
 * 只允许改昵称、邮箱与语言：密码走独立的设置接口，角色走独立的改角色接口，
 * 状态由 disable/enable 负责。全字段可选但至少要改一项，避免空请求写一条无变化的审计。
 */
export const adminUserUpdateSchema = z
  .object({
    nickname: z.string().trim().min(1, '昵称不能为空').max(50, '昵称最多 50 个字符').optional(),
    email: z.string().trim().toLowerCase().email('邮箱格式不正确').max(255).optional(),
    language: z.enum(SUPPORTED_LANGUAGES).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: '至少需要修改一项',
  });

/** 后台修改角色：三档枚举，越权（非超管）判断在路由层做 */
export const adminUserRoleSchema = z.object({
  role: z.enum(['super_admin', 'admin', 'user']),
});

/**
 * 后台直接设置新密码。
 * 与注册、自助改密共用同一套 passwordSchema，避免出现「后台能设弱密码」的旁路。
 */
export const adminUserPasswordSchema = z.object({
  password: passwordSchema,
});

export const deletionReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(200).optional(),
});

/**
 * 删除账号的查询参数。
 *
 * 默认软删除；`permanent=true` 才物理清除。刻意不用 z.coerce.boolean()：
 * 那会把字符串 "false" 也解析成 true，反而让「不传或传 false」两种写法都变成永久删除。
 */
export const adminUserDeleteQuerySchema = z.object({
  permanent: z.enum(['true', 'false']).optional(),
});

export const adminLoginLogSchema = z.object({
  from: dateText.optional(),
  to: dateText.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminJobListSchema = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminJobIdSchema = z.object({
  id: z.string().uuid(),
});

export const adminAuditQuerySchema = z.object({
  action: z.string().max(64).optional(),
  /** 操作者 ID：按「谁做的」筛选，与服务端写入的 audit_logs.user_id 对应 */
  actorId: z.string().uuid().optional(),
  /** 目标对象 ID：按「对谁做的」筛选 */
  targetId: z.string().uuid().optional(),
  from: dateText.optional(),
  to: dateText.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

