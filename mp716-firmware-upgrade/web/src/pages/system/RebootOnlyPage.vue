<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import { formatApiError, getApiMode, getRouterApi, unwrap } from '@/api'
import { systemActionRoute, useDeviceRebootWait } from '@/composables/useDeviceRebootWait'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const toast = useToastStore()
const firmwareWait = computed(() => route.query.firmware === '1')
const actionResult = route.name === 'system-action-result'
const resetResult = actionResult && route.query.operation === 'reset'
function queryString(key: string) {
  const value = route.query[key]
  return typeof value === 'string' ? value : ''
}
const { phase, waiting, elapsedText, failureMessage, startWaiting, goLogin } = useDeviceRebootWait({
  firmware: firmwareWait.value ? {
    task: queryString('task'),
    version: queryString('version'),
    boot: queryString('boot'),
  } : undefined,
  action: actionResult ? { id: queryString('action'), boot: queryString('boot'), reset: resetResult } : undefined,
})
const rebootOpen = ref(false)
const rebooting = ref(false)

async function doReboot() {
  rebootOpen.value = false
  rebooting.value = true
  try {
    const result = unwrap(await getRouterApi().rebootDevice())
    if (result.systemAction) {
      await router.push(systemActionRoute('reboot', result.systemAction))
    } else if (getApiMode() !== 'device') {
      startWaiting()
    } else {
      toast.warning(t('sysReboot.waitActionUnconfirmed'))
    }
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    rebooting.value = false
  }
}

onMounted(() => {
  if (actionResult || route.query.wait === '1') startWaiting()
})
</script>

<template>
  <div :class="{ 'action-result': actionResult }">
    <UiCard v-if="!waiting" :subtitle="t('sysReboot.subtitle')">
      <div class="actions">
        <UiButton variant="secondary" :disabled="rebooting" @click="rebootOpen = true">
          {{ rebooting ? t('sysReboot.rebooting') : t('sysReboot.rebootBtn') }}
        </UiButton>
      </div>
    </UiCard>
    <UiCard v-else :subtitle="t(resetResult ? 'sysReset.resultTitle' : 'sysReboot.waitTitle')">
      <div class="wait">
        <div v-if="phase === 'down'" class="spinner" aria-hidden="true" />
        <p class="wait-main">
          {{ phase === 'failed' ? (failureMessage || t(firmwareWait ? 'sysReboot.waitFirmwareFailed' :
              resetResult ? 'sysReset.resultFailed' : 'sysReboot.waitActionFailed')) :
            phase === 'back' ? t(firmwareWait ? 'sysReboot.waitFirmwareConfirmed' :
              resetResult ? 'sysReset.resultConfirmed' : actionResult ? 'sysReboot.waitActionConfirmed' : 'sysReboot.waitBack') :
            phase === 'timeout' ? t(firmwareWait ? 'sysReboot.waitFirmwareUnconfirmed' :
              resetResult ? 'sysReset.resultUnconfirmed' : actionResult ? 'sysReboot.waitActionUnconfirmed' : 'sysReboot.waitTimeout') :
            t(resetResult ? 'sysReset.warnResetting' : 'sysReboot.waitDown') }}
        </p>
        <p class="wait-elapsed">{{ t('sysReboot.waitElapsed', { time: elapsedText }) }}</p>
        <p v-if="phase === 'down'" class="wait-hint">
          {{ firmwareWait ? t('sysReboot.waitFirmwareHint') : t('sysReboot.waitHint') }}
        </p>
        <UiButton v-if="phase === 'timeout' || phase === 'back'" variant="secondary" @click="goLogin">
          {{ t('sysReboot.waitGoLogin') }}
        </UiButton>
        <UiButton v-if="phase === 'failed' && firmwareWait" variant="secondary" @click="router.replace({ name: 'sys-upgrade' })">
          {{ t('sysReboot.waitGoUpgrade') }}
        </UiButton>
        <UiButton v-if="phase === 'failed' && actionResult" variant="secondary"
          @click="router.replace({ name: resetResult ? 'sys-reset' : 'sys-reboot' })">
          {{ t('sysReboot.waitGoBack') }}
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
.action-result {
  max-width: 660px;
  margin: 32px auto;
  padding: 0 16px;
}

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
