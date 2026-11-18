<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  label: string
  description?: string
  modelValue: boolean
  danger?: boolean
}>()
defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useI18n()
</script>

<template>
  <div class="toggle" :class="{ danger }">
    <div class="text">
      <div class="title">{{ label }}</div>
      <p v-if="description" class="desc">{{ description }}</p>
    </div>
    <label class="switch">
      <input
        type="checkbox"
        :checked="modelValue"
        @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span class="track" aria-hidden="true"><span class="thumb" /></span>
      <span class="state">{{ modelValue ? t('common.on') : t('common.off') }}</span>
    </label>
  </div>
</template>

<style scoped>
.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid var(--color-border);
}
.toggle:last-child {
  border-bottom: 0;
}
.text {
  min-width: 0;
}
.title {
  color: var(--color-title);
  font-weight: var(--fw-semibold);
  font-size: var(--fs-base);
  line-height: var(--lh-tight);
}
.desc {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
}
.switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
}
.switch input {
  position: absolute;
  margin: 0;
  inset: 0 auto 0 0;
  width: 46px;
  height: 28px;
  opacity: 0;
  cursor: pointer;
  z-index: 2;
}
.track {
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-muted) 45%, var(--color-border));
  position: relative;
  transition: background 0.15s ease;
  pointer-events: none;
}
.thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
  transition: transform 0.15s ease;
}
.switch input:checked + .track {
  background: var(--color-primary);
}
.switch input:focus-visible + .track {
  outline: 2px solid rgba(22, 119, 255, 0.35);
  outline-offset: 2px;
}
.switch input:checked + .track .thumb {
  transform: translateX(18px);
}
.danger .switch input:checked + .track {
  background: var(--color-warning);
}
.state {
  min-width: 1.25rem;
  font-size: var(--fs-xs);
  line-height: var(--lh-tight);
  color: var(--color-muted);
}
@media (max-width: 640px) {
  .toggle {
    align-items: flex-start;
  }
}
</style>
