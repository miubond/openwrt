import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import VpnUsersPage from './VpnUsersPage.vue'
import type { VpnUserConfig } from '@/api/types'

const api = vi.hoisted(() => ({ getVpnUsers: vi.fn(), updateVpnUsers: vi.fn(), getConfigTaskStatus: vi.fn(), confirmConfigTask: vi.fn(), cancelConfigTask: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (s: string) => s }) }))
vi.mock('@/api', () => ({ getRouterApi: () => api, unwrap: (r: { data: unknown }) => r.data, asApplyHandle: (r: { taskId: string; rollbackSec: number }) => ({ applyId: r.taskId, timeoutSec: r.rollbackSec }), formatApiError: (e: Error) => e.message }))
const original: VpnUserConfig = { users: [{ type: 'all', username: 'existing', password: '********', address: '', comment: '', routes: '' }], types: ['all', 'pptp', 'l2tp'], pptpStart: '10.71.60.10', pptpEnd: '10.71.60.100', l2tpStart: '10.71.61.10', l2tpEnd: '10.71.61.100' }
let current: VpnUserConfig, wrapper: ReturnType<typeof mount>
beforeEach(() => {
  vi.useFakeTimers(); current = structuredClone(original)
  api.getVpnUsers.mockImplementation(async () => ({ ok: true, data: { ...current, users: current.users.map(u => ({ ...u, password: '********' })) } }))
  api.updateVpnUsers.mockImplementation(async (next: VpnUserConfig) => { current = JSON.parse(JSON.stringify(next)); return { ok: true, data: { accepted: true, taskId: 'users', rollbackSec: 90 } } })
  api.confirmConfigTask.mockResolvedValue({ ok: true, data: { state: 'confirmed' } })
  api.cancelConfigTask.mockImplementation(async () => { current = structuredClone(original); return { ok: true, data: { state: 'rolled_back' } } })
})
afterEach(() => { wrapper?.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks() })
async function open() { wrapper = mount(VpnUsersPage, { global: { plugins: [createPinia()], stubs: { teleport: true } } }); await flushPromises() }
function button(label: string) { return wrapper.findAll('button').find(b => b.text() === label)! }
async function add() {
  await button('vpn.addUser').trigger('click')
  await wrapper.get('.user-form input[autocomplete="off"]').setValue('alice')
  await wrapper.get('.user-form input[autocomplete="new-password"]').setValue('fixture-secret')
  await button('common.ok').trigger('click'); await flushPromises()
}
it('adds a user through its editor, then restores the prior list on rollback', async () => {
  await open(); await add()
  expect(api.updateVpnUsers).toHaveBeenCalledWith(expect.objectContaining({ users: expect.arrayContaining([expect.objectContaining({ username: 'alice', password: 'fixture-secret' })]) }))
  expect(wrapper.get('tbody').text()).toContain('alice')
  await button('apply.rollback').trigger('click'); await flushPromises()
  expect(api.cancelConfigTask).toHaveBeenCalledWith('users')
  expect(wrapper.get('tbody').text()).not.toContain('alice')
  expect(wrapper.get('tbody').text()).toContain('existing')
})
it('deletes a user only after the delete confirmation and supports rollback', async () => {
  await open(); await wrapper.get('button[aria-label="common.delete"]').trigger('click')
  expect(api.updateVpnUsers).not.toHaveBeenCalled()
  await button('common.delete').trigger('click'); await flushPromises()
  expect(api.updateVpnUsers).toHaveBeenCalledWith(expect.objectContaining({ users: [] }))
  expect(wrapper.get('tbody').text()).toContain('common.emptyUsers')
  expect(wrapper.get('tbody').text()).not.toContain('existing')
  await button('apply.rollback').trigger('click'); await flushPromises()
  expect(wrapper.get('tbody').text()).toContain('existing')
})
it('keeps an added user after explicit device confirmation', async () => {
  await open(); await add()
  await button('apply.keep').trigger('click'); await flushPromises()
  expect(api.confirmConfigTask).toHaveBeenCalledWith('users')
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(wrapper.get('tbody').text()).toContain('alice')
})
