<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '@/components/UiButton.vue'

const props = withDefaults(
  defineProps<{
    loading?: boolean
    disabled?: boolean
    label?: string
    loadingLabel?: string
    align?: 'center' | 'end'
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  }>(),
  {
    loading: false,
    disabled: false,
    align: 'center',
    variant: 'primary',
  },
)

const emit = defineEmits<{ apply: [] }>()
const { t } = useI18n()
const displayLabel = computed(() => props.label ?? t('common.apply'))
const displayLoadingLabel = computed(() => props.loadingLabel ?? t('common.applying'))
</script>

<template>
  <div class="form-actions" :class="`align-${align}`">
    <UiButton
      :variant="variant"
      type="button"
      :disabled="disabled || loading"
      @click="emit('apply')"
    >
      {{ loading ? displayLoadingLabel : displayLabel }}
    </UiButton>
  </div>
</template>

<style scoped>
.form-actions {
  display: flex;
  padding-top: 8px;
}
.form-actions.align-center {
  justify-content: center;
}
.form-actions.align-end {
  justify-content: flex-end;
}
.form-actions :deep(.btn) {
  min-width: 180px;
  border-radius: 999px;
}
</style>
