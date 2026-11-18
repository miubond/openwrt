import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TimePage from './TimePage.vue'
import ScheRebootPage from './ScheRebootPage.vue'

const api = vi.hoisted(() => ({
  getSystemTime: vi.fn(), updateSystemTime: vi.fn(), useBrowserTime: vi.fn(),
  getScheReboot: vi.fn(), updateScheReboot: vi.fn(),
  getConfigTaskStatus: vi.fn(), confirmConfigTask: vi.fn(), cancelConfigTask: vi.fn(),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/api', () => ({
  getRouterApi: () => api,
  unwrap: (r: { ok: boolean; data: unknown; message?: string }) => { if (!r.ok) throw new Error(r.message); return r.data },
  asApplyHandle: (r: { taskId: string; rollbackSec: number }) => ({ applyId: r.taskId, timeoutSec: r.rollbackSec }),
  formatApiError: (e: Error) => e.message,
}))
const initialTime = { timezone: 'CST-8', ntpEnabled: true, ntpServers: ['one.example.org', '', 'three.example.org'], localTime: '2026-11-18 20:00:00' }
const initialSchedule = { mode: 2, remainHour: 0, remainMinute: 30, hour: 3, minute: 15, weeks: 8, timeDay: 1795003200, remainingSec: 0, timezone: 'CST-8', localTime: '2026-11-18 20:00:00' }
let wrapper: ReturnType<typeof mount>
const ok = (data: unknown) => ({ ok: true, data })
const task = () => ok({ accepted: true, taskId: 'system-test', rollbackSec: 90 })
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  api.getSystemTime.mockResolvedValue(ok(structuredClone(initialTime)))
  api.getScheReboot.mockResolvedValue(ok(structuredClone(initialSchedule)))
  api.updateSystemTime.mockResolvedValue(task())
  api.updateScheReboot.mockResolvedValue(task())
  api.getConfigTaskStatus.mockResolvedValue(ok({ taskId: 'system-test', state: 'pending', remainingSec: 89 }))
  api.confirmConfigTask.mockResolvedValue(ok({ taskId: 'system-test', state: 'confirmed', remainingSec: 0 }))
  api.cancelConfigTask.mockResolvedValue(ok({ taskId: 'system-test', state: 'rolled_back', remainingSec: 0 }))
})
afterEach(() => { wrapper?.unmount(); vi.clearAllTimers(); vi.useRealTimers() })
async function open(page: typeof TimePage | typeof ScheRebootPage) {
  wrapper = mount(page, { global: { plugins: [createPinia()] } })
  await flushPromises()
}
function button(label: string) { return wrapper.findAll('button').find(b => b.text() === label)! }
function servers() { return wrapper.findAll('input').filter(i => !i.element.readOnly && i.attributes('type') !== 'checkbox') }

describe('native NTP page', () => {
  it('saves three server slots including the empty slot and confirms the native task', async () => {
    await open(TimePage)
    await servers()[2]!.setValue('changed.example.org')
    await button('common.apply').trigger('click'); await flushPromises()
    expect(api.updateSystemTime).toHaveBeenCalledWith(expect.objectContaining({ ntpServers: ['one.example.org', '', 'changed.example.org'], timezone: 'CST-8' }))
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await button('apply.keep').trigger('click'); await flushPromises()
    expect(api.confirmConfigTask).toHaveBeenCalledWith('system-test')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('reverts edited server values from the device after native rollback', async () => {
    await open(TimePage)
    await servers()[0]!.setValue('temporary.example.org')
    await button('common.apply').trigger('click'); await flushPromises()
    await button('apply.rollback').trigger('click'); await flushPromises()
    expect(api.cancelConfigTask).toHaveBeenCalledWith('system-test')
    expect(servers().map(i => i.element.value)).toEqual(initialTime.ntpServers)
  })
  it('keeps the device local clock string and ticks it without converting to another timezone', async () => {
    await open(TimePage)
    expect(wrapper.get<HTMLInputElement>('input[readonly]').element.value).toBe('2026-11-18 20:00:00')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get<HTMLInputElement>('input[readonly]').element.value).toBe('2026-11-18 20:00:01')
  })
  it('does not show an apply confirmation when saving was rejected by the device', async () => {
    api.updateSystemTime.mockResolvedValue({ ok: false, code: 'VALIDATION', message: 'NTP server invalid' })
    await open(TimePage)
    await button('common.apply').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(api.confirmConfigTask).not.toHaveBeenCalled()
  })
})
describe('native scheduled reboot page', () => {
  it('saves a weekly setting and reloads the original hours after rollback', async () => {
    await open(ScheRebootPage)
    await wrapper.findAll<HTMLInputElement>('input[type="number"]')[0]!.setValue(4)
    await button('common.apply').trigger('click'); await flushPromises()
    expect(api.updateScheReboot).toHaveBeenCalledWith(expect.objectContaining({ mode: 2, hour: 4, minute: 15, weeks: 8 }))
    await button('apply.rollback').trigger('click'); await flushPromises()
    expect(api.cancelConfigTask).toHaveBeenCalledWith('system-test')
    expect(wrapper.findAll<HTMLInputElement>('input[type="number"]')[0]!.element.value).toBe('3')
  })
  it('rejects a countdown below ten minutes before sending a request', async () => {
    api.getScheReboot.mockResolvedValue(ok({ ...initialSchedule, mode: 1, remainMinute: 30, remainingSec: 1800 }))
    await open(ScheRebootPage)
    await wrapper.findAll<HTMLInputElement>('input[type="number"]')[1]!.setValue(9)
    await button('common.apply').trigger('click'); await flushPromises()
    expect(api.updateScheReboot).not.toHaveBeenCalled()
  })
  it('confirms the backend task without sending a reboot command', async () => {
    await open(ScheRebootPage)
    await button('common.apply').trigger('click'); await flushPromises()
    await button('apply.keep').trigger('click'); await flushPromises()
    expect(api.confirmConfigTask).toHaveBeenCalledWith('system-test')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
  it('shows the device local clock even when its epoch would format differently on the computer', async () => {
    api.getScheReboot.mockResolvedValue(ok({ ...initialSchedule, timeDay: 1 }))
    await open(ScheRebootPage)
    expect(wrapper.get<HTMLInputElement>('input[readonly]').element.value).toBe('2026-11-18 20:00:00')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.get<HTMLInputElement>('input[readonly]').element.value).toBe('2026-11-18 20:00:01')
  })
})
