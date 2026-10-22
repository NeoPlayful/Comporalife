import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n, {
  DEFAULT_LANGUAGE,
  detectLanguage,
  isSupportedLanguage,
  syncHtmlLang,
  type SupportedLanguage,
} from '@/i18n';

type Theme = 'dark' | 'light' | 'system';

interface UiState {
  sidebarCollapsed: boolean;
  theme: Theme;
  language: SupportedLanguage;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: SupportedLanguage) => void;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', isDark);
}

function applyLanguage(language: SupportedLanguage) {
  void i18n.changeLanguage(language);
  syncHtmlLang(language);
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: 'dark',
      // 首屏先用浏览器语言，登录后由用户偏好覆盖
      language: detectLanguage(),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setLanguage: (language) => {
        const next = isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;
        applyLanguage(next);
        set({ language: next });
      },
    }),
    {
      name: 'cl-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        language: state.language,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyTheme(state.theme);
        applyLanguage(state.language);
      },
    },
  ),
);
