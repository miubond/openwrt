<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    block?: boolean
  }>(),
  { variant: 'primary', type: 'button', disabled: false, block: false },
)

defineEmits<{ click: [MouseEvent] }>()
</script>

<template>
  <button
    class="btn"
    :class="[variant, { block }]"
    :type="type"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  cursor: pointer;
  touch-action: manipulation;
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.btn.block {
  width: 100%;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.primary {
  background: var(--color-primary);
  color: #fff;
}
.primary:hover:not(:disabled) {
  background: var(--color-primary-hover);
}
.secondary {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-text);
}
@media (max-width: 640px) {
  .btn {
    min-height: var(--touch-min);
    padding: 10px 16px;
  }
}

.secondary:hover:not(:disabled) {
  border-color: #c9cdd4;
  color: var(--color-primary);
}
.danger {
  background: var(--color-danger);
  color: #fff;
}
.ghost {
  background: transparent;
  color: var(--color-primary);
}
</style>
