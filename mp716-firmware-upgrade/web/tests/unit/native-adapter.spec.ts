import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceRouterAdapter } from '@/api/adapters/device-adapter'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/api/http', () => ({ requestJson: request, failure: (code: string, message: string) => ({ ok: false, code, message }) }))
const adapter = new DeviceRouterAdapter(() => 'test-session')
beforeEach(() => { request.mockReset(); request.mockResolvedValue({ ok: true, data: { accepted: true, rollbackSec: 0 } }) })
describe('native file operations', () => {
  it('uploads OpenVPN file content, not only filename and length', async () => {
    const file = new NodeFile(['client\nremote vpn.example.org\n'], 'client.ovpn')
    await adapter.uploadOpenVpn(file as unknown as File, 'config')
    const [url, options] = request.mock.calls[0]!
    expect(url).toBe('/cgi-bin/mp716/vpn/openvpn/upload')
    expect(options.token).toBe('test-session')
    expect(atob(options.body.contentBase64)).toBe('client\nremote vpn.example.org\n')
    expect(options.body.kind).toBe('config')
  })
  it('rejects oversized OpenVPN files before reading/sending their contents', async () => {
    const file = new NodeFile([new Uint8Array(256 * 1024 + 1)], 'large.pem')
    expect((await adapter.uploadOpenVpn(file as unknown as File, 'cert')).ok).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
  it('passes the exported native configuration document to the restore API', async () => {
    const backup = { format: 'MP716-CONFIG', version: 1, files: { network: 'fixture' } }
    await adapter.restoreConfig(new NodeBlob([JSON.stringify(backup)]) as unknown as Blob)
    expect(request).toHaveBeenCalledWith('/cgi-bin/mp716/system/restore', expect.objectContaining({ body: { backup } }))
  })
  it('rejects an original-firmware binary backup without sending it to the native API', async () => {
    expect((await adapter.restoreConfig(new NodeBlob(['not a native backup']) as unknown as Blob)).ok).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
})
