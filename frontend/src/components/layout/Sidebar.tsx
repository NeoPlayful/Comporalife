import { useUiStore } from '@/stores/ui-store';
import {
  ArrowLeftRight,
  BarChart3,
  Activity,
  Calculator,
  Database,
  FileText,
  Goal as GoalIcon,
  LineChart,
  LayoutDashboard,
  Settings,
  Tags,
  Target,
  Upload,
  Wallet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/dashboard', key: 'dashboard', icon: LayoutDashboard },
  { to: '/accounts', key: 'accounts', icon: Wallet },
  { to: '/transactions', key: 'transactions', icon: ArrowLeftRight },
  { to: '/imports', key: 'imports', icon: Upload },
  { to: '/analytics', key: 'analytics', icon: BarChart3 },
  { to: '/budgets', key: 'budgets', icon: Target },
  { to: '/portfolios', key: 'portfolios', icon: LineChart },
  { to: '/categories', key: 'categories', icon: Tags },
  { to: '/compound', key: 'compound', icon: Calculator },
  { to: '/monte-carlo', key: 'monte-carlo', icon: Activity },
  { to: '/goals', key: 'goals', icon: GoalIcon },
  { to: '/reports', key: 'reports', icon: FileText },
  { to: '/data', key: 'data', icon: Database },
  { to: '/settings', key: 'settings', icon: Settings },
] as const;

export default function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const { t } = useTranslation();

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-accent)] font-bold text-white">
          {t('common:brand_initial')}
        </div>
        {!collapsed && <p className="min-w-0 truncate text-sm font-semibold">{t('common:app_name')}</p>}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {NAV_ITEMS.map(({ to, key, icon: Icon }) => {
          const label = t(`nav:${key}`);

          return (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                    : 'text-[var(--color-content-muted)] hover:bg-black/5 hover:text-[var(--color-content)] dark:hover:bg-white/5'
                }`
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-[var(--color-border-subtle)] p-3">
        {!collapsed && (
          <p className="text-xs text-[var(--color-content-muted)]">
            {t('common:footer.version', { version: __APP_VERSION__ })}
          </p>
        )}
      </div>
    </aside>
  );
}
