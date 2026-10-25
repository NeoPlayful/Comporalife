import { authApi, isAdminRole } from '@/lib/auth';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { notificationsApi } from '@/lib/notifications';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bell,
  Languages,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useNotificationText } from '@/pages/NotificationsPage';

const LANGUAGE_LABEL_KEYS: Record<SupportedLanguage, string> = {
  'zh-CN': 'language.zh_CN',
  'en-US': 'language.en_US',
};

/** 顶栏通知入口：未读数角标 + 最近 10 条，完整列表在 /notifications */
function NotificationBell() {
  const { t } = useTranslation('notifications');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const text = useNotificationText();

  const listQuery = useQuery({
    queryKey: ['notifications', 'bell'],
    queryFn: () => notificationsApi.list({ pageSize: 10 }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = listQuery.data?.unreadCount ?? 0;
  const items = listQuery.data?.notifications ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative grid size-9 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
        aria-label={t('title')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-[var(--color-negative)] px-1 text-[10px] font-medium leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label={t('common:actions.close')}
          />
          <div role="menu" className="card absolute right-0 z-20 mt-1 w-80 overflow-hidden p-1 shadow-lg">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-medium">{t('title')}</span>
              <span className="text-xs text-[var(--color-content-muted)]">
                {t('subtitle', { count: unread })}
              </span>
            </div>

            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--color-content-muted)]">
                {t('empty.title')}
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {items.map((item) => (
                  <li key={item.id}>
                    <div className="flex items-start gap-2 px-3 py-2 hover:bg-black/5 dark:hover:bg-white/5">
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs ${item.readAt ? 'opacity-60' : ''}`}>{text(item)}</p>
                        <p className="mt-0.5 text-[10px] text-[var(--color-content-muted)]">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      {!item.readAt && (
                        <button
                          type="button"
                          className="shrink-0 text-[10px] text-[var(--color-accent)]"
                          onClick={() => markRead.mutate(item.id)}
                        >
                          {t('mark_read')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-[var(--color-border-subtle)] px-3 py-2 text-center text-xs text-[var(--color-accent)]"
            >
              {t('view_all')}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function TopBar({
  onOpenMobileNav,
  adminMode = false,
}: {
  onOpenMobileNav: () => void;
  adminMode?: boolean;
}) {
  const { sidebarCollapsed, toggleSidebar, theme, setTheme, language, setLanguage } = useUiStore();
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const isDark = theme !== 'light';
  const { t } = useTranslation();

  async function handleLogout() {
    // 即使接口失败也要清理本地会话，避免用户卡在无法退出的状态
    await authApi.logout().catch(() => undefined);
    clear();
    navigate('/login', { replace: true });
  }

  function handleLanguageChange(next: SupportedLanguage) {
    setLanguage(next);
    setLanguageOpen(false);
    // 已登录时同步到服务端，供跨设备保持一致
    if (user) {
      void authApi.updatePreferences({ language: next }).catch(() => undefined);
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-4">
      <button
        type="button"
        onClick={onOpenMobileNav}
        className="grid size-9 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5 md:hidden"
        aria-label={t('nav:open_nav')}
      >
        <Menu className="size-5" />
      </button>

      <button
        type="button"
        onClick={toggleSidebar}
        className="hidden size-9 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5 md:grid"
        aria-label={sidebarCollapsed ? t('nav:expand_sidebar') : t('nav:collapse_sidebar')}
      >
        {sidebarCollapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
      </button>

      <div className="flex-1" />

      <div className="relative">
        <button
          type="button"
          onClick={() => setLanguageOpen((open) => !open)}
          className="grid size-9 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
          aria-label={t('common:language.label')}
          aria-haspopup="menu"
          aria-expanded={languageOpen}
        >
          <Languages className="size-5" />
        </button>

        {languageOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setLanguageOpen(false)}
              aria-label={t('nav:close_menu')}
            />
            <div
              role="menu"
              className="card absolute right-0 z-20 mt-1 w-40 overflow-hidden p-1 shadow-lg"
            >
              {SUPPORTED_LANGUAGES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleLanguageChange(item)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${
                    language === item ? 'text-[var(--color-accent)]' : ''
                  }`}
                  aria-current={language === item}
                >
                  {t(`common:${LANGUAGE_LABEL_KEYS[item]}`)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 后台是运维视角，个人记账通知不在这里出现 */}
      {!adminMode && <NotificationBell />}

      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className="grid size-9 place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-black/5 dark:hover:bg-white/5"
        aria-label={isDark ? t('nav:theme_to_light') : t('nav:theme_to_dark')}
      >
        {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="grid size-7 place-items-center rounded-full bg-[var(--color-accent)]/15 text-xs font-medium text-[var(--color-accent)]">
            {user?.nickname.slice(0, 1) ?? '?'}
          </span>
          <span className="hidden max-w-28 truncate sm:block">{user?.nickname}</span>
        </button>

        {menuOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setMenuOpen(false)}
              aria-label={t('nav:close_menu')}
            />
            <div
              role="menu"
              className="card absolute right-0 z-20 mt-1 w-44 overflow-hidden p-1 shadow-lg"
            >
              <Link
                to="/profile"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
              >
                <User className="size-4" />
                {t('nav:profile')}
              </Link>

              {adminMode ? (
                <Link
                  to="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <ArrowLeft className="size-4" />
                  {t('admin:nav.back_to_app')}
                </Link>
              ) : (
                isAdminRole(user?.role) && (
                  <Link
                    to="/admin"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <ShieldCheck className="size-4" />
                    {t('nav:admin')}
                  </Link>
                )
              )}

              <div className="my-1 border-t border-[var(--color-border-subtle)]" />

              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-negative)] hover:bg-black/5 dark:hover:bg-white/5"
              >
                <LogOut className="size-4" />
                {t('nav:logout')}
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
