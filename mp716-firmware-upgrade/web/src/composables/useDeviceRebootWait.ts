import { computed, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getRouterApi, type SystemActionReceipt } from '@/api'
import { useAuthStore } from '@/stores/auth'

const FIRST_PROBE_MS = 10_000
const PROBE_EVERY_MS = 5_000
const MIN_BACK_MS = 120_000
const GIVE_UP_MS = 480_000
const FIRMWARE_GIVE_UP_MS = 900_000

export type RebootWaitPhase = 'idle' | 'down' | 'back' | 'failed' | 'timeout'

export type RebootWaitOptions = {
  firmware?: { task: string; version: string; boot: string }
  action?: SystemActionReceipt & { reset: boolean }
}

export function systemActionRoute(operation: 'reboot' | 'reset', receipt: SystemActionReceipt) {
  return {
    name: 'system-action-result',
    query: { operation, action: receipt.id, boot: receipt.boot },
  }
}

/** 刷写/重启后探测设备恢复（与 RebootOnlyPage 一致） */
export function useDeviceRebootWait(opts?: RebootWaitOptions) {
  const firmware = opts?.firmware
  const action = opts?.action
  const giveUpMs = firmware ? FIRMWARE_GIVE_UP_MS : GIVE_UP_MS
  const router = useRouter()
  const auth = useAuthStore()
  const phase = ref<RebootWaitPhase>('idle')
  const elapsedSec = ref(0)
  const failureMessage = ref('')
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
    let confirmed = false
    try {
      const api = getRouterApi()
      const response = await api.getPreLoginConfig()
      reachable = response.ok
      if (firmware && response.ok) {
        const { bootId, firmwareBoot, firmwareVersion } = response.data
        if (bootId && firmware.boot && bootId !== firmware.boot) {
          if (firmwareBoot?.expectedVersion === firmware.version && firmware.version) {
            confirmed = firmwareBoot.state === 'SUCCESS' && firmwareVersion === firmware.version
            if (firmwareBoot.state === 'FAILED' || (firmwareBoot.state === 'SUCCESS' && !confirmed))
              return failWait()
          }
        } else if (firmware.task) {
          const status = await api.getFirmwareV2Status(firmware.task)
          if (status.ok && status.data.taskId === firmware.task && status.data.state === 'FAILED')
            return failWait(status.data.message)
        }
      }
      if (action && response.ok) {
        const { bootId, systemAction, factoryResetMarker } = response.data
        if (action.id && systemAction?.id === action.id && systemAction.state === 'failed')
          return failWait()
        if (action.id && bootId && action.boot && bootId !== action.boot) {
          if (action.reset && factoryResetMarker === true) return failWait()
          confirmed = !action.reset || factoryResetMarker === false
        }
      }
    } catch {
      reachable = false
    }
    if (stopped) return
    if (!reachable) seenDown = true
    if (firmware || action ? confirmed : reachable && (seenDown || elapsed >= MIN_BACK_MS)) {
      phase.value = 'back'
      clearTimers()
      if (firmware || action) return
      auth.setSession(null)
      await router.replace({ name: 'login' })
      return
    }
    if (elapsed >= giveUpMs) {
      phase.value = 'timeout'
      clearTimers()
      return
    }
    probeTimer = window.setTimeout(() => void probe(), PROBE_EVERY_MS)
  }

  function failWait(message = '') {
    if (stopped) return
    failureMessage.value = message
    phase.value = 'failed'
    clearTimers()
  }

  function startWaiting() {
    clearTimers()
    failureMessage.value = ''
    stopped = false
    startedAt = Date.now()
    seenDown = false
    elapsedSec.value = 0
    phase.value = 'down'
    clockTimer = window.setInterval(() => {
      elapsedSec.value = Math.floor((Date.now() - startedAt) / 1000)
    }, 1000)
    probeTimer = window.setTimeout(() => void probe(), FIRST_PROBE_MS)
  }

  function goLogin() {
    auth.setSession(null)
    void router.replace({ name: 'login' })
  }

  function stop() {
    stopped = true
    clearTimers()
    phase.value = 'idle'
  }

  onUnmounted(() => stop())

  return { phase, waiting, elapsedText, failureMessage, startWaiting, goLogin, stop }
}
