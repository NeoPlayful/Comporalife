import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n, {
  DEFAULT_LANGUAGE,
  detectLanguage,
  isSupportedLanguage,
  syncHtmlLang,
  type SupportedLanguage,
} from '@/i18n';
import { applyTheme, readStoredTheme, watchSystemTheme, type Theme } from '@/theme/theme';

interface UiState {
  sidebarCollapsed: boolean;
  theme: Theme;
  language: SupportedLanguage;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: SupportedLanguage) => void;
}

function applyLanguage(language: SupportedLanguage) {
  void i18n.changeLanguage(language);
  syncHtmlLang(language);
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      theme: readStoredTheme(),
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

// 「跟随系统」时，系统配色变化要实时反映到页面上。
watchSystemTheme(
  () => useUiStore.getState().theme,
  (resolved) => applyTheme(resolved),
);
