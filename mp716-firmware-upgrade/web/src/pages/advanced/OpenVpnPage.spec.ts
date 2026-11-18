import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import OpenVpnPage from './OpenVpnPage.vue'

const api = vi.hoisted(() => ({ getOpenVpn: vi.fn(), uploadOpenVpn: vi.fn(), updateOpenVpn: vi.fn(), getConfigTaskStatus: vi.fn(), confirmConfigTask: vi.fn(), cancelConfigTask: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, asApplyHandle: (r: { taskId: string; rollbackSec: number }) => ({ applyId: r.taskId, timeoutSec: r.rollbackSec }), formatApiError: (e: Error) => e.message }))
let wrapper: ReturnType<typeof mount>
const original = { enabled: true, status: 0, mode: 1, host: '', username: '', password: '', port: 1194, configUploaded: false }
beforeEach(() => {
  vi.useFakeTimers()
  api.getOpenVpn.mockResolvedValue({ ok: true, data: original })
  api.uploadOpenVpn.mockResolvedValue({ ok: true, data: { accepted: true, taskId: 'upload', rollbackSec: 90 } })
  api.updateOpenVpn.mockResolvedValue({ ok: true, data: { accepted: true, taskId: 'settings', rollbackSec: 90 } })
  api.confirmConfigTask.mockResolvedValue({ ok: true, data: { state: 'confirmed' } })
  api.cancelConfigTask.mockResolvedValue({ ok: true, data: { state: 'rolled_back' } })
})
afterEach(() => { wrapper?.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks() })
async function open() { wrapper = mount(OpenVpnPage, { global: { plugins: [createPinia()] } }); await flushPromises() }
function button(label: string) { return wrapper.findAll('button').find(b => b.text() === label)! }
async function choose(kind: 'config' | 'cert') {
  const index = kind === 'config' ? 0 : 1
  const file = new File([kind === 'config' ? 'client\nremote vpn.example.org\n' : 'fixture certificate'], kind === 'config' ? 'client.ovpn' : 'ca.crt')
  const input = wrapper.findAll('input[type="file"]')[index]!
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await wrapper.findAll('button').filter(b => b.text() === 'vpn.upload')[index]!.trigger('click'); await flushPromises()
  return file
}
it('uploads the selected actual file and confirms its pending device task', async () => {
  await open(); const file = await choose('config')
  expect(api.uploadOpenVpn).toHaveBeenCalledWith(file, 'config')
  expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  expect(wrapper.find('p.ok').exists()).toBe(true)
  await button('apply.keep').trigger('click'); await flushPromises()
  expect(api.confirmConfigTask).toHaveBeenCalledWith('upload')
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})
it('cancels an uploaded config and reloads the restored file state', async () => {
  await open(); await choose('config')
  await button('apply.rollback').trigger('click'); await flushPromises()
  expect(api.cancelConfigTask).toHaveBeenCalledWith('upload')
  expect(api.getOpenVpn).toHaveBeenCalledTimes(2)
  expect(wrapper.find('p.ok').exists()).toBe(false)
})
it('sends a certificate as a certificate and supports cancellation', async () => {
  await open(); const file = await choose('cert')
  expect(api.uploadOpenVpn).toHaveBeenCalledWith(file, 'cert')
  await button('apply.rollback').trigger('click'); await flushPromises()
  expect(api.cancelConfigTask).toHaveBeenCalledWith('upload')
})
it('reloads the original enable state after settings rollback', async () => {
  await open(); await wrapper.get('input[type="checkbox"]').setValue(false)
  await button('common.apply').trigger('click'); await flushPromises()
  expect(api.updateOpenVpn).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  await button('apply.rollback').trigger('click'); await flushPromises()
  expect(api.cancelConfigTask).toHaveBeenCalledWith('settings')
  expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
})
