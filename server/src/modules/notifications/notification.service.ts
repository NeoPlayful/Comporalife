import type { NotificationKind, PrismaClient } from '@prisma/client';
import { NOTIFICATION_MAX_PER_USER } from '../../config/constants.js';

export interface NotificationInput {
  userId: string;
  kind: NotificationKind;
  metadata?: Record<string, unknown>;
  link?: string | null;
}

/**
 * 写一条通知。
 *
 * 通知是「顺带产物」，绝不能因为它失败而回滚业务：
 * 调用方一般用 void + catch，这里也再兜一层，保证异常不外抛。
 */
export async function createNotification(
  prisma: PrismaClient,
  input: NotificationInput,
  onError?: (err: unknown) => void,
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        metadata: (input.metadata ?? undefined) as never,
        link: input.link ?? null,
      },
    });

    // 超出上限时按时间倒序删除最旧的，避免单用户无限增长
    const count = await prisma.notification.count({ where: { userId: input.userId } });
    if (count > NOTIFICATION_MAX_PER_USER) {
      const overflow = count - NOTIFICATION_MAX_PER_USER;
      const oldest = await prisma.notification.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'asc' },
        take: overflow,
        select: { id: true },
      });
      if (oldest.length > 0) {
        await prisma.notification.deleteMany({
          where: { id: { in: oldest.map((item) => item.id) } },
        });
      }
    }
  } catch (err) {
    onError?.(err);
  }
}

export async function countUnread(prisma: PrismaClient, userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
