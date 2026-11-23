<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    error?: string | null
    hint?: string
    forId?: string
    layout?: 'stack' | 'horizontal'
  }>(),
  { layout: 'stack' },
)
</script>

<template>
  <div class="field" :class="{ 'field--horizontal': layout === 'horizontal' }">
    <label v-if="forId" class="label" :for="forId">{{ label }}</label>
    <div v-else class="label">{{ label }}</div>
    <div class="control">
      <slot />
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.label {
  font-size: var(--fs-base);
  color: var(--color-title);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}
.control :deep(input:not([type='checkbox']):not([type='radio'])),
.control :deep(select),
.control :deep(textarea) {
  display: block;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
}
.control :deep(input::placeholder),
.control :deep(textarea::placeholder) {
  color: var(--color-muted);
  font-size: var(--fs-base);
}
.control :deep(input:focus),
.control :deep(select:focus),
.control :deep(textarea:focus) {
  outline: 2px solid rgba(22, 119, 255, 0.2);
  border-color: var(--color-primary);
}
.hint,
.error {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
}
.hint {
  color: var(--color-muted);
}
.error {
  color: var(--color-danger);
}
</style>
