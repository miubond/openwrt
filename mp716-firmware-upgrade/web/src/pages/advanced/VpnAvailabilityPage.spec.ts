import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import PptpClientPage from './PptpClientPage.vue'
import L2tpClientPage from './L2tpClientPage.vue'
import VpnServerPage from './VpnServerPage.vue'
import OpenVpnPage from './OpenVpnPage.vue'

const api = vi.hoisted(() => ({ getPptpClient: vi.fn(), updatePptpClient: vi.fn(), getL2tpClient: vi.fn(), updateL2tpClient: vi.fn(), getPptpServer: vi.fn(), updatePptpServer: vi.fn(), getL2tpServer: vi.fn(), updateL2tpServer: vi.fn(), getOpenVpn: vi.fn(), updateOpenVpn: vi.fn(), getConfigTaskStatus: vi.fn(), confirmConfigTask: vi.fn(), cancelConfigTask: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, asApplyHandle: (r: { taskId: string; rollbackSec: number }) => ({ applyId: r.taskId, timeoutSec: r.rollbackSec }), formatApiError: (e: Error) => e.message }))
let wrapper: ReturnType<typeof mount>
const unavailable = { enabled: false, serviceAvailable: false, serviceMessage: 'Fixture firmware does not include this VPN service' }
const client = { ...unavailable, status: 0, address: '', server: '', username: '', password: '' }
const server = { ...unavailable, startIp: '10.71.60.10', endIp: '10.71.60.100', server: '10.71.60.1', mppe: 0, ipsecEnabled: false, ipsecKey: '', dnsEnabled: false, primaryDns: '', secondaryDns: '', mtu: 1400, mru: 1400 }
const cases: { name: string; component: Component; props?: { kind: 'pptp' | 'l2tp' }; getter: keyof typeof api; setter: keyof typeof api; config: object }[] = [
  { name: 'PPTP client', component: PptpClientPage, getter: 'getPptpClient', setter: 'updatePptpClient', config: { ...client, mppe: 0, routeType: 0, routes: [] } },
  { name: 'L2TP client', component: L2tpClientPage, getter: 'getL2tpClient', setter: 'updateL2tpClient', config: { ...client, ipsecKey: '', serverEnabled: false } },
  { name: 'PPTP server', component: VpnServerPage, props: { kind: 'pptp' }, getter: 'getPptpServer', setter: 'updatePptpServer', config: server },
  { name: 'L2TP server', component: VpnServerPage, props: { kind: 'l2tp' }, getter: 'getL2tpServer', setter: 'updateL2tpServer', config: server },
  { name: 'OpenVPN', component: OpenVpnPage, getter: 'getOpenVpn', setter: 'updateOpenVpn', config: { ...unavailable, status: 0, mode: 0, host: '', username: '', password: '', port: 1194, configUploaded: false } },
]
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv('VITE_ROUTER_ADAPTER', 'device') })
afterEach(() => { wrapper?.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetAllMocks() })
it.each(cases)('$name explains a missing service while allowing disabled configuration to be saved', async entry => {
  api[entry.getter].mockResolvedValue({ ok: true, data: entry.config })
  api[entry.setter].mockResolvedValue({ ok: true, data: { accepted: true, rollbackSec: 0 } })
  wrapper = mount(entry.component, { props: entry.props, global: { plugins: [createPinia()] } })
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toBe(unavailable.serviceMessage)
  const apply = wrapper.findAll('button').find(b => b.text() === 'common.apply')!
  expect(apply.attributes('disabled')).toBeUndefined()
  await apply.trigger('click'); await flushPromises()
  expect(api[entry.setter]).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
  expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
})
