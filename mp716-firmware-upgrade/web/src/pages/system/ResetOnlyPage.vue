<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { begin } = useApplyConfirm()
const resetOpen = ref(false)
const resetting = ref(false)

async function doReset() {
  resetOpen.value = false
  resetting.value = true
  try {
    const result = unwrap(await getRouterApi().factoryReset({ confirmToken: 'RESET' }))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    toast.warning(t('sysReset.warnResetting'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div>
    <UiCard :subtitle="t('sysReset.subtitle')">
      <div class="actions">
        <UiButton variant="secondary" :disabled="resetting" @click="resetOpen = true">
          {{ resetting ? t('sysReset.resetting') : t('sysReset.resetBtn') }}
        </UiButton>
      </div>
    </UiCard>
    <UiModal :open="resetOpen" :title="t('sysReset.confirmTitle')" danger @close="resetOpen = false" @confirm="doReset">
      {{ t('sysReset.confirmBody') }}
    </UiModal>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  justify-content: center;
  padding: 20px 0 8px;
}

.actions :deep(.btn) {
  min-width: 180px;
  border-radius: 999px;
}
</style>
