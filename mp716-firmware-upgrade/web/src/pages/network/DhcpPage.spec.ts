import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DhcpPage from './DhcpPage.vue'

const api = vi.hoisted(() => ({
  getDhcpConfig: vi.fn(), updateDhcpConfig: vi.fn(),
  confirmConfigTask: vi.fn(), cancelConfigTask: vi.fn(), getConfigTaskStatus: vi.fn(),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/api', () => ({
  getRouterApi: () => api,
  unwrap: (result: { data: unknown }) => result.data,
  asApplyHandle: (result: { taskId: string; rollbackSec: number }) =>
    ({ applyId: result.taskId, timeoutSec: result.rollbackSec }),
  formatApiError: (error: Error) => error.message,
}))

const config = { enabled: true, startIp: '192.168.199.2', endIp: '192.168.199.254',
  leasetime: '7200', staticBindings: [] }
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  vi.useFakeTimers()
  api.getDhcpConfig.mockResolvedValue({ ok: true, data: config })
  api.updateDhcpConfig.mockResolvedValue({ ok: true, data: { accepted: true, taskId: 'dhcp-test', rollbackSec: 90 } })
  api.confirmConfigTask.mockResolvedValue({ ok: true, data: { state: 'confirmed' } })
  api.cancelConfigTask.mockResolvedValue({ ok: true, data: { state: 'rolled_back' } })
})
afterEach(() => { wrapper?.unmount(); vi.clearAllMocks(); vi.clearAllTimers(); vi.useRealTimers() })
async function open() {
  wrapper = mount(DhcpPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
}
function button(label: string) { return wrapper.findAll('button').find(b => b.text() === label)! }

it('saves an edited numeric input as a string and lets the user confirm it', async () => {
  await open()
  await wrapper.get('input[type="number"]').setValue(7260)
  await button('common.apply').trigger('click')
  await flushPromises()
  expect(api.updateDhcpConfig).toHaveBeenCalledWith(expect.objectContaining({ leasetime: '7260' }))
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  await button('apply.keep').trigger('click'); await flushPromises()
  expect(api.confirmConfigTask).toHaveBeenCalledWith('dhcp-test')
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})

it('keeps the loaded string lease valid when another field is edited, and supports rollback', async () => {
  await open()
  await wrapper.findAll('input').find(i => i.element.value === config.startIp)!.setValue('192.168.199.3')
  await button('common.apply').trigger('click'); await flushPromises()
  expect(api.updateDhcpConfig).toHaveBeenCalledWith(expect.objectContaining({ leasetime: '7200', start: 3 }))
  await button('apply.rollback').trigger('click'); await flushPromises()
  expect(api.cancelConfigTask).toHaveBeenCalledWith('dhcp-test')
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})
