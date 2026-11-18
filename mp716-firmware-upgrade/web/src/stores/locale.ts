import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  applyDocumentLocale,
  ensureLocaleMessages,
  i18n,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  readStoredLocale,
  type AppLocale,
} from '@/i18n'

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<AppLocale>(readStoredLocale())
  const isZh = computed(() => locale.value.startsWith('zh'))

  async function setLocale(next: AppLocale) {
    const value = normalizeLocale(next)
    await ensureLocaleMessages(value)
    locale.value = value
    i18n.global.locale.value = value as typeof i18n.global.locale.value
    localStorage.setItem(LOCALE_STORAGE_KEY, value)
    applyDocumentLocale(value)
  }

  async function init() {
    await setLocale(locale.value)
  }

  return { locale, isZh, setLocale, init }
})
