import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN';

/** 新增语言只需在此登记目录、补一份资源文件，无需改动业务代码 */
const localeModules = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', {
  eager: true,
});

const NAMESPACES = [
  'common',
  'nav',
  'auth',
  'dashboard',
  'analytics',
  'budgets',
  'portfolios',
  'accounts',
  'transactions',
  'categories',
  'imports',
  'compound',
  'settings',
  'enums',
  'errors',
] as const;

type Resources = Record<string, Record<string, Record<string, unknown>>>;

function buildResources(): Resources {
  const resources: Resources = {};

  for (const [path, module] of Object.entries(localeModules)) {
    // 形如 ./locales/zh-CN/common.json
    const match = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!match) continue;

    const [, language, namespace] = match;
    if (!language || !namespace) continue;

    const content = (module as { default?: unknown }).default ?? module;

    resources[language] ??= {};
    resources[language]![namespace] = content as Record<string, unknown>;
  }

  return resources;
}

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** 浏览器语言匹配到支持列表，匹配不到回退默认语言 */
export function detectLanguage(): SupportedLanguage {
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.toLowerCase();

    const exact = SUPPORTED_LANGUAGES.find((lang) => lang.toLowerCase() === normalized);
    if (exact) return exact;

    const base = normalized.split('-')[0];
    const partial = SUPPORTED_LANGUAGES.find((lang) => lang.toLowerCase().split('-')[0] === base);
    if (partial) return partial;
  }

  return DEFAULT_LANGUAGE;
}

export function syncHtmlLang(language: string) {
  document.documentElement.lang = language;
}

const resources = buildResources();

i18n.use(initReactI18next).init({
  resources: resources as never,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  defaultNS: 'common',
  ns: [...NAMESPACES],
  interpolation: { escapeValue: false },
  returnNull: false,
  // 开发环境暴露缺失 key，便于抽取时发现遗漏
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: import.meta.env.DEV
    ? (lngs: readonly string[], ns: string, key: string) => {
        console.warn(`[i18n] 缺失翻译 ${lngs.join('/')} ${ns}:${key}`);
      }
    : undefined,
});

/** 浏览器标签页标题跟随界面语言 */
i18n.on('languageChanged', () => {
  document.title = i18n.t('auth:title');
});

export default i18n;
