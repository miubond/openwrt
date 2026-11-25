<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ConfigTaskPhase } from '@/api/types'

const props = defineProps<{
  remaining: number
  applying?: boolean
  phase?: ConfigTaskPhase
  message?: string
}>()
defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()

const titleKey = computed(() =>
  props.phase === 'failed'
    ? 'apply.failedTitle'
    : props.phase === 'rolling_back'
      ? 'apply.rollingBackTitle'
      : props.phase === 'prepared' || props.phase === 'applying'
        ? 'apply.inProgressTitle'
        : 'apply.waitingTitle',
)

/** 等待确认时始终展示倒计时；设备 message 往往不含 remainingSec */
const description = computed(() => {
  if (props.phase === 'failed') return props.message || t('apply.failedDesc')
  if (props.phase === 'rolling_back') return props.message || t('apply.rollingBackDesc')
  if (props.phase === 'prepared' || props.phase === 'applying') {
    return props.message || t('apply.inProgressDesc')
  }
  return t('apply.waitingDesc', { n: props.remaining })
})
</script>

<template>
  <div class="banner" role="alert">
    <div class="text">
      <strong>{{ t(titleKey) }}</strong>
      <p>{{ description }}</p>
    </div>
    <div class="actions">
      <button type="button" class="sec" :disabled="applying" @click="$emit('cancel')">
        {{ t('apply.rollback') }}
      </button>
      <button
        type="button"
        class="pri"
        :disabled="applying || (phase != null && phase !== 'applied')"
        @click="$emit('confirm')"
      >
        {{
          applying && (phase == null || phase === 'applied')
            ? t('common.applying')
            : t('apply.keep')
        }}
      </button>
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
.sec:disabled,
.pri:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
@media (max-width: 640px) {
  .banner {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
