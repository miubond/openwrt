import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import DashboardPage from './DashboardPage.vue'
const api = vi.hoisted(() => ({ getSystemInfo: vi.fn(), getWanStatus: vi.fn(), getWifiStatus: vi.fn(), getPhysicalPorts: vi.fn(), getConnectedDevices: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useRoute: () => ({ fullPath: '/' }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message, isUnauthorizedError: () => false, setRouterApiTokenGetter: vi.fn() }))
let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks() })
async function open(mappingVerified?: boolean) {
  api.getSystemInfo.mockResolvedValue({ data: { model: 'MP716', hostname: 'fixture', firmware: '1.0.4', kernel: '6.12', uptimeSec: 60, localTime: '2026-11-18 21:00:00', cpuLoad: [], memTotalKb: 64000, memFreeKb: 12000, flashTotalKb: 8192, flashFreeKb: 1000 } })
  api.getWanStatus.mockResolvedValue({ data: { connected: true, proto: 'dhcp', rxBytes: 0, txBytes: 0, dns: [] } })
  api.getWifiStatus.mockResolvedValue({ data: { enabled: true, ssid: 'fixture', band: '2.4GHz', channel: 6, clients: 0, security: 'wpa2-psk' } })
  api.getPhysicalPorts.mockResolvedValue({ data: [{ id: 'port4', label: mappingVerified === false ? 'P4' : 'WAN', role: 'wan', linkUp: false, speedMbps: 0, mappingVerified }] })
  api.getConnectedDevices.mockResolvedValue({ data: [] })
  wrapper = mount(DashboardPage, { global: { plugins: [createPinia()] } }); await flushPromises()
}
it('labels unverified switch indices and avoids a guessed physical WAN mismatch', async () => {
  await open(false)
  expect(wrapper.text()).toContain('P4'); expect(wrapper.text()).toContain('dashboard.physicalMappingUnverified')
  expect(wrapper.find('.ports-warn').exists()).toBe(false)
  expect(wrapper.get('.port').classes()).toContain('unknown')
})
it('retains factory physical WAN mismatch reporting when mapping flag is absent', async () => {
  await open(); expect(wrapper.find('.ports-warn').text()).toBe('dashboard.wanStateMismatch')
})
