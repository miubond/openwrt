import { useApplyConfirm } from '@/composables/useApplyConfirm'

/** 布局级单例：切换页面后仍能轮询/确认未完成的 config-task */
let rootApply: ReturnType<typeof useApplyConfirm> | null = null

export function useRootApplyConfirm() {
  if (!rootApply) rootApply = useApplyConfirm()
  return rootApply
}