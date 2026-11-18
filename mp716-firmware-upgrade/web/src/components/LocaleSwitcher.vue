<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiIcon from '@/components/UiIcon.vue'
import { LOCALE_OPTIONS, type AppLocale } from '@/i18n'
import { useLocaleStore } from '@/stores/locale'

withDefaults(
  defineProps<{
    variant?: 'header' | 'login'
  }>(),
  { variant: 'header' },
)

const { t } = useI18n()
const localeStore = useLocaleStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function toggle() {
  open.value = !open.value
}

function pick(value: AppLocale) {
  open.value = false
  void localeStore.setLocale(value)
}

function onDocClick(e: MouseEvent) {
  if (!root.value?.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="locale" :class="`locale--${variant}`">
    <button
      class="locale-btn"
      type="button"
      :title="t('locale.label')"
      :aria-label="t('locale.label')"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <UiIcon name="languages" :size="16" />
      <span class="locale-code">{{ localeStore.locale === 'zh-CN' ? '简' : localeStore.locale === 'zh-TW' ? '繁' : 'EN' }}</span>
    </button>
    <div v-if="open" class="locale-menu" role="listbox" @click.stop>
      <button
        v-for="opt in LOCALE_OPTIONS"
        :key="opt.value"
        type="button"
        role="option"
        :aria-selected="localeStore.locale === opt.value"
        :class="{ active: localeStore.locale === opt.value }"
        @click="pick(opt.value)"
      >
        {{ t(opt.labelKey) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.locale {
  position: relative;
}

.locale-btn {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.locale--header .locale-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.locale--login .locale-btn {
  width: auto;
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  backdrop-filter: blur(8px);
}

.locale--login .locale-btn:hover {
  background: rgba(255, 255, 255, 0.22);
}

.locale-code {
  letter-spacing: 0.02em;
}

.locale-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 132px;
  background: var(--color-surface);
  color: var(--color-title);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-menu);
  z-index: 80;
}

.locale-menu button {
  width: 100%;
  border: 0;
  background: var(--color-surface);
  color: var(--color-title);
  text-align: left;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1.3;
}

.locale-menu button:hover,
.locale-menu button.active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}
</style>
