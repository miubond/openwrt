import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PptpClientPage from './PptpClientPage.vue'
import L2tpClientPage from './L2tpClientPage.vue'

const api = vi.hoisted(() => ({ getPptpClient: vi.fn(), getL2tpClient: vi.fn(), getConfigTaskStatus: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message, asApplyHandle: () => ({}) }))
const config = { enabled: false, status: 2, address: '', server: 'vpn.example.org', username: 'fixture', password: '********', mppe: 0, routeType: 0, routes: [], ipsecKey: '', serverEnabled: false }
let wrapper: ReturnType<typeof mount>
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_ROUTER_ADAPTER', 'device') })
afterEach(() => { wrapper?.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllEnvs() })
describe.each([
  ['PPTP', PptpClientPage, 'getPptpClient', 'vpn.connSuccess', 'vpn.connFailed'],
  ['L2TP', L2tpClientPage, 'getL2tpClient', 'common.connected', 'common.disconnected'],
] as const)('%s native connection state', (_, page, method, connected, disconnected) => {
  async function open(value: typeof config) {
    api[method].mockResolvedValue({ ok: true, data: value })
    wrapper = mount(page, { global: { plugins: [createPinia()] } }); await flushPromises()
  }
  function values() { return wrapper.findAll('.value').map(e => e.text()) }
  it('does not claim a connection when an initially disabled client is toggled on before saving', async () => {
    await open({ ...config }); await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(values()).toContain(disconnected); expect(values()).not.toContain(connected)
  })
  it('only considers native state 1 connected', async () => {
    await open({ ...config, enabled: true, status: 2 })
    expect(values()).toContain(disconnected); expect(values()).not.toContain(connected)
  })
  it('shows a real enabled native connection with state 1', async () => {
    await open({ ...config, enabled: true, status: 1, address: '10.71.60.10' })
    expect(values()).toContain(connected); expect(values()).toContain('10.71.60.10')
  })
  it('preserves the original factory nonzero status convention', async () => {
    vi.stubEnv('VITE_ROUTER_ADAPTER', 'factory')
    await open({ ...config, enabled: true, status: 2 })
    expect(values()).toContain(connected)
  })
})
