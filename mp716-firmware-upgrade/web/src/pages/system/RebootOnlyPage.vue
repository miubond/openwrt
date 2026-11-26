<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { useDeviceRebootWait } from '@/composables/useDeviceRebootWait'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const route = useRoute()
const toast = useToastStore()
const { phase, waiting, elapsedText, startWaiting, goLogin } = useDeviceRebootWait()
const rebootOpen = ref(false)
const rebooting = ref(false)

async function doReboot() {
  rebootOpen.value = false
  rebooting.value = true
  try {
    unwrap(await getRouterApi().rebootDevice())
    startWaiting()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    rebooting.value = false
  }
}

onMounted(() => {
  if (route.query.wait === '1') startWaiting()
})
</script>

<template>
  <div>
    <UiCard v-if="!waiting" :subtitle="t('sysReboot.subtitle')">
      <div class="actions">
        <UiButton variant="secondary" :disabled="rebooting" @click="rebootOpen = true">
          {{ rebooting ? t('sysReboot.rebooting') : t('sysReboot.rebootBtn') }}
        </UiButton>
      </div>
    </UiCard>
    <UiCard v-else :subtitle="t('sysReboot.waitTitle')">
      <div class="wait">
        <div v-if="phase !== 'timeout'" class="spinner" aria-hidden="true" />
        <p class="wait-main">
          {{ phase === 'back' ? t('sysReboot.waitBack') : phase === 'timeout' ? t('sysReboot.waitTimeout') : t('sysReboot.waitDown') }}
        </p>
        <p class="wait-elapsed">{{ t('sysReboot.waitElapsed', { time: elapsedText }) }}</p>
        <p class="wait-hint">{{ t('sysReboot.waitHint') }}</p>
        <UiButton v-if="phase === 'timeout'" variant="secondary" @click="goLogin">
          {{ t('sysReboot.waitGoLogin') }}
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
  justify-content: center;
  padding: 20px 0 8px;
}

.actions :deep(.btn) {
  min-width: 180px;
  border-radius: 999px;
}

.wait {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 0 12px;
  text-align: center;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border, #e5e7eb);
  border-top-color: var(--color-primary, #2563eb);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

.wait-main {
  font-weight: var(--fw-medium, 500);
  color: var(--color-title, inherit);
}

.wait-elapsed {
  font-variant-numeric: tabular-nums;
}

.wait-hint {
  max-width: 460px;
  font-size: var(--fs-sm, 13px);
  color: var(--color-text-secondary, #6b7280);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>