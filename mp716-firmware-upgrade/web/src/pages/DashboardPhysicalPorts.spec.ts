import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import DashboardPage from './DashboardPage.vue'
import type { PhysicalPortStatus } from '../api/types'
const api = vi.hoisted(() => ({
  getSystemInfo: vi.fn(),
  getWanStatus: vi.fn(),
  getWifiStatus: vi.fn(),
  getPhysicalPorts: vi.fn(),
  getConnectedDevices: vi.fn(),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string, p?: Record<string, string>) => (p?.speed ? `${p.speed}${s}` : s) }) }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ fullPath: '/' }),
}))
vi.mock('@/api', () => ({
  getRouterApi: () => api,
  unwrap: (r: { data: unknown }) => r.data,
  formatApiError: (e: Error) => e.message,
  isUnauthorizedError: () => false,
  setRouterApiTokenGetter: vi.fn(),
}))
let wrapper: ReturnType<typeof mount>
afterEach(() => {
  wrapper?.unmount()
  vi.resetAllMocks()
})
async function open(mappingVerified?: boolean, overrides: Partial<PhysicalPortStatus> = {}) {
  api.getSystemInfo.mockResolvedValue({
    data: {
      model: 'MP716',
      hostname: 'fixture',
      firmware: '1.0.4',
      kernel: '6.12',
      uptimeSec: 60,
      localTime: '2026-11-18 21:00:00',
      cpuLoad: [],
      memTotalKb: 64000,
      memFreeKb: 12000,
      flashTotalKb: 8192,
      flashFreeKb: 1000,
    },
  })
  api.getWanStatus.mockResolvedValue({
    data: {
      connected: true,
      proto: 'dhcp',
      rxBytes: 7340032,
      txBytes: 18874368,
      rxRateBps: 0,
      txRateBps: 0,
      dns: [],
    },
  })
  api.getWifiStatus.mockResolvedValue({
    data: {
      enabled: true,
      ssid: 'fixture',
      band: '2.4GHz',
      channel: 6,
      clients: 0,
      security: 'wpa2-psk',
    },
  })
  api.getPhysicalPorts.mockResolvedValue({
    data: [
      {
        id: 'port4',
        label: mappingVerified === false ? 'P4' : 'WAN',
        role: mappingVerified === false ? 'unknown' : 'wan',
        linkUp: false,
        speedMbps: 0,
        mappingVerified,
        ...overrides,
      },
    ],
  })
  api.getConnectedDevices.mockResolvedValue({ data: [] })
  wrapper = mount(DashboardPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
}
it('keeps unverified switch indices without inventing chassis roles', async () => {
  await open(false)
  expect(wrapper.get('.port strong').text()).toBe('P4')
  expect(wrapper.text()).toContain('dashboard.physicalMappingUnverified')
  expect(wrapper.text()).not.toContain('dashboard.legendWan')
  expect(wrapper.find('.ports-warn').exists()).toBe(false)
  expect(wrapper.get('.port').classes()).toContain('unknown')
})
it('retains the raw labels for a full unverified switch bank', async () => {
  api.getSystemInfo.mockResolvedValue({
    data: {
      model: 'MP716',
      hostname: 'fixture',
      firmware: '1.0.4',
      kernel: '6.12',
      uptimeSec: 60,
      localTime: '2026-11-18 21:00:00',
      cpuLoad: [],
      memTotalKb: 64000,
      memFreeKb: 12000,
      flashTotalKb: 8192,
      flashFreeKb: 1000,
    },
  })
  api.getWanStatus.mockResolvedValue({
    data: { connected: true, proto: 'dhcp', rxBytes: 0, txBytes: 0, rxRateBps: 0, txRateBps: 0, dns: [] },
  })
  api.getWifiStatus.mockResolvedValue({
    data: { enabled: true, ssid: 'fixture', band: '2.4GHz', channel: 6, clients: 0, security: 'wpa2-psk' },
  })
  api.getPhysicalPorts.mockResolvedValue({
    data: Array.from({ length: 5 }, (_, i) => ({
      id: `port${i}`,
      label: `P${i}`,
      role: 'lan' as const,
      mappingVerified: false,
      linkKnown: true,
      linkUp: i >= 3,
      speedMbps: i >= 3 ? 100 : 0,
    })),
  })
  api.getConnectedDevices.mockResolvedValue({ data: [] })
  wrapper = mount(DashboardPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  const labels = wrapper.findAll('.port strong').map((node) => node.text())
  expect(labels).toEqual(['P0', 'P1', 'P2', 'P3', 'P4'])
  expect(wrapper.findAll('.port')[3]!.classes()).toContain('unknown')
  expect(wrapper.findAll('.port')[4]!.classes()).toContain('unknown')
})
it('retains factory physical WAN mismatch reporting when mapping flag is absent', async () => {
  await open()
  expect(wrapper.find('.ports-warn').text()).toBe('dashboard.wanStateMismatch')
})
it('shows an unavailable link query as unknown without a false disconnected state', async () => {
  await open(true, { linkKnown: false, linkUp: null })
  expect(wrapper.get('.port').text()).toContain('dashboard.linkUnknown')
  expect(wrapper.get('.port').text()).not.toContain('dashboard.portDown')
  expect(wrapper.find('.ports-warn').exists()).toBe(false)
})
it('uses a verified chassis label while keeping unavailable speed and link unknown', async () => {
  await open(true, { id: 'port3', label: 'LAN4', role: 'lan', linkKnown: false, linkUp: null })
  expect(wrapper.get('.port').text()).toContain('LAN4')
  expect(wrapper.get('.port').text()).toContain('dashboard.linkUnknown')
  expect(wrapper.get('.port').classes()).toContain('lan')
})
it('keeps idle topology traffic in rate units despite nonzero totals', async () => {
  await open()
  expect(wrapper.get('.rates-traffic').text()).toContain('0bps')
  expect(wrapper.get('.rates-traffic').text()).not.toContain('MB')
})
it('combines port speed into connected status like feature/lp', async () => {
  await open(true, { linkUp: true, speedMbps: 100, label: 'WAN', role: 'wan' })
  expect(wrapper.get('.port').text()).toContain('100M')
  expect(wrapper.get('.port').text()).toContain('dashboard.portConnected')
  expect(wrapper.find('.port-speed').exists()).toBe(false)
})

it('retains verified backend labels even when the switch array is shuffled', async () => {
  await open(true)
  api.getPhysicalPorts.mockResolvedValue({ data: [
    { id: 'port4', label: 'WAN', role: 'wan', mappingVerified: true, linkUp: true, speedMbps: 100 },
    { id: 'port0', label: 'LAN1', role: 'lan', mappingVerified: true, linkUp: false, speedMbps: 0 },
  ] })
  // Reopen the component to use the new backend fixture without relying on polling time.
  wrapper.unmount()
  wrapper = mount(DashboardPage, { global: { plugins: [createPinia()] } })
  await flushPromises()
  expect(wrapper.findAll('.port strong').map(node => node.text())).toEqual(['WAN', 'LAN1'])
  expect(wrapper.find('.ports-warn').exists()).toBe(false)
})
