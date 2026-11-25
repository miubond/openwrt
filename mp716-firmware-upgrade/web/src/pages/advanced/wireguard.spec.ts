import { describe, expect, it } from 'vitest'
import { routeConflicts, runtimeKind } from './wireguard'
import type { WireGuardClientStatus, WireGuardStatus } from '@/api'

function status(client: Partial<WireGuardClientStatus>, available = true): WireGuardStatus {
  return {
    available,
    missing: available ? [] : ['kmod-wireguard'],
    client: {
      enabled: true,
      up: true,
      error: false,
      address: '10.73.0.2',
      endpoint: '203.0.113.5:51820',
      latestHandshake: 1,
      handshakeAgeSec: 30,
      rxBytes: 1,
      txBytes: 1,
      ...client,
    },
  }
}

describe('wireguard runtime', () => {
  it('does not treat an up interface as connected', () => {
    const report = status({ handshakeAgeSec: -1, latestHandshake: 0, probe: { state: 'skipped', target: '', reason: 'no-target', ageSec: -1 } })
    expect(runtimeKind(report, report.client)).toBe('handshaking')
  })

  it('does not treat a stale handshake as a dead tunnel', () => {
    const report = status({ handshakeAgeSec: 400, probe: { state: 'ok', target: '10.73.0.1', reason: 'ok', ageSec: 0 } })
    expect(runtimeKind(report, report.client)).toBe('handshake-stale')
  })

  it('shows probe failure separately from handshake', () => {
    const report = status({ handshakeAgeSec: 20, probe: { state: 'fail', target: '10.73.0.1', reason: 'ping-failed', ageSec: 0 } })
    expect(runtimeKind(report, report.client)).toBe('probe-fail')
  })

  it('flags AllowedIPs that overlap LAN', () => {
    expect(routeConflicts(['192.168.199.0/24'], [{ label: 'lan', cidr: '192.168.199.0/24' }])).toEqual([
      { label: 'lan', cidr: '192.168.199.0/24' },
    ])
    expect(routeConflicts(['10.73.0.0/24'], [{ label: 'lan', cidr: '192.168.199.0/24' }])).toEqual([])
  })
})
