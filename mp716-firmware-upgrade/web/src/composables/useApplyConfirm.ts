import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { ApplyHandle, ConfigApplyResult, ConfigTaskStatus } from '@/api'
import { useToastStore } from '@/stores/toast'

const TICK_MS = 1000
/** 应用中 / 回滚中需较快感知阶段变化 */
const POLL_EVERY_ACTIVE_TICKS = 1
/** 等待确认时只靠本地倒计时，低频校对设备状态 */
const POLL_EVERY_IDLE_TICKS = 5

/** The device owns both service-application results and rollback deadlines. */
export function useApplyConfirm(onRollback?: () => void, onConfirmed?: () => void) {
  const pending = ref<ApplyHandle | null>(null)
  const remaining = ref(0)
  const requesting = ref(false)
  const applying = computed(() => requesting.value || ['prepared', 'applying', 'rolling_back'].includes(pending.value?.phase || ''))
  const canConfirm = computed(() => Boolean(pending.value) && !applying.value && pending.value?.state !== 'failed'
    && (pending.value?.phase == null || pending.value.phase === 'applied'))
  let timer: number | undefined
  let generation = 0
  let operation = 0
  let pollingGeneration: number | undefined
  let ticksSincePoll = 0
  let rollbackRequested = false
  let lastFailure = ''
  const { t } = useI18n()
  const toast = useToastStore()

  function clearTimer() {
    if (timer !== undefined) window.clearInterval(timer)
    timer = undefined
  }
  function finish() {
    ++generation
    ++operation
    clearTimer()
    pending.value = null
    remaining.value = 0
    requesting.value = false
  }
  function pollIntervalTicks(): number {
    const phase = pending.value?.phase
    if (phase === 'prepared' || phase === 'applying' || phase === 'rolling_back') return POLL_EVERY_ACTIVE_TICKS
    if (remaining.value <= 0) return POLL_EVERY_ACTIVE_TICKS
    return POLL_EVERY_IDLE_TICKS
  }
  function adoptRemaining(status: ConfigTaskStatus, prevPhase: ApplyHandle['phase']) {
    if (status.remainingSec == null) return
    const server = Math.max(0, status.remainingSec)
    const nextPhase = status.phase
    const enteredApplied =
      nextPhase === 'applied' && prevPhase != null && prevPhase !== 'applied'
    const active =
      nextPhase === 'prepared' || nextPhase === 'applying' || nextPhase === 'rolling_back'
    // 等待确认阶段以本地秒表为准，避免每轮轮询把倒计时“刷”回去
    if (enteredApplied || active || status.state !== 'pending') {
      remaining.value = server
    } else if (server + 2 < remaining.value) {
      remaining.value = server
    }
  }
  function consume(status: ConfigTaskStatus): void {
    if (!pending.value) return
    if (status.taskId && status.taskId !== pending.value.applyId) throw new Error('设备返回了其他配置任务')
    const prevPhase = pending.value.phase
    adoptRemaining(status, prevPhase)
    pending.value = { ...pending.value, state: status.state, phase: status.phase,
      message: status.rollbackError || status.applyError || status.message }
    if (status.state === 'confirmed') {
      finish()
      toast.success(t('apply.confirmed'))
      onConfirmed?.()
    } else if (status.state === 'rolled_back') {
      const cancelled = rollbackRequested
      finish()
      if (cancelled) toast.info(t('apply.cancelled'))
      else toast.warning(t('apply.timeoutRollback'))
      onRollback?.()
    } else if (status.state === 'failed' || status.phase === 'failed') {
      const message = pending.value.message || t('apply.failedDesc')
      if (message !== lastFailure) toast.error(message)
      lastFailure = message
      // Keep the task and its snapshot. The user may retry rollback.
    } else lastFailure = ''
  }
  async function pollStatus(current: number, revision: number, applyId: string) {
    if (pollingGeneration === current) return
    pollingGeneration = current
    ticksSincePoll = 0
    try {
      const res = await getRouterApi().getConfigTaskStatus(applyId)
      if (current !== generation || revision !== operation || !res.ok) return
      consume(res.data)
    } catch {
      // A dropped connection is expected after changing LAN/Wi-Fi settings.
      // Keep the task until the actual device result becomes available.
    } finally {
      if (pollingGeneration === current) pollingGeneration = undefined
    }
  }
  async function begin(handle: ApplyHandle | ConfigApplyResult) {
    const normalized = 'applyId' in handle ? handle : asApplyHandle(handle)
    if (!normalized.applyId || normalized.timeoutSec <= 0) return
    clearTimer()
    const current = ++generation
    ++operation
    pending.value = normalized
    remaining.value = normalized.timeoutSec
    requesting.value = false
    rollbackRequested = false
    lastFailure = ''
    // 首秒拉一次状态，之后等待确认阶段降频；倒计时始终本地逐秒递减
    ticksSincePoll = pollIntervalTicks()
    timer = window.setInterval(() => {
      if (current !== generation || requesting.value) return
      const revision = operation
      remaining.value = Math.max(0, remaining.value - 1)
      ticksSincePoll += 1
      if (ticksSincePoll < pollIntervalTicks()) return
      void pollStatus(current, revision, normalized.applyId)
    }, TICK_MS)
  }
  async function confirm(): Promise<ConfigTaskStatus['state'] | null> {
    if (!pending.value || !canConfirm.value) return null
    const current = generation, id = pending.value.applyId
    ++operation
    requesting.value = true
    try {
      const status = unwrap(await getRouterApi().confirmConfigTask(id))
      if (current !== generation) return null
      consume(status)
      if (status.state === 'pending')
        toast.warning(status.message || t('apply.inProgressDesc'))
      return status.state
    } catch (e) {
      if (current === generation) toast.error(formatApiError(e, t))
      return null
    }
    finally { if (current === generation) requesting.value = false }
  }
  async function cancel() {
    if (!pending.value || requesting.value || pending.value.phase === 'rolling_back') return
    const current = generation, id = pending.value.applyId
    ++operation
    requesting.value = true
    try {
      const api = getRouterApi()
      if (!api.cancelConfigTask) throw new Error('当前接口不支持撤销配置')
      const status = unwrap(await api.cancelConfigTask(id))
      if (current !== generation) return
      rollbackRequested = true
      consume(status)
    } catch (e) { if (current === generation) toast.error(formatApiError(e, t)) }
    finally { if (current === generation) requesting.value = false }
  }
  function notifySaved(result: ConfigApplyResult, legacyKey: string) {
    if (result.phase === 'prepared' || result.phase === 'applying') toast.info(t('apply.savedApplying'))
    else if (result.phase === 'applied' && result.rollbackSec > 0) toast.info(t('apply.savedAwaitingConfirm'))
    else if (result.phase === 'rolling_back') toast.warning(t('apply.rollingBackDesc'))
    else if (result.phase === 'failed') toast.error(t('apply.failedDesc'))
    else toast.success(t(legacyKey))
  }
  onUnmounted(() => { ++generation; ++operation; clearTimer() })
  return { pending, remaining, applying, canConfirm, begin, confirm, cancel, notifySaved }
}
