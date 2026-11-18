import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'mp716.theme'

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'dark' ? 'dark' : 'light'
}

function applyDom(mode: ThemeMode) {
  const root = document.documentElement
  root.dataset.theme = mode
  root.classList.toggle('dark', mode === 'dark')
  root.style.colorScheme = mode
  const meta = document.querySelector('meta[name="color-scheme"]')
  if (meta) meta.setAttribute('content', mode)
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored())
  const isDark = computed(() => mode.value === 'dark')

  function setTheme(next: ThemeMode) {
    mode.value = next
    localStorage.setItem(STORAGE_KEY, next)
    applyDom(next)
  }

  function toggleTheme() {
    setTheme(mode.value === 'dark' ? 'light' : 'dark')
  }

  function init() {
    applyDom(mode.value)
  }

  return { mode, isDark, setTheme, toggleTheme, init }
})
