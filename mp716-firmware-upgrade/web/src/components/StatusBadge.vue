<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  status: 'up' | 'down' | 'warn' | 'unknown'
  label?: string
}>()
const { t } = useI18n()
const fallback = computed(() => {
  if (props.status === 'up') return t('common.statusUp')
  if (props.status === 'down') return t('common.statusDown')
  if (props.status === 'warn') return t('common.statusWarn')
  return t('common.statusUnknown')
})
</script>

<template>
  <span class="badge" :class="status">
    <i />
    {{ label || fallback }}
  </span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-bg-muted);
  color: var(--color-text);
}
i {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--color-muted);
}
.up {
  background: var(--color-success-soft);
  color: #00801c;
}
.up i {
  background: var(--color-success);
}
.down {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
.down i {
  background: var(--color-danger);
}
.warn {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}
.warn i {
  background: var(--color-warning);
}
</style>
