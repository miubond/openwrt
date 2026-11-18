<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ConfigTaskPhase } from '@/api/types'

defineProps<{
  remaining: number
  applying?: boolean
  phase?: ConfigTaskPhase
  message?: string
}>()
defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="banner" role="alert">
    <div class="text">
      <strong>{{ t(phase === 'failed' ? 'apply.failedTitle' : phase === 'rolling_back' ? 'apply.rollingBackTitle' : phase === 'prepared' || phase === 'applying' ? 'apply.inProgressTitle' : 'apply.waitingTitle') }}</strong>
      <p>{{ message || t(phase === 'failed' ? 'apply.failedDesc' : phase === 'rolling_back' ? 'apply.rollingBackDesc' : phase === 'prepared' || phase === 'applying' ? 'apply.inProgressDesc' : 'apply.waitingDesc', { n: remaining }) }}</p>
    </div>
    <div class="actions">
      <button type="button" class="sec" :disabled="applying" @click="$emit('cancel')">{{ t('apply.rollback') }}</button>
      <button type="button" class="pri" :disabled="applying || (phase != null && phase !== 'applied')" @click="$emit('confirm')">{{ t('apply.keep') }}</button>
    </div>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  background: var(--color-primary-soft);
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
  color: var(--color-primary);
  border-radius: var(--radius);
  padding: 12px 14px;
  margin-bottom: 16px;
}
.text strong {
  display: block;
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}
.banner p {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
  font-weight: var(--fw-regular);
  opacity: 0.9;
}
.actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
button {
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  padding: 6px 12px;
  cursor: pointer;
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}
.sec {
  background: var(--color-surface);
  border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
  color: var(--color-primary);
}
.pri {
  background: var(--color-primary);
  color: #fff;
}
@media (max-width: 640px) {
  .banner {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
