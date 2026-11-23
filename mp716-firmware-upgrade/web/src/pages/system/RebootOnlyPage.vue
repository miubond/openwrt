<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const rebootOpen = ref(false)
const rebooting = ref(false)

async function doReboot() {
  rebootOpen.value = false
  rebooting.value = true
  try {
    unwrap(await getRouterApi().rebootDevice())
    toast.info(t('sysReboot.warnPower'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    rebooting.value = false
  }
}
</script>

<template>
  <div>
    <UiCard :subtitle="t('sysReboot.subtitle')">
      <div class="actions">
        <UiButton variant="secondary" :disabled="rebooting" @click="rebootOpen = true">
          {{ rebooting ? t('sysReboot.rebooting') : t('sysReboot.rebootBtn') }}
        </UiButton>
      </div>
    </UiCard>
    <UiModal
      :open="rebootOpen"
      :title="t('common.rebootConfirmTitle')"
      @close="rebootOpen = false"
      @confirm="doReboot"
    >
      {{ t('sysReboot.warnDevice') }}
    </UiModal>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  justify-content: flex-start;
  padding: 20px 0 8px;
}

.actions :deep(.btn) {
  min-width: 180px;
  border-radius: var(--radius-sm);
}
</style>
