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
.field--horizontal {
  display: grid;
  flex-direction: unset;
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

<style>
.field.field--horizontal {
  grid-template-columns: 140px minmax(0, 1fr);
  column-gap: 20px;
  row-gap: 6px;
  align-items: start;
  margin-bottom: 18px;
}

.field.field--horizontal > .label {
  grid-column: 1;
  grid-row: 1;
  padding-top: 9px;
  font-weight: var(--fw-medium);
  color: var(--color-text);
}

.field.field--horizontal > .control {
  grid-column: 2;
  grid-row: 1;
  max-width: 320px;
}

.field.field--horizontal > .hint,
.field.field--horizontal > .error {
  grid-column: 2;
  grid-row: 2;
  max-width: 320px;
}

.settings-form .field.field--horizontal > .control {
  max-width: 420px;
}

.settings-form .field.field--horizontal .control input:not([type='checkbox']):not([type='radio']):not([type='file']),
.settings-form .field.field--horizontal .control textarea {
  background: var(--color-bg-muted);
  border-color: transparent;
}

.settings-form .field.field--horizontal .control input:not([type='checkbox']):not([type='radio']):focus,
.settings-form .field.field--horizontal .control textarea:focus {
  background: var(--color-surface);
  border-color: var(--color-primary);
  outline: none;
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.1);
}

.settings-form .field.field--horizontal .control input[readonly] {
  color: var(--color-muted);
  cursor: default;
}

.settings-form .field.field--horizontal .control .ui-select {
  width: 100%;
  max-width: none;
}

.settings-form .field.field--horizontal .control .ui-select-trigger {
  background: var(--color-bg-muted);
  border-color: transparent;
}

.settings-form .field.field--horizontal .control .ui-select.open .ui-select-trigger,
.settings-form .field.field--horizontal .control .ui-select-trigger:hover,
.settings-form .field.field--horizontal .control .ui-select-trigger:focus-visible {
  background: var(--color-surface);
  border-color: var(--color-primary);
}

@media (max-width: 640px) {
  .field.field--horizontal {
    grid-template-columns: 1fr;
  }

  .field.field--horizontal > .label {
    padding-top: 0;
  }

  .field.field--horizontal > .control,
  .field.field--horizontal > .hint,
  .field.field--horizontal > .error {
    grid-column: 1;
    max-width: none;
  }
}
</style>
