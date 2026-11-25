import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WireGuardClientPage from './WireGuardClientPage.vue'

const MASK = '********'
const SECRET = 'YAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk='
const SERVER_PUB = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg='
const PEER_PUB = 'HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw='

const api = vi.hoisted(() => ({
  getWireGuardClient: vi.fn(),
  updateWireGuardClient: vi.fn(),
  importWireGuardClient: vi.fn(),
  getWireGuardStatus: vi.fn(),
  getConfigTaskStatus: vi.fn(),
  confirmConfigTask: vi.fn(),
  cancelConfigTask: vi.fn(),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({
  WG_SECRET_MASK: '********',
  getRouterApi: () => api,
  unwrap: (r: { ok: boolean; data: unknown; message?: string }) => {
    if (!r.ok) throw new Error(r.message)
    return r.data
  },
  asApplyHandle: (r: { taskId: string; rollbackSec: number }) => ({ applyId: r.taskId, timeoutSec: r.rollbackSec }),
  formatApiError: (e: Error) => e.message,
}))

const client = {
  enabled: true,
  privateKey: MASK,
  hasPrivateKey: true,
  publicKey: SERVER_PUB,
  addresses: ['10.73.0.2/32'],
  dns: [],
  useDns: false,
  mtu: 1420,
  routeMode: 'split',
  allowGlobalRoute: false,
  peer: { publicKey: PEER_PUB, presharedKey: MASK, endpointHost: 'vpn.example.org', endpointPort: 51820, allowedIPs: ['10.73.0.0/24'], keepalive: 25 },
  serviceAvailable: true,
  serviceMessage: '',
}
const status = {
  available: true,
  missing: [],
  client: {
    enabled: true, up: true, error: false, address: '10.73.0.2', endpoint: '203.0.113.5:51820',
    ifaceState: 'up', handshakeState: 'recent', latestHandshake: 1, handshakeAgeSec: 30,
    rxBytes: 2048, txBytes: 1024, errors: [],
    probe: { state: 'ok', target: '10.73.0.1', reason: 'ok', ageSec: 0 },
  },
}
const applied = { ok: true, data: { accepted: true, taskId: 'wg-task', rollbackSec: 90 } }

let wrapper: ReturnType<typeof mount>
let storageWrites: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.useFakeTimers()
  api.getWireGuardClient.mockResolvedValue({ ok: true, data: structuredClone(client) })
  api.getWireGuardStatus.mockResolvedValue({ ok: true, data: structuredClone(status) })
  api.updateWireGuardClient.mockResolvedValue(applied)
  api.importWireGuardClient.mockResolvedValue({ ok: true, data: { ...applied.data, warnings: ['已忽略 IPv6 地址 fd00::2/64'] } })
  api.confirmConfigTask.mockResolvedValue({ ok: true, data: { state: 'confirmed' } })
  api.cancelConfigTask.mockResolvedValue({ ok: true, data: { state: 'rolled_back' } })
  storageWrites = vi.spyOn(Storage.prototype, 'setItem')
})
afterEach(() => {
  wrapper?.unmount()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.resetAllMocks()
  storageWrites.mockRestore()
})

async function open() {
  wrapper = mount(WireGuardClientPage, { global: { plugins: [createPinia()], stubs: { teleport: true } } })
  await flushPromises()
}
function button(label: string) {
  return wrapper.findAll('button').find((b) => b.text() === label)!
}
function secretsNeverPersisted() {
  for (const [, value] of storageWrites.mock.calls) expect(String(value)).not.toContain(SECRET)
}

describe('WireGuard client page', () => {
  it('keeps masked secrets unchanged and shows handshake statistics', async () => {
    await open()
    expect(wrapper.text()).toContain('wg.stateHandshakeRecent')
    const secrets = wrapper.findAll<HTMLInputElement>('input.secret')
    expect(secrets.map((i) => i.element.value)).toEqual(['', ''])
    expect(secrets[0]!.attributes('type')).toBe('password')
    await button('wg.saveConfig').trigger('click')
    await flushPromises()
    expect(api.updateWireGuardClient).toHaveBeenCalledWith(expect.objectContaining({
      privateKey: MASK,
      addresses: ['10.73.0.2/32'],
      peer: expect.objectContaining({ presharedKey: MASK, allowedIPs: ['10.73.0.0/24'] }),
    }))
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('submits a typed private key once and clears the field after saving', async () => {
    await open()
    await wrapper.findAll('input.secret')[0]!.setValue(SECRET)
    await button('wg.saveConfig').trigger('click')
    await flushPromises()
    expect(api.updateWireGuardClient).toHaveBeenCalledWith(expect.objectContaining({ privateKey: SECRET }))
    expect(wrapper.findAll<HTMLInputElement>('input.secret')[0]!.element.value).toBe('')
    expect(wrapper.html()).not.toContain(SECRET)
    secretsNeverPersisted()
  })

  it('refuses global routing until the user explicitly allows it', async () => {
    await open()
    await wrapper.get('input[type="radio"][value="global"]').setValue(true)
    await button('wg.saveConfig').trigger('click')
    await flushPromises()
    expect(api.updateWireGuardClient).not.toHaveBeenCalled()
    await wrapper.get('.alert-warning input[type="checkbox"]').setValue(true)
    await button('wg.saveConfig').trigger('click')
    await flushPromises()
    expect(api.updateWireGuardClient).not.toHaveBeenCalled()
    await button('wg.allowGlobalRoute').trigger('click')
    await flushPromises()
    expect(api.updateWireGuardClient).toHaveBeenCalledWith(expect.objectContaining({
      routeMode: 'global',
      allowGlobalRoute: true,
      peer: expect.objectContaining({ allowedIPs: [] }),
    }))
  })

  it('asks before generating a new private key and does not overwrite until confirmed', async () => {
    await open()
    await button('wg.generate').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('wg.generateWarningStored')
    expect(api.updateWireGuardClient).not.toHaveBeenCalled()
    const generateButtons = wrapper.findAll('button').filter((b) => b.text() === 'wg.generate')
    await generateButtons[generateButtons.length - 1]!.trigger('click')
    await button('wg.saveConfig').trigger('click')
    await flushPromises()
    expect(api.updateWireGuardClient).toHaveBeenCalledWith(expect.objectContaining({ privateKey: 'generate' }))
  })

  it('imports a pasted config through the confirm task and discards the text', async () => {
    await open()
    await button('wg.importConfig').trigger('click')
    const conf = `[Interface]\nPrivateKey = ${SECRET}\n[Peer]\nPublicKey = ${PEER_PUB}\nEndpoint = vpn.example.org:51820\n`
    await wrapper.get('textarea.conf').setValue(conf)
    await button('wg.import').trigger('click')
    await flushPromises()
    expect(api.importWireGuardClient).toHaveBeenCalledWith(conf)
    expect(wrapper.find('textarea.conf').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    await button('apply.rollback').trigger('click')
    await flushPromises()
    expect(api.cancelConfigTask).toHaveBeenCalledWith('wg-task')
    secretsNeverPersisted()
  })
})