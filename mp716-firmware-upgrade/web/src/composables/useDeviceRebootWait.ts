import { computed, onUnmounted, ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { getRouterApi } from '@/api'
import { useAuthStore } from '@/stores/auth'

const FIRST_PROBE_MS = 10_000
const PROBE_EVERY_MS = 5_000
const MIN_BACK_MS = 120_000
const GIVE_UP_MS = 480_000

export type RebootWaitPhase = 'idle' | 'down' | 'back' | 'timeout'

/** 刷写/重启后探测设备恢复（与 RebootOnlyPage 一致） */
export function useDeviceRebootWait() {
  const router = useRouter()
  const auth = useAuthStore()
  const phase = ref<RebootWaitPhase>('idle')
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

  return { phase, waiting, elapsedText, startWaiting, goLogin, stop } satisfies {
    phase: Ref<RebootWaitPhase>
    waiting: Ref<boolean>
    elapsedText: Ref<string>
    startWaiting: () => void
    goLogin: () => void
    stop: () => void
  }
}