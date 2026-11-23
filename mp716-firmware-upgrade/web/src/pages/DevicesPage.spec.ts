import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DevicesPage from './DevicesPage.vue'

const api = vi.hoisted(() => ({ getConnectedDevices: vi.fn(), getDeviceAclList: vi.fn(), addDeviceAcl: vi.fn(), removeDeviceAcl: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message }))
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  api.getConnectedDevices.mockResolvedValue({ data: [
    { id: 'wired', hostname: 'Desktop', mac: '00:11:22:33:44:55', ipv4: '192.168.199.107', wired: true, online: true, interface: 'br-lan' },
    { id: 'wifi', hostname: 'Phone', mac: '00:11:22:33:44:66', ipv4: '192.168.199.108', wired: false, online: false },
    { id: 'unknown', hostname: 'Guest', mac: '00:11:22:33:44:77', online: true },
  ] })
  api.getDeviceAclList.mockResolvedValue({ data: [] })
  api.addDeviceAcl.mockResolvedValue({ data: {} })
  api.removeDeviceAcl.mockResolvedValue({ data: {} })
})
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.resetAllMocks() })
async function open() {
  wrapper = mount(DevicesPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
}
it('combines search with link and status filters without writing configuration', async () => {
  await open()
  await wrapper.get('input[type="search"]').setValue('192.168.199.107')
  expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  expect(wrapper.get('tbody').text()).toContain('Desktop')
  await wrapper.get('input[type="search"]').setValue('')
  const selects = wrapper.findAllComponents({ name: 'UiSelect' })
  selects[0]!.vm.$emit('update:modelValue', 'wifi')
  selects[1]!.vm.$emit('update:modelValue', 'offline')
  await flushPromises()
  expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  expect(wrapper.get('tbody').text()).toContain('Phone')
  expect(api.addDeviceAcl).not.toHaveBeenCalled()
  expect(api.removeDeviceAcl).not.toHaveBeenCalled()
})
it('opens LP details with real native fields and closes with Escape', async () => {
  await open()
  await wrapper.findAll('.detail-action')[2]!.trigger('click')
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('Guest')
  expect(dialog.textContent).toContain('devices.link.unknown')
  expect(dialog.textContent).not.toContain('devices.link.ethernet')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('keeps native ACL block and unblock working after using the restored filters', async () => {
  await open()
  await wrapper.get('input[type="search"]').setValue('Desktop')
  api.getDeviceAclList.mockResolvedValue({ data: [{ mac: '00:11:22:33:44:55' }] })
  await wrapper.get('.icon-action').trigger('click'); await flushPromises()
  expect(api.addDeviceAcl).toHaveBeenCalledExactlyOnceWith('00:11:22:33:44:55')
  await wrapper.findAll('.factory-tab')[1]!.trigger('click')
  api.getDeviceAclList.mockResolvedValue({ data: [] })
  await wrapper.get('.unlock').trigger('click'); await flushPromises()
  expect(api.removeDeviceAcl).toHaveBeenCalledExactlyOnceWith('00:11:22:33:44:55')
  expect(wrapper.find('tbody').exists()).toBe(false)
})
