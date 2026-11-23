import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useApplyConfirm } from './useApplyConfirm'
import { useToastStore } from '@/stores/toast'
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({ getRouterApi: () => ({}), unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message, asApplyHandle: () => ({}) }))
let control: ReturnType<typeof useApplyConfirm>, wrapper: ReturnType<typeof mount>
beforeEach(() => {
  vi.useFakeTimers()
  wrapper = mount(defineComponent({ setup() { control = useApplyConfirm(); return () => null } }), { global: { plugins: [createPinia()] } })
})
afterEach(() => { wrapper.unmount(); vi.clearAllTimers(); vi.useRealTimers() })
it.each(['prepared', 'applying'] as const)('reports saved/applying rather than success while the device is %s', phase => {
  control.notifySaved({ accepted: true, rollbackSec: 90, taskId: 'fixture-task', phase }, 'common.configApplied')
  expect(useToastStore().items).toEqual([expect.objectContaining({ kind: 'info', message: 'apply.savedApplying' })])
})
it('distinguishes completed application awaiting confirmation from final completion', () => {
  control.notifySaved({ accepted: true, rollbackSec: 90, phase: 'applied' }, 'common.configApplied')
  expect(useToastStore().items).toEqual([expect.objectContaining({ kind: 'info', message: 'apply.savedAwaitingConfirm' })])
})
it('does not report success for a returned failed operation', () => {
  control.notifySaved({ accepted: false, rollbackSec: 0, phase: 'failed' }, 'common.configApplied')
  expect(useToastStore().items).toEqual([expect.objectContaining({ kind: 'error', message: 'apply.failedDesc' })])
})
it('preserves factory and older API messages without async phases', () => {
  control.notifySaved({ accepted: true, rollbackSec: 0 }, 'wifiBasic.saved')
  expect(useToastStore().items).toEqual([expect.objectContaining({ kind: 'success', message: 'wifiBasic.saved' })])
})
