import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WizardPage from './WizardPage.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
const state = vi.hoisted(() => ({ replace: vi.fn(), markWizardComplete: vi.fn() }))
const api = vi.hoisted(() => ({ getQuickSetting: vi.fn(), applyQuickSetting: vi.fn(), completeWizardFirstBoot: vi.fn(), confirmConfigTask: vi.fn(), getConfigTaskStatus: vi.fn(), cancelConfigTask: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: state.replace }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ markWizardComplete: state.markWizardComplete }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { ok: boolean; data: unknown; message?: string }) => { if (!r.ok) throw Error(r.message); return r.data }, formatApiError: (e: Error) => e.message, asApplyHandle: (r: { taskId: string; rollbackSec: number; phase?: string }) => ({ applyId: r.taskId, timeoutSec: r.rollbackSec, phase: r.phase }) }))
let wrapper: ReturnType<typeof mount>
const ok = (data: unknown) => ({ ok: true, data })
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_ROUTER_ADAPTER', 'device') })
afterEach(() => { wrapper?.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetAllMocks() })
async function start() {
  api.getQuickSetting.mockResolvedValue(ok({ firstBoot: 1, wan: { wanType: 'wired', proto: 'dhcp', hostName: '', dns: [] }, wifi: { ssid2g: 'fixture', encry2g: 1, passphrase2g: '********' } }))
  api.applyQuickSetting.mockResolvedValue(ok({ accepted: true, taskId: 'fixture-task', rollbackSec: 90, phase: 'applied', progressSec: 0, reconnect: false }))
  api.completeWizardFirstBoot.mockResolvedValue(ok(null))
  wrapper = mount(WizardPage, { global: { plugins: [createPinia()] } }); await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === 'wizard.next')!.trigger('click')
  await wrapper.get('.wizard-finish').trigger('click'); await flushPromises()
  expect(wrapper.findComponent(ApplyBanner).exists()).toBe(true)
}
async function confirm() { wrapper.getComponent(ApplyBanner).vm.$emit('confirm'); await flushPromises() }
it('does not complete the wizard if a confirmation arriving after its deadline reports rolled_back', async () => {
  await start(); api.confirmConfigTask.mockResolvedValue(ok({ taskId: 'fixture-task', state: 'rolled_back', remainingSec: 0, message: 'deadline elapsed' }))
  await confirm()
  expect(api.getQuickSetting).toHaveBeenCalledTimes(2)
  expect(api.completeWizardFirstBoot).not.toHaveBeenCalled(); expect(state.markWizardComplete).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled()
})
it.each(['failed', 'pending'] as const)('does not complete a %s confirmation result', async status => {
  await start(); api.confirmConfigTask.mockResolvedValue(ok({ taskId: 'fixture-task', state: status, phase: status === 'failed' ? 'failed' : 'applying', remainingSec: 20 }))
  await confirm()
  expect(api.completeWizardFirstBoot).not.toHaveBeenCalled(); expect(state.markWizardComplete).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled()
})
it('completes only after the device explicitly confirms the current task', async () => {
  await start(); api.confirmConfigTask.mockResolvedValue(ok({ taskId: 'fixture-task', state: 'confirmed', remainingSec: 0 }))
  await confirm()
  expect(api.completeWizardFirstBoot).toHaveBeenCalledOnce(); expect(state.markWizardComplete).toHaveBeenCalledOnce(); expect(state.replace).toHaveBeenCalledWith('/')
})
it('does not mark completion when saving the native first-boot flag fails', async () => {
  await start(); api.confirmConfigTask.mockResolvedValue(ok({ taskId: 'fixture-task', state: 'confirmed', remainingSec: 0 }))
  api.completeWizardFirstBoot.mockResolvedValue({ ok: false, message: 'flag could not be committed' })
  await confirm()
  expect(state.markWizardComplete).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled()
})
it('does not complete on a stale confirmation for a different task', async () => {
  await start(); api.confirmConfigTask.mockResolvedValue(ok({ taskId: 'other-task', state: 'confirmed', remainingSec: 0 }))
  await confirm(); expect(api.completeWizardFirstBoot).not.toHaveBeenCalled(); expect(state.markWizardComplete).not.toHaveBeenCalled()
})
