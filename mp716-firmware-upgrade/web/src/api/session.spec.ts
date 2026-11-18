import { afterEach, expect, it, vi } from 'vitest'
import { createRouterApi } from './create-router-api.prod'
import { setRouterApiTokenGetter } from './index.prod'

afterEach(() => {
  setRouterApiTokenGetter(() => null)
  vi.unstubAllGlobals()
})

it('shares the current login token with the production device adapter', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: {} })))
  vi.stubGlobal('fetch', fetch)
  let token: string | null = null
  setRouterApiTokenGetter(() => token)
  const api = createRouterApi()
  token = '0123456789abcdef0123456789abcdef'
  await api.getSystemInfo()
  expect(fetch.mock.calls[0]?.[0]).toBe('/cgi-bin/mp716/system/info')
  expect(fetch.mock.calls[0]?.[1].headers.Authorization).toBe(`Bearer ${token}`)
  token = null
  await api.ping()
  expect(fetch.mock.calls[1]?.[1].headers.Authorization).toBeUndefined()
})
