import {
  ArrowLeftRight,
  History,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AppShell from './AppShell';
import type { NavItem } from './Sidebar';

/** 按「管理员要办的事」分板块：看数据、管账号、管权限、查记录、改配置 */
const ADMIN_NAV_KEYS: { to: string; key: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/admin', key: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', key: 'users', icon: Users },
  { to: '/admin/admins', key: 'admins', icon: UserCog },
  { to: '/admin/audit', key: 'audit', icon: History },
  { to: '/admin/exchange-rates', key: 'exchangeRates', icon: ArrowLeftRight },
  { to: '/admin/settings', key: 'settings', icon: Settings },
];

export default function AdminLayout() {
  const { t } = useTranslation('admin');

  const items: NavItem[] = ADMIN_NAV_KEYS.map(({ to, key, icon, end }) => ({
    to,
    icon,
    end,
    label: key === 'dashboard' ? t('dashboard.title') : t(`${key}.title`),
  }));

  return (
    <AppShell
      adminMode
      items={items}
      brand={{
        icon: <ShieldCheck className="size-4" />,
        title: t('title'),
        badge: <p className="truncate text-xs text-[var(--color-content-muted)]">{t('nav.badge')}</p>,
      }}
      sidebarFooter={
        <p className="text-xs text-[var(--color-content-muted)]">
          {t('common:footer.version', { version: __APP_VERSION__ })}
        </p>
      }
    />
  );
}
