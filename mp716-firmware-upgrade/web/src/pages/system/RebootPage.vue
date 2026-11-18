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
const rebootOpen = ref(false)
const resetOpen = ref(false)

async function doReboot() {
  rebootOpen.value = false
  try {
    unwrap(await getRouterApi().rebootDevice())
    toast.info(t('common.rebooting'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  }
}

async function doReset() {
  resetOpen.value = false
  try {
    const result = unwrap(await getRouterApi().factoryReset({ confirmToken: 'RESET' }))
    await begin(asApplyHandle(result))
    toast.warning(t('sysReset.triggered'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  }
}
</script>

<template>
  <div class="space-y-4">
    <UiCard :title="t('sysReboot.cardTitle')">
      <p class="mb-3 text-[12px] leading-normal text-subtle">{{ t('sysReboot.briefInterrupt') }}</p>
      <UiButton variant="secondary" @click="rebootOpen = true">{{ t('sysReboot.rebootNow') }}</UiButton>
    </UiCard>
    <UiCard :title="t('sysReset.cardTitle')">
      <p class="mb-3 text-[12px] leading-normal text-subtle">{{ t('sysReset.cardBody') }}</p>
      <UiButton variant="danger" @click="resetOpen = true">{{ t('sysReset.resetBtn') }}</UiButton>
    </UiCard>

    <UiModal
      :open="rebootOpen"
      :title="t('common.rebootConfirmTitle')"
      @close="rebootOpen = false"
      @confirm="doReboot"
    >
      {{ t('common.rebootConfirmBody') }}
    </UiModal>
    <UiModal :open="resetOpen" :title="t('sysReset.confirmTitle')" danger @close="resetOpen = false" @confirm="doReset">
      {{ t('sysReset.cardBody') }}
    </UiModal>
  </div>
</template>
