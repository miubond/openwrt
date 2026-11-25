import { describe, expect, it } from 'vitest'
import { findNavChildByPath, findPrimaryByPath, navLeaves, primaryNav } from './nav'

describe('primaryNav coverage', () => {
  it('every leaf path is unique', () => {
    const paths = primaryNav.flatMap((item) => navLeaves(item).map((c) => c.to))
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('matches factory menulist leaf count (29)', () => {
    const paths = primaryNav.flatMap((item) => {
      const leaves = navLeaves(item).filter((c) => !c.native)
      return leaves.length ? leaves.map((c) => c.to) : [item.to]
    })
    expect(paths).toHaveLength(29)
  })

  it('keeps native-only WireGuard client under the VPN group', () => {
    const native = primaryNav.flatMap((item) => navLeaves(item).filter((c) => c.native).map((c) => c.to))
    expect(native).toEqual(['/advanced/vpn/wireguard-client'])
    expect(findPrimaryByPath('/advanced/vpn/wireguard-client').key).toBe('advanced')
  })
})

describe('findNavChildByPath', () => {
  it('resolves new network and wifi entries', () => {
    expect(findNavChildByPath('/network/wan')?.labelKey).toBe('nav.wan')
    expect(findNavChildByPath('/network/dns')).toBeNull()
    expect(findNavChildByPath('/network/qos')).toBeNull()
    expect(findNavChildByPath('/wifi/clients')).toBeNull()
    expect(findNavChildByPath('/advanced/security/dmz')).toBeNull()
    expect(findNavChildByPath('/advanced/vpn/pptpd')?.labelKey).toBe('nav.vpnPptpd')
  })
})

describe('findPrimaryByPath', () => {
  it('keeps network active for all /network/* pages', () => {
    expect(findPrimaryByPath('/network/ddns').key).toBe('network')
    expect(findPrimaryByPath('/network/wan-status').key).toBe('network')
  })
})