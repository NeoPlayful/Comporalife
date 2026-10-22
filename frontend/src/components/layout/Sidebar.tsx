import { useUiStore } from '@/stores/ui-store';
import {
  ArrowLeftRight,
  Calculator,
  LayoutDashboard,
  Settings,
  Tags,
  Upload,
  Wallet,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/dashboard', label: '财务总览', icon: LayoutDashboard },
  { to: '/accounts', label: '财务账户', icon: Wallet },
  { to: '/transactions', label: '交易流水', icon: ArrowLeftRight },
  { to: '/imports', label: '账单导入', icon: Upload },
  { to: '/categories', label: '分类管理', icon: Tags },
  { to: '/compound', label: '复利模拟', icon: Calculator },
  { to: '/settings', label: '设置', icon: Settings },
];

export default function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-accent)] font-bold text-white">
          复
        </div>
        {!collapsed && <p className="min-w-0 truncate text-sm font-semibold">Comporalife</p>}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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
        ))}
      </nav>

      <div className="border-t border-[var(--color-border-subtle)] p-3">
        {!collapsed && (
          <p className="text-xs text-[var(--color-content-muted)]">版本 v{__APP_VERSION__}</p>
        )}
      </div>
    </aside>
  );
}
