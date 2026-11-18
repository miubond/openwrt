import { describe, expect, it } from 'vitest'
import { MockRouterAdapter } from '@/api/adapters/mock-adapter'

describe('MockRouterAdapter', () => {
  const api = new MockRouterAdapter()

  it('rejects invalid login', async () => {
    const res = await api.login({ username: 'x', password: 'y' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('UNAUTHORIZED')
  })

  it('accepts admin login and returns system info', async () => {
    const login = await api.login({ username: 'admin', password: 'admin' })
    expect(login.ok).toBe(true)
    const info = await api.getSystemInfo()
    expect(info.ok).toBe(true)
    if (info.ok) expect(info.data.model).toBe('MP716')
  })

  it('validates wan static config', async () => {
    const res = await api.updateWanConfig({
      proto: 'static',
      dns: [],
      mtu: 1500,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('VALIDATION')
  })
})
