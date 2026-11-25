import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useApplyConfirm } from './useApplyConfirm'
import ApplyBanner from '@/components/ApplyBanner.vue'

const api = vi.hoisted(() => ({ getConfigTaskStatus: vi.fn(), confirmConfigTask: vi.fn(), cancelConfigTask: vi.fn() }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (s: string, p?: { n?: number }) => (p?.n != null ? `${s}:${p.n}` : s),
  }),
}))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message, asApplyHandle: (r: { taskId: string; rollbackSec: number; phase?: string }) => ({ applyId: r.taskId, timeoutSec: r.rollbackSec, phase: r.phase }) }))
let control: ReturnType<typeof useApplyConfirm>, wrapper: ReturnType<typeof mount>
const rolledBack = vi.fn()
const ok = (data: unknown) => ({ ok: true, data })
beforeEach(() => {
  vi.useFakeTimers()
  wrapper = mount(defineComponent({ setup() { control = useApplyConfirm(rolledBack); return () => null } }), { global: { plugins: [createPinia()] } })
})
afterEach(() => { wrapper.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks() })
it('waits for actual service application while continuing to poll applying tasks', async () => {
  await control.begin({ applyId: 'task', timeoutSec: 90, phase: 'applying' })
  expect(control.applying.value).toBe(true)
  await control.confirm(); expect(api.confirmConfigTask).not.toHaveBeenCalled()
  api.getConfigTaskStatus.mockResolvedValue(ok({ taskId: 'task', state: 'pending', phase: 'applied', remainingSec: 88 }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(api.getConfigTaskStatus).toHaveBeenCalledWith('task')
  expect(control.applying.value).toBe(false); expect(control.canConfirm.value).toBe(true)
  api.confirmConfigTask.mockResolvedValue(ok({ taskId: 'task', state: 'confirmed', phase: 'applied', remainingSec: 0 }))
  await control.confirm(); expect(api.confirmConfigTask).toHaveBeenCalledWith('task')
  expect(control.pending.value).toBeNull()
})
it('keeps an asynchronous rollback pending until the device reports completed restoration', async () => {
  await control.begin({ applyId: 'task', timeoutSec: 90, phase: 'applied' })
  api.cancelConfigTask.mockResolvedValue(ok({ taskId: 'task', state: 'pending', phase: 'rolling_back', remainingSec: 60 }))
  await control.cancel()
  expect(control.pending.value?.phase).toBe('rolling_back'); expect(control.applying.value).toBe(true)
  expect(rolledBack).not.toHaveBeenCalled()
  await control.cancel(); expect(api.cancelConfigTask).toHaveBeenCalledTimes(1)
  api.getConfigTaskStatus.mockResolvedValue(ok({ taskId: 'task', state: 'rolled_back', phase: 'applied', remainingSec: 0 }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(control.pending.value).toBeNull(); expect(rolledBack).toHaveBeenCalledTimes(1)
})
it('retains failed snapshots and lets the user retry a failed rollback', async () => {
  await control.begin({ applyId: 'task', timeoutSec: 90, phase: 'applying' })
  api.getConfigTaskStatus.mockResolvedValue(ok({ taskId: 'task', state: 'failed', phase: 'failed', rollbackError: 'dnsmasq did not restart', remainingSec: 0 }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(control.pending.value?.message).toBe('dnsmasq did not restart')
  expect(control.canConfirm.value).toBe(false); expect(rolledBack).not.toHaveBeenCalled()
  await control.confirm(); expect(api.confirmConfigTask).not.toHaveBeenCalled()
  api.cancelConfigTask.mockResolvedValue(ok({ taskId: 'task', state: 'pending', phase: 'rolling_back', remainingSec: 0 }))
  await control.cancel()
  api.getConfigTaskStatus.mockResolvedValue(ok({ taskId: 'task', state: 'failed', phase: 'failed', rollbackError: 'still failed', remainingSec: 0 }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(control.pending.value?.message).toBe('still failed')
  await control.cancel(); expect(api.cancelConfigTask).toHaveBeenCalledTimes(2)
  api.getConfigTaskStatus.mockResolvedValue(ok({ taskId: 'task', state: 'rolled_back', remainingSec: 0 }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(rolledBack).toHaveBeenCalledTimes(1)
})
it('ignores a stale applied poll response after rollback was requested', async () => {
  let resolve!: (v: unknown) => void
  api.getConfigTaskStatus.mockReturnValueOnce(new Promise(r => { resolve = r }))
  await control.begin({ applyId: 'task', timeoutSec: 90, phase: 'applied' })
  await vi.advanceTimersByTimeAsync(1000)
  api.cancelConfigTask.mockResolvedValue(ok({ taskId: 'task', state: 'pending', phase: 'rolling_back', remainingSec: 80 }))
  await control.cancel()
  resolve(ok({ taskId: 'task', state: 'pending', phase: 'applied', remainingSec: 85 })); await flushPromises()
  expect(control.pending.value?.phase).toBe('rolling_back'); expect(control.canConfirm.value).toBe(false)
})
it('does not let an old pending request block polling a newer configuration task', async () => {
  api.getConfigTaskStatus.mockReturnValueOnce(new Promise(() => {}))
  await control.begin({ applyId: 'old', timeoutSec: 90 }); await vi.advanceTimersByTimeAsync(1000)
  api.getConfigTaskStatus.mockResolvedValue(ok({ taskId: 'new', state: 'pending', phase: 'applied', remainingSec: 88 }))
  await control.begin({ applyId: 'new', timeoutSec: 90, phase: 'applying' }); await vi.advanceTimersByTimeAsync(1000)
  expect(api.getConfigTaskStatus).toHaveBeenLastCalledWith('new')
  expect(control.canConfirm.value).toBe(true)
})
it('ignores completion for a different task and keeps the current task visible', async () => {
  await control.begin({ applyId: 'task', timeoutSec: 90, phase: 'applying' })
  api.getConfigTaskStatus.mockResolvedValue(ok({ taskId: 'other', state: 'rolled_back', remainingSec: 0 }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(control.pending.value?.applyId).toBe('task'); expect(rolledBack).not.toHaveBeenCalled()
})
it('displays real service failure and disables confirmation while retaining rollback retry', () => {
  const banner = mount(ApplyBanner, { props: { remaining: 0, applying: false, phase: 'failed', message: 'NTP reload failed' } })
  expect(banner.text()).toContain('apply.failedTitle'); expect(banner.text()).toContain('NTP reload failed')
  const buttons = banner.findAll('button')
  expect(buttons[0]!.attributes('disabled')).toBeUndefined()
  expect(buttons[1]!.attributes('disabled')).toBeDefined()
  banner.unmount()
})
it('always shows the remaining countdown while waiting for confirmation', () => {
  const banner = mount(ApplyBanner, {
    props: { remaining: 56, applying: false, phase: 'applied', message: '服务配置已应用，等待确认' },
  })
  expect(banner.text()).toContain('apply.waitingDesc:56')
  expect(banner.text()).not.toContain('服务配置已应用，等待确认')
  banner.unmount()
})
it('disables both controls during the asynchronous device rollback', () => {
  const banner = mount(ApplyBanner, { props: { remaining: 0, applying: true, phase: 'rolling_back' } })
  expect(banner.text()).toContain('apply.rollingBackTitle')
  for (const button of banner.findAll('button')) expect(button.attributes('disabled')).toBeDefined()
  banner.unmount()
})
it('shows loading label on keep while a confirm request is in flight', () => {
  const banner = mount(ApplyBanner, { props: { remaining: 40, applying: true, phase: 'applied' } })
  expect(banner.text()).toContain('common.applying')
  expect(banner.findAll('button')[1]!.attributes('disabled')).toBeDefined()
  banner.unmount()
})
