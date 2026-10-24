import { useUiStore } from '@/stores/ui-store';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 精确匹配：用于 /admin 这类前缀会命中子路由的入口 */
  end?: boolean;
}

export interface SidebarBrand {
  /** 无图标时显示的首字方块 */
  initial?: string;
  /** 存在时替代首字方块 */
  icon?: ReactNode;
  title: string;
  badge?: ReactNode;
}

export default function Sidebar({
  items,
  brand,
  footer,
}: {
  items: NavItem[];
  brand: SidebarBrand;
  footer?: ReactNode;
}) {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-accent)] font-bold text-white">
          {brand.icon ?? brand.initial}
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{brand.title}</p>
            {brand.badge}
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
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

      {footer && !collapsed && (
        <div className="border-t border-[var(--color-border-subtle)] p-3">{footer}</div>
      )}
    </aside>
  );
}
