import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Building2,
  Calculator,
  Database,
  FileText,
  Goal as GoalIcon,
  History,
  Landmark,
  LayoutDashboard,
  LineChart,
  Settings,
  Tags,
  Target,
  Upload,
  Wallet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AppShell from './AppShell';
import type { NavItem } from './Sidebar';

const NAV_KEYS = [
  { to: '/dashboard', key: 'dashboard', icon: LayoutDashboard },
  { to: '/accounts', key: 'accounts', icon: Wallet },
  { to: '/assets', key: 'assets', icon: Building2 },
  { to: '/liabilities', key: 'liabilities', icon: Landmark },
  { to: '/transactions', key: 'transactions', icon: ArrowLeftRight },
  { to: '/imports', key: 'imports', icon: Upload },
  { to: '/analytics', key: 'analytics', icon: BarChart3 },
  { to: '/budgets', key: 'budgets', icon: Target },
  { to: '/portfolios', key: 'portfolios', icon: LineChart },
  { to: '/exchange-rates', key: 'exchange-rates', icon: ArrowLeftRight },
  { to: '/categories', key: 'categories', icon: Tags },
  { to: '/compound', key: 'compound', icon: Calculator },
  { to: '/monte-carlo', key: 'monte-carlo', icon: Activity },
  { to: '/goals', key: 'goals', icon: GoalIcon },
  { to: '/reports', key: 'reports', icon: FileText },
  { to: '/data', key: 'data', icon: Database },
  // 通知不占侧边栏：入口在顶栏铃铛，避免与菜单重复
  { to: '/audit', key: 'audit', icon: History },
  { to: '/settings', key: 'settings', icon: Settings },
] as const;

export default function AppLayout() {
  const { t } = useTranslation();

  const items: NavItem[] = NAV_KEYS.map(({ to, key, icon }) => ({
    to,
    icon,
    label: t(`nav:${key}`),
  }));

  return (
    <AppShell
      items={items}
      brand={{ initial: t('common:brand_initial'), title: t('common:app_name') }}
      sidebarFooter={
        <p className="text-xs text-[var(--color-content-muted)]">
          {t('common:footer.version', { version: __APP_VERSION__ })}
        </p>
      }
    />
  );
}
