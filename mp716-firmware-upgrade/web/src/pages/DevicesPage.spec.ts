import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DevicesPage from './DevicesPage.vue'

const api = vi.hoisted(() => ({
  getConnectedDevices: vi.fn(),
  getDeviceAclList: vi.fn(),
  addDeviceAcl: vi.fn(),
  removeDeviceAcl: vi.fn(),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/api', () => ({
  getRouterApi: () => api,
  unwrap: (r: { data: unknown }) => r.data,
  formatApiError: (e: Error) => e.message,
}))
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  api.getConnectedDevices.mockResolvedValue({
    data: [
      {
        id: 'wired',
        hostname: 'Desktop',
        mac: '00:11:22:33:44:55',
        ipv4: '192.168.199.107',
        wired: true,
        online: true,
        interface: 'br-lan',
      },
      {
        id: 'wifi',
        hostname: 'Phone',
        mac: '00:11:22:33:44:66',
        ipv4: '192.168.199.108',
        wired: false,
        online: false,
      },
    ],
  })
  api.getDeviceAclList.mockResolvedValue({ data: [] })
  api.addDeviceAcl.mockResolvedValue({ data: {} })
  api.removeDeviceAcl.mockResolvedValue({ data: {} })
})
afterEach(() => {
  wrapper?.unmount()
  vi.resetAllMocks()
})
async function open() {
  wrapper = mount(DevicesPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
}
it('renders feature/lp online list columns without filter chrome', async () => {
  await open()
  expect(wrapper.find('input[type="search"]').exists()).toBe(false)
  expect(wrapper.find('.device-summary').exists()).toBe(false)
  expect(wrapper.get('thead').text()).toContain('common.ip')
  expect(wrapper.get('thead').text()).toContain('common.mac')
  expect(wrapper.get('thead').text()).toContain('common.hostname')
  expect(wrapper.get('thead').text()).toContain('common.action')
  expect(wrapper.get('thead').text()).not.toContain('devices.linkLabel')
  expect(wrapper.findAll('tbody tr')).toHaveLength(2)
})
it('keeps ACL block and unblock on the feature/lp table actions', async () => {
  await open()
  api.getDeviceAclList.mockResolvedValue({ data: [{ mac: '00:11:22:33:44:55' }] })
  await wrapper.get('.icon-action').trigger('click')
  await flushPromises()
  expect(api.addDeviceAcl).toHaveBeenCalledExactlyOnceWith('00:11:22:33:44:55')
  await wrapper.findAll('.factory-tab')[1]!.trigger('click')
  api.getDeviceAclList.mockResolvedValue({ data: [] })
  await wrapper.get('.unlock').trigger('click')
  await flushPromises()
  expect(api.removeDeviceAcl).toHaveBeenCalledExactlyOnceWith('00:11:22:33:44:55')
})
