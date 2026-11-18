import { onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { ApplyHandle, ConfigApplyResult } from '@/api'
import { useToastStore } from '@/stores/toast'

/** The device owns rollback deadlines; a local countdown never confirms a task. */
export function useApplyConfirm(onRollback?: () => void) {
  const pending = ref<ApplyHandle | null>(null)
  const remaining = ref(0)
  const applying = ref(false)
  let timer: number | undefined
  let generation = 0
  let polling = false
  const { t } = useI18n()
  const toast = useToastStore()

  function clearTimer() {
    if (timer !== undefined) window.clearInterval(timer)
    timer = undefined
  }
  function finish() {
    ++generation
    clearTimer()
    pending.value = null
    remaining.value = 0
  }
  async function begin(handle: ApplyHandle | ConfigApplyResult) {
    const normalized = 'applyId' in handle ? handle : asApplyHandle(handle)
    if (!normalized.applyId || normalized.timeoutSec <= 0) return
    clearTimer()
    const current = ++generation
    pending.value = normalized
    remaining.value = normalized.timeoutSec
    timer = window.setInterval(async () => {
      if (current !== generation || polling || applying.value) return
      remaining.value = Math.max(0, remaining.value - 1)
      polling = true
      try {
        const res = await getRouterApi().getConfigTaskStatus(normalized.applyId)
        if (current !== generation || !res.ok) return
        remaining.value = Math.max(0, res.data.remainingSec)
        if (res.data.state === 'confirmed') finish()
        else if (res.data.state === 'rolled_back') {
          finish()
          toast.warning(t('apply.timeoutRollback'))
          onRollback?.()
        } else if (res.data.state === 'failed') {
          // A failed server task does not establish that rollback succeeded.
          clearTimer()
          toast.error(res.data.message || t('errors.internal'))
        }
      } catch {
        // A dropped connection is expected after changing LAN/Wi-Fi settings.
        // Keep the task visible until its actual device state can be read.
      } finally { polling = false }
    }, 1000)
  }
  async function confirm() {
    if (!pending.value || applying.value) return
    const current = generation, id = pending.value.applyId
    applying.value = true
    try {
      const status = unwrap(await getRouterApi().confirmConfigTask(id))
      if (current !== generation) return
      if (status.state !== 'confirmed') throw new Error(status.message || '配置未能确认')
      finish()
      toast.success(t('apply.confirmed'))
    } catch (e) { if (current === generation) toast.error(formatApiError(e, t)) }
    finally { applying.value = false }
  }
  async function cancel() {
    if (!pending.value || applying.value) return
    const current = generation, id = pending.value.applyId
    applying.value = true
    try {
      const api = getRouterApi()
      if (!api.cancelConfigTask) throw new Error('当前接口不支持撤销配置')
      const status = unwrap(await api.cancelConfigTask(id))
      if (current !== generation) return
      if (status.state !== 'rolled_back') throw new Error(status.message || '配置未能恢复')
      finish()
      toast.info(t('apply.cancelled'))
      onRollback?.()
    } catch (e) { if (current === generation) toast.error(formatApiError(e, t)) }
    finally { applying.value = false }
  }
  onUnmounted(() => { ++generation; clearTimer() })
  return { pending, remaining, applying, begin, confirm, cancel }
}
