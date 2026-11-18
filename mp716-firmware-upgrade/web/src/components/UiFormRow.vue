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
.form-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  column-gap: 16px;
  align-items: start;
  margin-bottom: 18px;
}
.form-row .label {
  font-weight: 500;
  color: var(--color-title);
  font-size: var(--fs-base);
  line-height: 1.4;
  /* 与右侧开关（高 24px）垂直居中对齐，提示文案向下扩展不影响标签 */
  min-height: 24px;
  display: flex;
  align-items: center;
}
.form-row--status .label {
  min-height: 0;
  display: block;
}
.form-row-body :deep(.value) {
  color: var(--color-title);
}
@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
