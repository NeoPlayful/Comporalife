/**
 * 主题的运行时逻辑。
 *
 * 主题状态本身存在 ui-store 里，这里只负责把它落到文档上：切换 `dark` 类、
 * 同步 `color-scheme`、以及在「跟随系统」模式下响应系统配色变化。
 * 单独成模块是因为首屏防闪烁脚本和三处调用方都要用同一套判定，
 * 判定逻辑散开就会出现「设置里是浅色、页面还是深的」这种不一致。
 */

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const DEFAULT_THEME: Theme = 'dark';
const STORAGE_KEY = 'cl-ui';

const media = () =>
  typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light' || value === 'system';
}

/** 把「跟随系统」折算成实际生效的主题 */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') {
    return media()?.matches ? 'dark' : 'light';
  }
  return theme;
}

/** 把主题落到 <html> 上：类名决定样式，color-scheme 决定表单控件的原生配色 */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

/**
 * 跟随系统变化。
 *
 * 只有处于「跟随系统」时才需要重绘；其它两档被系统变化影响反而会闪。
 * 返回取消订阅的函数，供 store 在切换档位时清掉旧的监听。
 */
export function watchSystemTheme(getTheme: () => Theme, onChange: (resolved: ResolvedTheme) => void) {
  const query = media();
  if (!query) return () => {};

  const handler = () => {
    if (getTheme() === 'system') onChange(query.matches ? 'dark' : 'light');
  };

  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}

/**
 * 首屏读取已保存的主题。
 *
 * persist 中间件把整份状态存成 JSON，主题只是其中一个字段，所以这里解析
 * 整份数据再取 theme。解析失败按默认值处理——首屏脚本绝不能抛错。
 */
export function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'state' in parsed) {
      const state = (parsed as { state?: { theme?: unknown } }).state;
      if (isTheme(state?.theme)) return state.theme;
    }
  } catch {
    // 存储被禁用或内容损坏时走默认值
  }
  return DEFAULT_THEME;
}
