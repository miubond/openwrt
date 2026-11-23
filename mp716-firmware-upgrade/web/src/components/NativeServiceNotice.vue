<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ available?: boolean; message?: string }>()
const { t } = useI18n()
</script>

<template>
  <p v-if="available === false" class="service-notice" role="status">
    {{ message || t('vpn.serviceUnavailable') }}
  </p>
</template>

<style scoped>
.service-notice {
  margin: 0 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-muted);
  background: var(--color-surface);
  line-height: var(--lh-base);
}
</style>
