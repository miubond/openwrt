<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ label?: string }>()
const { t } = useI18n()
</script>

<template>
  <div class="loading" role="status">
    <span class="spinner" />
    <p>{{ label || t('common.loading') }}</p>
  </div>
</template>

<style scoped>
.loading {
  display: grid;
  place-items: center;
  gap: 0.75rem;
  padding: 2.5rem 1rem;
  color: var(--color-muted);
}
.spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
