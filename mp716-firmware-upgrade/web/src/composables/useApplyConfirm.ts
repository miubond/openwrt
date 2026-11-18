import { onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { ApplyHandle, ConfigApplyResult } from '@/api'
import { useToastStore } from '@/stores/toast'

/** 高风险配置：应用后等待确认；对接 main config-task */
export function useApplyConfirm(onRollback?: () => void) {
  const pending = ref<ApplyHandle | null>(null)
  const remaining = ref(0)
  const applying = ref(false)
  let timer: number | undefined
  const { t } = useI18n()

  function clearTimer() {
    if (timer) window.clearInterval(timer)
    timer = undefined
  }

  async function begin(handle: ApplyHandle | ConfigApplyResult) {
    const toast = useToastStore()
    const normalized = 'applyId' in handle ? handle : asApplyHandle(handle)
    pending.value = normalized
    remaining.value = normalized.timeoutSec
    clearTimer()
    timer = window.setInterval(() => {
      remaining.value = Math.max(0, remaining.value - 1)
      if (pending.value?.applyId) {
        void getRouterApi()
          .getConfigTaskStatus(pending.value.applyId)
          .then((res) => {
            if (res.ok) {
              remaining.value = res.data.remainingSec
              if (res.data.state !== 'pending') {
                clearTimer()
                pending.value = null
                if (res.data.state === 'rolled_back') {
                  toast.warning(t('apply.timeoutRollback'))
                  onRollback?.()
                }
              }
            }
          })
      }
    }, 1000)
  }

  async function confirm() {
    if (!pending.value) return
    applying.value = true
    const toast = useToastStore()
    try {
      const status = unwrap(await getRouterApi().confirmConfigTask(pending.value.applyId))
      if (status.state !== 'confirmed') throw new Error(status.message || '配置未能确认')
      toast.success(t('apply.confirmed'))
      pending.value = null
      clearTimer()
    } catch (e) {
      toast.error(formatApiError(e, t))
      throw e
    } finally {
      applying.value = false
    }
  }

  async function cancel() {
    if (!pending.value) return
    applying.value = true
    const toast = useToastStore()
    try {
      const api = getRouterApi()
      if (!api.cancelConfigTask) throw new Error('当前接口不支持撤销配置')
      const status = unwrap(await api.cancelConfigTask(pending.value.applyId))
      if (status.state !== 'rolled_back') throw new Error(status.message || '配置未能恢复')
      pending.value = null
      clearTimer()
      toast.info(t('apply.cancelled'))
      onRollback?.()
    } catch (e) {
      toast.error(formatApiError(e, t))
    } finally {
      applying.value = false
    }
  }

  onUnmounted(clearTimer)
  return { pending, remaining, applying, begin, confirm, cancel }
}
