<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

/** MT7628 关机 + 开机 + WiFi/隧道就绪实测约 3–5 分钟 */
const FIRST_PROBE_MS = 10_000
const PROBE_EVERY_MS = 5_000
/** 未观察到掉线时，至少等这么久才认为已重启完成，避免命中关机前的旧应答 */
const MIN_BACK_MS = 120_000
const GIVE_UP_MS = 480_000

type WaitPhase = 'idle' | 'down' | 'back' | 'timeout'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()
const rebootOpen = ref(false)
const rebooting = ref(false)
const phase = ref<WaitPhase>('idle')
const elapsedSec = ref(0)
let startedAt = 0
let seenDown = false
let probeTimer: number | undefined
let clockTimer: number | undefined
let stopped = false

const waiting = computed(() => phase.value !== 'idle')
const elapsedText = computed(() => {
  const m = Math.floor(elapsedSec.value / 60)
  const s = elapsedSec.value % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

function clearTimers() {
  if (probeTimer !== undefined) window.clearTimeout(probeTimer)
  if (clockTimer !== undefined) window.clearInterval(clockTimer)
  probeTimer = undefined
  clockTimer = undefined
}

async function probe() {
  if (stopped) return
  const elapsed = Date.now() - startedAt
  let reachable = false
  try {
    reachable = (await getRouterApi().getPreLoginConfig()).ok
  } catch {
    reachable = false
  }
  if (stopped) return
  if (!reachable) seenDown = true
  if (reachable && (seenDown || elapsed >= MIN_BACK_MS)) {
    phase.value = 'back'
    clearTimers()
    auth.setSession(null)
    await router.replace({ name: 'login' })
    return
  }
  if (elapsed >= GIVE_UP_MS) {
    phase.value = 'timeout'
    clearTimers()
    return
  }
  probeTimer = window.setTimeout(() => void probe(), PROBE_EVERY_MS)
}

function startWaiting() {
  startedAt = Date.now()
  seenDown = false
  elapsedSec.value = 0
  phase.value = 'down'
  clockTimer = window.setInterval(() => {
    elapsedSec.value = Math.floor((Date.now() - startedAt) / 1000)
  }, 1000)
  probeTimer = window.setTimeout(() => void probe(), FIRST_PROBE_MS)
}

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

function goLogin() {
  auth.setSession(null)
  void router.replace({ name: 'login' })
}

onUnmounted(() => {
  stopped = true
  clearTimers()
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
