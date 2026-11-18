import { describe, expect, it } from 'vitest'
import { MockRouterAdapter } from '@/api/adapters/mock-adapter'

describe('config task lifecycle', () => {
  const api = new MockRouterAdapter()

  it('creates and confirms wan task', async () => {
    await api.login({ username: 'admin', password: 'admin' })
    const apply = await api.updateLanConfig({
      ipv4: '192.168.1.1',
      netmask: '255.255.255.0',
      dhcpRelay: false,
    })
    expect(apply.ok).toBe(true)
    if (!apply.ok || !apply.data.taskId) return
    const status = await api.getConfigTaskStatus(apply.data.taskId)
    expect(status.ok).toBe(true)
    const confirmed = await api.confirmConfigTask(apply.data.taskId)
    expect(confirmed.ok).toBe(true)
    if (confirmed.ok) expect(confirmed.data.state).toBe('confirmed')
  })
})
