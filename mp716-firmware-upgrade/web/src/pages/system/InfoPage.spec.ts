import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { version } from '../../../package.json'
import InfoPage from './InfoPage.vue'
const api = vi.hoisted(() => ({ getDeviceInfo: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message }))
let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks(); vi.unstubAllEnvs() })
async function open(mode: string) {
  vi.stubEnv('VITE_ROUTER_ADAPTER', mode)
  api.getDeviceInfo.mockResolvedValue({ ok: true, data: { productName: 'MP716', productModel: 'MP716', softwareVersion: '1.0.3', webuiVersion: 'factory-web-build', lanMac: '02:00:00:00:00:01', wanIp: '10.0.0.2' } })
  wrapper = mount(InfoPage, { global: { plugins: [createPinia()] } }); await flushPromises()
}
it('shows the native bundled Web version independently from the installed firmware version', async () => {
  await open('device'); const values = wrapper.findAll('.tile-value').map(e => e.text())
  expect(values).toContain('1.0.3'); expect(values).toContain(version); expect(values).not.toContain('factory-web-build')
})
it('keeps the factory-reported Web version in factory mode', async () => {
  await open('factory'); expect(wrapper.findAll('.tile-value').map(e => e.text())).toContain('factory-web-build')
})
