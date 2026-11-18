import { i18n } from '@/i18n'

/** 适配器等非组件上下文取当前语言文案 */
export function tGlobal(key: string, params?: Record<string, unknown>): string {
  return String(i18n.global.t(key, params as Record<string, string>))
}
