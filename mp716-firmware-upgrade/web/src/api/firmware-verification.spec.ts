import { afterEach, expect, it, vi } from 'vitest'
import { DeviceRouterAdapter } from './adapters/device-adapter'
import { isSignedVersionRejection, readVerificationReport } from './firmware-verification'

afterEach(() => vi.unstubAllGlobals())

const versionRejection = { ok: false, code: 14, signature_checked: true, flash_write: false,
  bytes_programmed: 0, erased: false, accepted: false, firmware_version: '1.0.2' }

it('preserves native version rejection and valid-signature evidence without claiming full validation', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: 'VALIDATION',
    message: 'image is not newer', details: versionRejection }), { status: 400 }))
  vi.stubGlobal('fetch', fetch)
  const result = await new DeviceRouterAdapter(() => 'test-session').uploadFirmware(new Blob(['package']))
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.details).toEqual(versionRejection)
    expect(isSignedVersionRejection(readVerificationReport(result.details))).toBe(true)
  }
  expect(fetch.mock.calls[0]?.[0]).toBe('/cgi-bin/mp716/system/firmware-package/verify')
})

it('never treats invalid signatures or a reported flash write as a harmless version rejection', () => {
  expect(isSignedVersionRejection({ ...versionRejection, code: 10, signature_checked: false })).toBe(false)
  expect(isSignedVersionRejection({ ...versionRejection, flash_write: true })).toBe(false)
  expect(readVerificationReport({ signature_checked: true })).toBeNull()
})

it('keeps the original signed rejection from older nested upload responses', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    ok: false, code: 'VALIDATION', details: { details: versionRejection },
  }), { status: 400 })))
  const result = await new DeviceRouterAdapter(() => 'test-session').uploadFirmware(new Blob())
  expect(result.ok).toBe(false)
  if (!result.ok) expect(isSignedVersionRejection(readVerificationReport(result.details))).toBe(true)
})

it('does not report legacy flash upload as submitted when the request fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
  const result = await new DeviceRouterAdapter(() => 'test-session').uploadFirmware(new Blob(), { flash: true })
  expect(result).toMatchObject({ ok: false, code: 'NETWORK' })
})

it('rejects an inconsistent successful HTTP envelope containing a failed native report', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: versionRejection }))))
  const result = await new DeviceRouterAdapter(() => null).uploadFirmware(new Blob())
  expect(result.ok).toBe(false)
})

it('does not pretend apply succeeded on HTTP 507 or network abort', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: false, code: 'LOW_MEMORY', message: '系统可用内存不足', details: { needMemKb: 8704 } }),
        { status: 507 },
      ),
    )
    .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
  vi.stubGlobal('fetch', fetch)
  const api = new DeviceRouterAdapter(() => 'test-session')
  const denied = await api.applyFirmwareV2({ jobId: 'abc', keepSettings: true })
  expect(denied.ok).toBe(false)
  if (!denied.ok) expect(denied.code).toBe('LOW_MEMORY')
  const aborted = await api.applyFirmwareV2({ jobId: 'abc', keepSettings: true })
  expect(aborted.ok).toBe(false)
  if (!aborted.ok) expect(aborted.message).toMatch(/超时/)
})
