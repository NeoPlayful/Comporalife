import { z } from 'zod';

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

export const adminUserListSchema = z.object({
  search: z.string().max(120).optional(),
  role: z.enum(['super_admin', 'admin', 'user']).optional(),
  status: z.enum(['active', 'disabled', 'pending_verification']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  reveal: z.union([z.boolean(), z.string()]).optional(),
});

export const adminUserIdSchema = z.object({
  id: z.string().uuid('用户 ID 必须是 UUID'),
});

export const adminUserDetailSchema = z.object({
  reveal: z.union([z.boolean(), z.string()]).optional(),
});

export const adminRegistrationSchema = z.object({
  enabled: z.boolean(),
});

export const adminEmailVerificationSchema = z.object({
  enabled: z.boolean(),
});

export const deletionReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(200).optional(),
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

/** 管理员授予前的账号搜索：按邮箱或 ID 定位候选用户 */
export const adminUserSearchSchema = z.object({
  query: z.string().trim().min(2, '至少输入 2 个字符').max(120),
});

/** reveal 参数既可能是布尔也常以 query 字符串出现，统一归一 */
export function normalizeReveal(value: boolean | string | undefined): boolean {
  return value === true || value === 'true' || value === '1';
}
