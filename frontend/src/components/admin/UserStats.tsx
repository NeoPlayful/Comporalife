import type { DashboardOverview } from '@/lib/admin';
import { ShieldAlert, UserPlus, UserX, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * 账号概览。
 *
 * 数字来自仪表板总览接口：它是全站聚合、不随筛选变化，所以卡片上必须写明「全站」，
 * 否则会把「按角色筛出来的 1 个」误解成总数。
 */
export default function UserStats({ overview }: { overview: DashboardOverview | null }) {
  const { t } = useTranslation('admin');
  const users = overview?.users;

  const cards: { label: string; value: string; icon: ReactNode; iconClass: string; alert?: boolean }[] = [
    {
      label: t('users.stats_total'),
      value: users ? String(users.total) : '—',
      icon: <Users className="size-4" aria-hidden />,
      iconClass: 'bg-indigo-500/10 text-indigo-500',
    },
    {
      label: t('users.stats_active'),
      value: users ? String(users.active) : '—',
      icon: <UserPlus className="size-4" aria-hidden />,
      iconClass: 'bg-emerald-500/10 text-emerald-600',
    },
    {
      label: t('users.stats_disabled'),
      value: users ? String(users.disabled) : '—',
      icon: <UserX className="size-4" aria-hidden />,
      iconClass: 'bg-red-500/10 text-red-500',
      alert: (users?.disabled ?? 0) > 0,
    },
    {
      label: t('users.stats_new_7d'),
      value: users ? String(users.newLast7d) : '—',
      icon: <ShieldAlert className="size-4" aria-hidden />,
      iconClass: 'bg-violet-500/10 text-violet-500',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="card flex items-start gap-3 p-3">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${card.iconClass}`}>
            {card.icon}
          </span>
          <div className="min-w-0">
            <p className="text-xs text-[var(--color-content-muted)]">{card.label}</p>
            <p
              className={`truncate text-base font-semibold tabular-nums ${
                card.alert ? 'text-red-600 dark:text-red-400' : ''
              }`}
            >
              {card.value}
            </p>
          </div>
        </div>
      ))}
      <p className="col-span-full -mt-1 text-xs text-[var(--color-content-muted)]">
        {t('users.stats_scope')}
      </p>
    </div>
  );
}
