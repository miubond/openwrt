import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { ApplyHandle, ConfigApplyResult, ConfigTaskStatus } from '@/api'
import { useToastStore } from '@/stores/toast'

/** The device owns both service-application results and rollback deadlines. */
export function useApplyConfirm(onRollback?: () => void) {
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
  function consume(status: ConfigTaskStatus): void {
    if (!pending.value) return
    if (status.taskId && status.taskId !== pending.value.applyId) throw new Error('设备返回了其他配置任务')
    remaining.value = Math.max(0, status.remainingSec || 0)
    pending.value = { ...pending.value, state: status.state, phase: status.phase,
      message: status.rollbackError || status.applyError || status.message }
    if (status.state === 'confirmed') {
      finish()
      toast.success(t('apply.confirmed'))
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
    timer = window.setInterval(async () => {
      if (current !== generation || pollingGeneration === current || requesting.value) return
      const revision = operation
      remaining.value = Math.max(0, remaining.value - 1)
      pollingGeneration = current
      try {
        const res = await getRouterApi().getConfigTaskStatus(normalized.applyId)
        if (current !== generation || revision !== operation || !res.ok) return
        consume(res.data)
      } catch {
        // A dropped connection is expected after changing LAN/Wi-Fi settings.
        // Keep the task until the actual device result becomes available.
      } finally { if (pollingGeneration === current) pollingGeneration = undefined }
    }, 1000)
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
