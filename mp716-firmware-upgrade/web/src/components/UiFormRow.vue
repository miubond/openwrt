<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string
    variant?: 'switch' | 'status'
  }>(),
  { variant: 'switch' },
)
</script>

<template>
  <div class="form-row" :class="variant === 'status' ? 'form-row--status' : 'form-row--switch'">
    <div v-if="label" class="label">{{ label }}</div>
    <slot v-else name="label" />
    <div class="form-row-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.label { color: var(--color-title); font-size: var(--fs-base); font-weight: var(--fw-semibold); line-height: var(--lh-tight); }
.form-row-body { min-width: 0; }
.form-row-body :deep(.value) { color: var(--color-title); }
</style>
