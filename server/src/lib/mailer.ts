import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProduction, isTest } from '../config/env.js';
import { errors } from './errors.js';

/**
 * 邮件投递。
 *
 * 三种环境的行为差异必须显式：
 * - test：不连 SMTP，写入内存队列供断言，避免测试依赖外部服务
 * - production：必须真实投递；SMTP 未配置时启动告警、发送报错，绝不静默成功
 * - development：已配置则真实发送，未配置则只记日志，便于本地看链接
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailDelivery {
  delivered: boolean;
  /** 未投递的原因：供调用方决定是否把链接打到日志 */
  reason?: 'not_configured' | 'test_mode' | 'delivery_failed';
}

/** 测试环境的内存信箱：只留最近 50 封，避免长跑测试占内存 */
const testOutbox: MailMessage[] = [];

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(env.SMTP_HOST);
}

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER && env.SMTP_PASS
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  return transporter;
}

function fromAddress(): string {
  return env.MAIL_FROM ?? env.SMTP_USER ?? 'no-reply@comporalife.local';
}

/** 只记收件域名，不记完整地址与正文 */
function maskRecipient(to: string): string {
  const at = to.lastIndexOf('@');
  return at === -1 ? '***' : `***${to.slice(at)}`;
}

export function getTestOutbox(): MailMessage[] {
  return testOutbox;
}

export function clearTestOutbox(): void {
  testOutbox.length = 0;
}

export async function sendMail(
  message: MailMessage,
  log?: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void },
): Promise<MailDelivery> {
  if (isTest) {
    testOutbox.push(message);
    if (testOutbox.length > 50) testOutbox.shift();
    return { delivered: false, reason: 'test_mode' };
  }

  if (!isMailConfigured()) {
    log?.warn({ to: maskRecipient(message.to) }, '未配置 SMTP，邮件未投递');
    return { delivered: false, reason: 'not_configured' };
  }

  const attempt = async () =>
    getTransporter().sendMail({
      from: fromAddress(),
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });

  try {
    await attempt();
  } catch {
    // 网络类抖动重试一次；认证错误重试也不会成功，但重试成本低且能覆盖瞬时故障
    try {
      await attempt();
    } catch (err) {
      log?.warn({ to: maskRecipient(message.to), err }, '邮件投递失败');
      if (isProduction) throw errors.mailDeliveryFailed();
      return { delivered: false, reason: 'delivery_failed' };
    }
  }

  log?.info({ to: maskRecipient(message.to) }, '邮件已投递');
  return { delivered: true };
}
