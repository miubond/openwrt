import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'

export const LOCALE_OPTIONS = [
  { value: 'zh-CN', labelKey: 'locale.zhCN' },
  { value: 'en', labelKey: 'locale.en' },
  { value: 'zh-TW', labelKey: 'locale.zhTW' },
] as const

export type AppLocale = (typeof LOCALE_OPTIONS)[number]['value']

export const LOCALE_STORAGE_KEY = 'mp716.locale'

const loadedLocales = new Set<AppLocale>(['zh-CN'])

export function normalizeLocale(v: string | null | undefined): AppLocale {
  if (v === 'en' || v === 'zh-TW' || v === 'zh-CN') return v
  return 'zh-CN'
}

export function readStoredLocale(): AppLocale {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY))
  } catch {
    return 'zh-CN'
  }
}

/** 英文/繁体按需动态加载 */
export async function ensureLocaleMessages(locale: AppLocale): Promise<void> {
  const value = normalizeLocale(locale)
  if (loadedLocales.has(value) || value === 'zh-CN') {
    return
  }
  const mod =
    value === 'en'
      ? await import('./locales/en')
      : value === 'zh-TW'
        ? await import('./locales/zh-TW')
        : null
  if (mod) {
    i18n.global.setLocaleMessage(value, mod.default as unknown as typeof zhCN)
    loadedLocales.add(value)
  }
}

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN' as AppLocale,
  fallbackLocale: 'zh-CN' as AppLocale,
  messages: {
    'zh-CN': zhCN,
  },
})

export function applyDocumentLocale(locale: AppLocale) {
  document.documentElement.lang = locale
  document.title =
    locale === 'en'
      ? 'MP716 Network Manager'
      : locale === 'zh-TW'
        ? 'MP716 網路管理系統'
        : 'MP716 网络管理系统'
}
