import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useApplyConfirm } from './useApplyConfirm'

const api = vi.hoisted(() => ({ getConfigTaskStatus: vi.fn(), confirmConfigTask: vi.fn(), cancelConfigTask: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message, asApplyHandle: (r: { taskId: string; rollbackSec: number }) => ({ applyId: r.taskId, timeoutSec: r.rollbackSec }) }))
let control: ReturnType<typeof useApplyConfirm>, wrapper: ReturnType<typeof mount>
const rolledBack = vi.fn()
const confirmed = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  wrapper = mount(defineComponent({ setup() { control = useApplyConfirm(rolledBack, confirmed); return () => null } }), { global: { plugins: [createPinia()] } })
})
afterEach(() => { wrapper.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks() })
it('silently refreshes after the device confirms the task', async () => {
  await control.begin({ applyId: 'task', timeoutSec: 90 })
  api.confirmConfigTask.mockResolvedValue({ ok: true, data: { state: 'confirmed', remainingSec: 0 } })
  await control.confirm()
  expect(control.pending.value).toBeNull()
  expect(confirmed).toHaveBeenCalledTimes(1)
  expect(rolledBack).not.toHaveBeenCalled()
})
it('ignores a response from the previous task after beginning a new task', async () => {
  let resolve!: (v: unknown) => void
  api.getConfigTaskStatus.mockReturnValueOnce(new Promise(r => { resolve = r }))
  await control.begin({ applyId: 'old', timeoutSec: 90 })
  await vi.advanceTimersByTimeAsync(1000)
  await control.begin({ applyId: 'new', timeoutSec: 90 })
  resolve({ ok: true, data: { state: 'rolled_back', remainingSec: 0 } })
  await flushPromises()
  expect(control.pending.value?.applyId).toBe('new')
  expect(rolledBack).not.toHaveBeenCalled()
})
it('does not overlap polling requests and retains a disconnected pending task', async () => {
  let reject!: (reason: Error) => void
  api.getConfigTaskStatus.mockReturnValueOnce(new Promise((_, r) => { reject = r }))
  await control.begin({ applyId: 'pending', timeoutSec: 90 })
  await vi.advanceTimersByTimeAsync(5000)
  expect(api.getConfigTaskStatus).toHaveBeenCalledTimes(1)
  reject(new Error('offline')); await flushPromises()
  expect(control.pending.value?.applyId).toBe('pending')
})
it('counts down locally while waiting and does not poll every second', async () => {
  api.getConfigTaskStatus.mockResolvedValue({
    ok: true,
    data: { taskId: 'task', state: 'pending', phase: 'applied', remainingSec: 90 },
  })
  await control.begin({ applyId: 'task', timeoutSec: 90, phase: 'applied' })
  await vi.advanceTimersByTimeAsync(4000)
  expect(control.remaining.value).toBe(86)
  expect(api.getConfigTaskStatus).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2000)
  expect(control.remaining.value).toBe(84)
  expect(api.getConfigTaskStatus).toHaveBeenCalledTimes(2)
})
it('only reloads the form when device rollback is confirmed', async () => {
  await control.begin({ applyId: 'task', timeoutSec: 90 })
  api.cancelConfigTask.mockResolvedValue({ ok: true, data: { state: 'pending' } })
  await control.cancel()
  expect(rolledBack).not.toHaveBeenCalled()
  expect(control.pending.value).not.toBeNull()
  api.cancelConfigTask.mockResolvedValue({ ok: true, data: { state: 'rolled_back' } })
  await control.cancel()
  expect(control.pending.value).toBeNull()
  expect(rolledBack).toHaveBeenCalledTimes(1)
})
it('ignores an in-flight response after leaving the page', async () => {
  let resolve!: (v: unknown) => void
  api.getConfigTaskStatus.mockReturnValueOnce(new Promise(r => { resolve = r }))
  await control.begin({ applyId: 'task', timeoutSec: 90 })
  await vi.advanceTimersByTimeAsync(1000)
  wrapper.unmount()
  resolve({ ok: true, data: { state: 'rolled_back', remainingSec: 0 } }); await flushPromises()
  expect(rolledBack).not.toHaveBeenCalled()
})
