import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

let seq = 1

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([])

  function push(kind: ToastKind, message: string, ttl = 3200) {
    const id = seq++
    items.value.push({ id, kind, message })
    window.setTimeout(() => dismiss(id), ttl)
  }

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id)
  }

  return {
    items,
    dismiss,
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m),
    warning: (m: string) => push('warning', m),
    info: (m: string) => push('info', m),
  }
})
