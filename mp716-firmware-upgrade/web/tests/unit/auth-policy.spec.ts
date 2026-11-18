/**
 * 认证/ACL 策略 — 仅验证 PC 端 HTTP 客户端与契约文档一致性。
 * 设备端会话拒绝、ACL 越权：需在 OpenWrt RAM 环境单独标记验证。
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { requestJson } from '@/api/http'
import { ROUTER_API_CONTRACT } from '@/api/contract-manifest'

describe('auth policy [PC / fetch mock]', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps HTTP 401 to UNAUTHORIZED', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ ok: false, code: 'UNAUTHORIZED', message: 'bad' }),
      })),
    )
    const res = await requestJson('/cgi-bin/mp716/system/info', { token: 'bad' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('UNAUTHORIZED')
  })

  it('maps HTTP 403 to FORBIDDEN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({}),
      })),
    )
    const res = await requestJson('/cgi-bin/mp716/system/factory-reset', { token: 't', method: 'POST', body: {} })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('FORBIDDEN')
  })

  const PUBLIC_API_PATHS = ['auth/prelogin', 'auth/login'] as const

  it('contract marks protected routes', () => {
    const publicRoutes = ROUTER_API_CONTRACT.filter((r) => !r.auth)
    expect(publicRoutes.map((r) => r.path).sort()).toEqual([...PUBLIC_API_PATHS].sort())
  })

  it('only prelogin and login are unauthenticated API routes', () => {
    expect(
      ROUTER_API_CONTRACT.every((r) => r.auth || (PUBLIC_API_PATHS as readonly string[]).includes(r.path)),
    ).toBe(true)
  })
})
