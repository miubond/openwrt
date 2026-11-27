import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import UpgradeNativePage from './UpgradeNativePage.vue'
import { useDeviceRebootWait, type RebootWaitOptions } from '@/composables/useDeviceRebootWait'

const api = vi.hoisted(() => ({
  getFirmwareInfo: vi.fn(), uploadFirmware: vi.fn(), applyFirmwareV2: vi.fn(),
  getFirmwareV2Status: vi.fn(), getPreLoginConfig: vi.fn(),
}))
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({ useRouter: () => nav }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ setSession: vi.fn() }) }))
vi.mock('@/api', async () => ({ ...(await vi.importActual('@/api/result')), getRouterApi: () => api }))

let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.useFakeTimers()
  api.getFirmwareInfo.mockResolvedValue({ ok: true, data: { hardware: 'MP716', canUpgrade: true, flashUpgradeEnabled: true } })
  api.getPreLoginConfig.mockResolvedValue({ ok: true, data: { bootId: 'old', firmwareVersion: '1.0.13' } })
})
afterEach(() => {
  wrapper?.unmount()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.resetAllMocks()
})

it('keeps the selected file and the verified job paired through upload and confirmation', async () => {
  let finish!: (result: unknown) => void
  api.uploadFirmware.mockReturnValue(new Promise(resolve => { finish = resolve }))
  api.applyFirmwareV2.mockResolvedValue({ ok: true, data: { flashWrite: true } })
  wrapper = mount(UpgradeNativePage, { global: { plugins: [createPinia()], stubs: { teleport: true } } })
  await flushPromises()
  const input = wrapper.get('input[type=file]')
  async function select(name: string) {
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['firmware'], name)] })
    await input.trigger('change')
  }
  const button = (name: string) => wrapper!.findAll('button').find(b => b.text() === name)!
  await select('A.mp716upd')
  await button('upgrade.validateFirmware').trigger('click')
  expect(button('upgrade.pick').attributes('disabled')).toBeDefined()
  await select('B.mp716upd')
  finish({ ok: true, data: { jobId: 'job-a', validated: true, verificationReport: { firmware_version: '1.0.14' } } })
  await flushPromises()
  expect((wrapper.get('input.name').element as HTMLInputElement).value).toBe('A.mp716upd')
  await button('upgrade.startUpgrade').trigger('click')
  await wrapper.get('.dialog .btn.danger').trigger('click')
  await flushPromises()
  expect(api.applyFirmwareV2).toHaveBeenCalledWith({ jobId: 'job-a', keepSettings: true })
  expect(nav.push).toHaveBeenCalledWith({
    name: 'sys-reboot', query: { wait: '1', firmware: '1', task: 'job-a', version: '1.0.14', boot: 'old' },
  })
})

function startWait(options: RebootWaitOptions = { firmware: { task: 'job-a', version: '1.0.14', boot: 'old' } }) {
  let wait!: ReturnType<typeof useDeviceRebootWait>
  wrapper = mount(defineComponent({
    setup() {
      wait = useDeviceRebootWait(options)
      wait.startWaiting()
      return () => h('div')
    },
  }))
  return wait
}

it('surfaces a matching asynchronous failure before reboot', async () => {
  api.getFirmwareV2Status.mockResolvedValue({ ok: true, data: { taskId: 'job-a', state: 'FAILED', message: 'prepare_config exit 1' } })
  const wait = startWait()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(wait.phase.value).toBe('failed')
  expect(wait.failureMessage.value).toBe('prepare_config exit 1')
  expect(nav.replace).not.toHaveBeenCalled()
})

it('waits through old firmware uptime and confirms only the expected new boot', async () => {
  api.getFirmwareV2Status.mockResolvedValue({ ok: true, data: { taskId: 'job-a', state: 'APPLYING' } })
  const wait = startWait()
  await vi.advanceTimersByTimeAsync(180_000)
  expect(wait.phase.value).toBe('down')
  api.getPreLoginConfig.mockResolvedValue({ ok: true, data: {
    bootId: 'new', firmwareVersion: '1.0.14', firmwareBoot: { state: 'SUCCESS', expectedVersion: '1.0.14' },
  } })
  await vi.advanceTimersByTimeAsync(5000)
  expect(wait.phase.value).toBe('back')
})

it('does not confirm a reboot while the old boot is still serving requests', async () => {
  const wait = startWait({ action: { id: 'request', boot: 'old', reset: false } })
  await vi.advanceTimersByTimeAsync(180_000)
  expect(wait.phase.value).toBe('down')
  api.getPreLoginConfig.mockResolvedValue({ ok: true, data: { bootId: 'new' } })
  await vi.advanceTimersByTimeAsync(5000)
  expect(wait.phase.value).toBe('back')
})

it.each([
  [true, 'failed'],
  [undefined, 'down'],
  [false, 'back'],
] as const)('checks both the reboot and the reset marker (%s)', async (marker, expected) => {
  const wait = startWait({ action: { id: 'request', boot: 'old', reset: true } })
  await vi.advanceTimersByTimeAsync(10_000)
  expect(wait.phase.value).toBe('down')
  api.getPreLoginConfig.mockResolvedValue({ ok: true, data: { bootId: 'new', factoryResetMarker: marker } })
  await vi.advanceTimersByTimeAsync(5000)
  expect(wait.phase.value).toBe(expected)
})

it('reports failure for the submitted action only', async () => {
  const wait = startWait({ action: { id: 'request', boot: 'old', reset: true } })
  api.getPreLoginConfig.mockResolvedValue({
    ok: true, data: { bootId: 'old', systemAction: { id: 'other', state: 'failed' } },
  })
  await vi.advanceTimersByTimeAsync(10_000)
  expect(wait.phase.value).toBe('down')
  api.getPreLoginConfig.mockResolvedValue({
    ok: true, data: { bootId: 'old', systemAction: { id: 'request', state: 'failed' } },
  })
  await vi.advanceTimersByTimeAsync(5000)
  expect(wait.phase.value).toBe('failed')
})
