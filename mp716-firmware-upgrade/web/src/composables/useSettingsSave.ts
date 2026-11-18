import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { asApplyHandle, formatApiError, unwrap } from '@/api'
import type { ApiResponse, ApplyHandle, ConfigApplyResult } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

type SaveResult = ConfigApplyResult | ApplyHandle | void

/**
 * 配置页统一提交：loading、unwrap、可选 Apply 确认条、toast。
 */
export function useSettingsSave() {
  const saving = ref(false)
  const toast = useToastStore()
  const apply = useApplyConfirm()
  const { t } = useI18n()

  async function run(
    apiCall: () => Promise<ApiResponse<SaveResult>>,
    options?: {
      successMessage?: string
      skipApplyBanner?: boolean
    },
  ) {
    saving.value = true
    try {
      const raw = unwrap(await apiCall()) as SaveResult
      const message = options?.successMessage ?? t('common.configApplied')
      toast.success(message)
      if (!options?.skipApplyBanner && raw && typeof raw === 'object' && 'rollbackSec' in raw) {
        const result = raw as ConfigApplyResult
        if (result.rollbackSec > 0) await apply.begin(asApplyHandle(result))
      }
    } catch (e) {
      toast.error(formatApiError(e, t))
      throw e
    } finally {
      saving.value = false
    }
  }

  return { saving, run, ...apply }
}
