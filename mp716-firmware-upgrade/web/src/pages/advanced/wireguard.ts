import type { WireGuardClientStatus, WireGuardPeerStats, WireGuardProbe, WireGuardReservedNet, WireGuardStatus } from '@/api'
import { formatBytes, formatUptime } from '@/utils/format'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** 逗号、空格或换行分隔的输入 → 去重数组 */
export function splitList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))]
}

export function joinList(list: string[] | undefined): string {
  return (list ?? []).join(', ')
}

/** 握手超过 180 秒视为“过期但仍可能可用”（WireGuard REJECT_AFTER_TIME） */
export const WG_HANDSHAKE_STALE_SEC = 180

export type WgRuntimeKind =
  | 'disabled'
  | 'missing'
  | 'iface-error'
  | 'iface-down'
  | 'handshaking'
  | 'handshake-recent'
  | 'handshake-stale'
  | 'probe-fail'

export type WgBadgeStatus = 'up' | 'down' | 'warn' | 'unknown'

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const v = Number(part)
    if (v > 255) return null
    n = (n << 8) + v
  }
  return n >>> 0
}

function parseV4Cidr(cidr: string): { start: number; end: number } | null {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim())
  if (!m) return null
  const ip = ipv4ToInt(m[1]!)
  const bits = Number(m[2])
  if (ip == null || bits > 32) return null
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  const start = ip & mask
  const end = start + (bits === 32 ? 0 : 2 ** (32 - bits) - 1)
  return { start, end }
}

export function routeConflicts(allowedIps: string[], reserved: WireGuardReservedNet[] | undefined): WireGuardReservedNet[] {
  if (!reserved?.length) return []
  const hits: WireGuardReservedNet[] = []
  for (const item of allowedIps) {
    const a = parseV4Cidr(item)
    if (!a) continue
    for (const net of reserved) {
      const b = parseV4Cidr(net.cidr)
      if (!b) continue
      if (a.start <= b.end && b.start <= a.end && !hits.some((h) => h.label === net.label && h.cidr === net.cidr))
        hits.push(net)
    }
  }
  return hits
}

export function handshakeState(stats: Pick<WireGuardPeerStats, 'handshakeAgeSec'> | undefined): 'up' | 'warn' | 'down' {
  if (!stats || stats.handshakeAgeSec < 0) return 'down'
  return stats.handshakeAgeSec <= WG_HANDSHAKE_STALE_SEC ? 'up' : 'warn'
}

export function handshakeText(stats: Pick<WireGuardPeerStats, 'handshakeAgeSec'> | undefined, t: Translate): string {
  if (!stats || stats.handshakeAgeSec < 0) return t('wg.never')
  return t('wg.ago', { time: formatUptime(stats.handshakeAgeSec, t) })
}

export function runtimeKind(
  status: WireGuardStatus | null | undefined,
  client: WireGuardClientStatus | null | undefined,
): WgRuntimeKind {
  if (!client?.enabled) return 'disabled'
  if (status && status.available === false) return 'missing'
  if (client.error || client.ifaceState === 'error') return 'iface-error'
  if (!client.up) return 'iface-down'
  if (client.probe?.state === 'fail') return 'probe-fail'
  const age = client.handshakeAgeSec
  if (age < 0) return 'handshaking'
  if (age <= WG_HANDSHAKE_STALE_SEC) return 'handshake-recent'
  return 'handshake-stale'
}

export function runtimeBadge(kind: WgRuntimeKind): { status: WgBadgeStatus; labelKey: string } {
  switch (kind) {
    case 'disabled':
      return { status: 'unknown', labelKey: 'wg.stateDisabled' }
    case 'missing':
      return { status: 'down', labelKey: 'wg.stateMissing' }
    case 'iface-error':
      return { status: 'down', labelKey: 'wg.stateError' }
    case 'iface-down':
      return { status: 'down', labelKey: 'wg.stateIfaceDown' }
    case 'handshaking':
      return { status: 'warn', labelKey: 'wg.stateWaiting' }
    case 'handshake-recent':
      return { status: 'up', labelKey: 'wg.stateHandshakeRecent' }
    case 'handshake-stale':
      return { status: 'warn', labelKey: 'wg.stateHandshakeStale' }
    case 'probe-fail':
      return { status: 'down', labelKey: 'wg.stateProbeFail' }
  }
}

export function probeText(probe: WireGuardProbe | undefined, t: Translate): string {
  if (!probe) return '—'
  if (probe.state === 'ok') return probe.target ? t('wg.probeOkTarget', { target: probe.target }) : t('wg.probeOk')
  if (probe.state === 'fail') return probe.target ? t('wg.probeFailTarget', { target: probe.target }) : t('wg.probeFail')
  const reasons: Record<string, string> = {
    disabled: 'wg.probeSkippedDisabled',
    'iface-down': 'wg.probeSkippedIface',
    'no-target': 'wg.probeSkippedTarget',
  }
  return t(reasons[probe.reason] || 'wg.probeSkipped')
}

export function failureReason(client: WireGuardClientStatus | null | undefined, kind: WgRuntimeKind, t: Translate): string {
  if (!client || kind === 'disabled' || kind === 'handshake-recent') return ''
  if (client.errors?.length) return client.errors.join('；')
  if (kind === 'probe-fail') return t('wg.failProbe')
  if (kind === 'iface-error') return t('wg.failIface')
  if (kind === 'iface-down') return t('wg.failIfaceDown')
  if (kind === 'missing') return t('wg.failMissing')
  if (kind === 'handshaking') return t('wg.failWaiting')
  if (kind === 'handshake-stale') return t('wg.failStale')
  return ''
}

export function trafficRx(stats: Pick<WireGuardPeerStats, 'rxBytes'> | undefined): string {
  if (!stats) return '—'
  return formatBytes(stats.rxBytes)
}

export function trafficTx(stats: Pick<WireGuardPeerStats, 'txBytes'> | undefined): string {
  if (!stats) return '—'
  return formatBytes(stats.txBytes)
}

export function trafficText(stats: Pick<WireGuardPeerStats, 'rxBytes' | 'txBytes'> | undefined): string {
  if (!stats) return '—'
  return `↓ ${formatBytes(stats.rxBytes)} / ↑ ${formatBytes(stats.txBytes)}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
