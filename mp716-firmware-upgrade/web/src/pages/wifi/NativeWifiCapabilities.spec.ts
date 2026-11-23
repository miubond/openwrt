import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import WifiBasicPage from './WifiBasicPage.vue'
import UiSelect from '@/components/UiSelect.vue'
import FormActions from '@/components/FormActions.vue'
const api = vi.hoisted(() => ({ getWifiConfig: vi.fn(), updateWifiConfig: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, formatApiError: (e: Error) => e.message, asApplyHandle: () => ({}) }))
const cfg = { enabled: true, ssid: 'fixture', hidden: false, channel: 6, txPower: 100, password: '********', security: 'unsupported', rawEncryption: 'wep+mixed', cipher: 'aes', mode: '11gn', htmode: 'HT20', maxClients: 32, supportedModes: ['11g', '11n', '11bg', '11bgn'] }
let wrapper: ReturnType<typeof mount>
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks(); vi.unstubAllEnvs() })
async function open(mode = 'device') {
  vi.stubEnv('VITE_ROUTER_ADAPTER', mode); api.getWifiConfig.mockResolvedValue({ data: cfg }); api.updateWifiConfig.mockResolvedValue({ data: { accepted: true, rollbackSec: 0 } })
  wrapper = mount(WifiBasicPage, { global: { plugins: [createPinia()] } }); await flushPromises()
}
it('shows only advertised native PHY modes plus the current preserved GN mode', async () => {
  await open(); const selector = wrapper.findAllComponents(UiSelect).find(s => s.props('modelValue') === '11gn')!
  expect(selector.props('options').map(o => o.value)).toEqual(['11g', '11n', '11bg', '11bgn', '11gn'])
  expect(wrapper.text()).toContain('wifiBasic.preserveEncryptionHint')
})
it('submits unknown encryption and existing GN unchanged when only SSID is edited', async () => {
  await open(); await wrapper.get('input[maxlength="32"]').setValue('renamed')
  wrapper.getComponent(FormActions).vm.$emit('apply'); await flushPromises()
  expect(api.updateWifiConfig).toHaveBeenCalledWith(expect.objectContaining({ ssid: 'renamed', security: 'unsupported', mode: '11gn', password: '********' }))
})
it('keeps loaded PHY and encryption choices available when reverting unsaved selections', async () => {
  await open()
  const selects = wrapper.findAllComponents(UiSelect)
  const mode = selects.find(s => s.props('modelValue') === '11gn')!
  const encryption = selects.find(s => s.props('modelValue') === 'unsupported')!
  mode.vm.$emit('update:modelValue', '11g'); encryption.vm.$emit('update:modelValue', 'wpa2psk'); await flushPromises()
  expect(mode.props('options').map(o => o.value)).toContain('11gn')
  expect(encryption.props('options').map(o => o.value)).toContain('unsupported')
  mode.vm.$emit('update:modelValue', '11gn'); encryption.vm.$emit('update:modelValue', 'unsupported'); await flushPromises()
  wrapper.getComponent(FormActions).vm.$emit('apply'); await flushPromises()
  expect(api.updateWifiConfig).toHaveBeenCalledWith(expect.objectContaining({ mode: '11gn', security: 'unsupported' }))
})
it('keeps all original factory mode choices available', async () => {
  await open('factory'); const selector = wrapper.findAllComponents(UiSelect).find(s => s.props('modelValue') === '11gn')!
  expect(selector.props('options').map(o => o.value)).toEqual(['11b', '11g', '11n', '11bg', '11bgn'])
})
