import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, '密码至少 8 位')
  .max(128, '密码最多 128 位')
  .regex(/[a-zA-Z]/, '密码需包含字母')
  .regex(/\d/, '密码需包含数字');

export const registerSchema = z.object({
  email: z.string().email('邮箱格式不正确').max(255),
  password: passwordSchema,
  nickname: z.string().trim().min(1, '昵称不能为空').max(50, '昵称最多 50 个字符'),
});

export const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入原密码'),
  newPassword: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, '令牌不能为空'),
  newPassword: passwordSchema,
});

export const sessionIdSchema = z.object({
  id: z.string().uuid('会话 ID 格式不正确'),
});
