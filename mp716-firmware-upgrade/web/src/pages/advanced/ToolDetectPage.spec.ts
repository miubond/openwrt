import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import ToolDetectPage from './ToolDetectPage.vue'

const api = vi.hoisted(() => ({ startDiagnostic: vi.fn(), stopDiagnostic: vi.fn(), pollDiagnostic: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => ({ meta: { tool: 'ping' } }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message }))
let wrapper: ReturnType<typeof mount>
beforeEach(() => {
  vi.stubEnv('VITE_ROUTER_ADAPTER', 'device')
  vi.useFakeTimers()
  api.startDiagnostic.mockResolvedValue({ ok: true, data: null })
  api.stopDiagnostic.mockResolvedValue({ ok: true, data: null })
  api.pollDiagnostic.mockResolvedValue({ ok: true, data: { flag: 0, running: false, output: '', servers: [] } })
})
afterEach(() => { wrapper?.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetAllMocks() })
async function open() { wrapper = mount(ToolDetectPage, { global: { plugins: [createPinia()] } }); await flushPromises() }
function button(label: string) { return wrapper.findAll('button').find(b => b.text() === label)! }
async function fill(host: string, source: string) {
  const inputs = wrapper.findAll('input')
  await inputs[0]!.setValue(host); await inputs[1]!.setValue(source); await inputs[2]!.setValue('1')
}
it('starts and stops native ping with automatic source selection', async () => {
  await open(); await fill('127.0.0.1', '')
  await button('common.startDetect').trigger('click'); await flushPromises()
  expect(api.startDiagnostic).toHaveBeenCalledWith({ type: 'ping', target: '127.0.0.1', source: '', count: 1 })
  await button('common.stopDetect').trigger('click'); await flushPromises()
  expect(api.stopDiagnostic).toHaveBeenCalledWith('ping')
})
it('rejects URLs in native target fields before making an API call', async () => {
  await open(); await fill('example.org:443', '')
  await button('common.startDetect').trigger('click'); await flushPromises()
  expect(api.startDiagnostic).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('validation.detect.nativeHostFormat')
})
it('keeps the original firmware source-address requirement', async () => {
  vi.stubEnv('VITE_ROUTER_ADAPTER', 'factory')
  await open(); await fill('example.org', '')
  await button('common.startDetect').trigger('click'); await flushPromises()
  expect(api.startDiagnostic).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('validation.detect.sourceRequired')
})
