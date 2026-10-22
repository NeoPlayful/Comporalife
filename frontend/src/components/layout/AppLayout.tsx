import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authApi } from '@/lib/auth';
import { useUiStore } from '@/stores/ui-store';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AppLayout() {
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
        <Sidebar />
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
            <Sidebar />
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
        <TopBar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
