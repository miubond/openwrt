import { afterEach, expect, it, vi } from 'vitest'
import { requestJson } from './http'
import { notifyUnauthorized, setUnauthorizedHandler, unwrap } from './result'

afterEach(() => {
  setUnauthorizedHandler(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('notifies when unwrap sees UNAUTHORIZED', () => {
  vi.useFakeTimers()
  const handler = vi.fn()
  setUnauthorizedHandler(handler)

  expect(() =>
    unwrap({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'expired',
      ts: Date.now(),
    }),
  ).toThrow(/expired/)
  expect(handler).toHaveBeenCalledTimes(1)

  expect(() =>
    unwrap({
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'expired again',
      ts: Date.now(),
    }),
  ).toThrow(/expired again/)
  expect(handler).toHaveBeenCalledTimes(1)

  vi.advanceTimersByTime(800)
  notifyUnauthorized()
  expect(handler).toHaveBeenCalledTimes(2)
})

it('notifies on HTTP 401 from requestJson', async () => {
  const handler = vi.fn()
  setUnauthorizedHandler(handler)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })),
  )

  const res = await requestJson('/cgi-bin/mp716/network/wan/status', { token: 'bad' })
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.code).toBe('UNAUTHORIZED')
  expect(handler).toHaveBeenCalledTimes(1)
})

it('does not notify for login HTTP 401', async () => {
  const handler = vi.fn()
  setUnauthorizedHandler(handler)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })),
  )

  const res = await requestJson('/cgi-bin/mp716/auth/login', {
    method: 'POST',
    body: { username: 'a', password: 'b' },
  })
  expect(res.ok).toBe(false)
  expect(handler).not.toHaveBeenCalled()
})
