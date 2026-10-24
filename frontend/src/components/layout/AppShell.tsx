import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import LoadingState from '@/components/ui/LoadingState';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/lib/auth';
import { useUiStore } from '@/stores/ui-store';
import Sidebar, { type NavItem, type SidebarBrand } from './Sidebar';
import TopBar from './TopBar';

/** 侧边栏 + 顶部栏 + 独立滚动主区：用户端与管理后台共用同一外壳 */
export default function AppShell({
  items,
  brand,
  sidebarFooter,
  adminMode = false,
}: {
  items: NavItem[];
  brand: SidebarBrand;
  sidebarFooter?: ReactNode;
  adminMode?: boolean;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { t } = useTranslation('nav');
  const setLanguage = useUiStore((state) => state.setLanguage);
  const setTheme = useUiStore((state) => state.setTheme);
  const synced = useRef(false);

  // 登录后以服务端偏好为准，覆盖首屏按浏览器语言猜测的结果
  useEffect(() => {
    if (synced.current) return;
    synced.current = true;

    void authApi
      .preferences()
      .then(({ preferences }) => {
        setLanguage(preferences.language);
        setTheme(preferences.theme);
      })
      .catch(() => undefined);
  }, [setLanguage, setTheme]);

  return (
    // 独立 h-screen 根布局：侧边栏与内容区各自滚动，不嵌套在 min-h-screen 容器内
    <div className="flex h-screen w-full overflow-hidden">
      <div className="hidden md:block">
        <Sidebar items={items} brand={brand} footer={sidebarFooter} />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
            aria-label={t('close_nav')}
          />
          <div className="relative h-full w-60">
            <Sidebar items={items} brand={brand} footer={sidebarFooter} />
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-2 top-4 grid size-8 place-items-center rounded-lg text-[var(--color-content-muted)]"
              aria-label={t('close_nav')}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} adminMode={adminMode} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* 只替换内容区，切换板块时侧边栏与顶部栏不闪回加载态 */}
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
