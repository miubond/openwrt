import type { IconName } from '@/components/icons'

export interface NavChild {
  to: string
  labelKey: string
  icon: IconName
  status?: 'ready' | 'dev' | 'limited'
}

export interface NavSection {
  labelKey: string
  children: NavChild[]
}

export interface PrimaryNavItem {
  key: string
  labelKey: string
  to: string
  icon: IconName
  /** 扁平二级（无线等） */
  children?: NavChild[]
  /** 分组二级（网络 / 高级，对齐原厂三级菜单） */
  sections?: NavSection[]
}

/** 与 factory-www menulist 1:1（选项 1）；残留能力不进菜单 */
export const primaryNav: PrimaryNavItem[] = [
  {
    key: 'home',
    labelKey: 'nav.home',
    to: '/',
    icon: 'home',
  },
  {
    key: 'network',
    labelKey: 'nav.network',
    to: '/network/wan',
    icon: 'network',
    sections: [
      {
        labelKey: 'nav.groupWan',
        children: [
          { to: '/network/wan', labelKey: 'nav.wan', icon: 'wan' },
          { to: '/network/wan-status', labelKey: 'nav.wanStatus', icon: 'activity' },
        ],
      },
      {
        labelKey: 'nav.groupLan',
        children: [
          { to: '/network/lan', labelKey: 'nav.lan', icon: 'lan' },
          { to: '/network/lan-status', labelKey: 'nav.lanStatus', icon: 'clients' },
          { to: '/network/dhcp', labelKey: 'nav.dhcp', icon: 'dhcp' },
        ],
      },
    ],
  },
  {
    key: 'wifi',
    labelKey: 'nav.wifi',
    to: '/wifi/basic',
    icon: 'wifi',
    sections: [
      {
        labelKey: 'nav.groupWifi24',
        children: [
          { to: '/wifi/basic', labelKey: 'nav.wifiBasic', icon: 'wifi' },
          { to: '/wifi/advanced', labelKey: 'nav.wifiAdvanced', icon: 'advanced' },
          { to: '/wifi/acl', labelKey: 'nav.wifiAcl', icon: 'mac' },
        ],
      },
    ],
  },
  {
    key: 'devices',
    labelKey: 'nav.devices',
    to: '/devices',
    icon: 'devices',
  },
  {
    key: 'advanced',
    labelKey: 'nav.advanced',
    to: '/advanced/system/device',
    icon: 'advanced',
    sections: [
      {
        labelKey: 'nav.groupVpn',
        children: [
          { to: '/advanced/vpn/pptpd', labelKey: 'nav.vpnPptpd', icon: 'vpn' },
          { to: '/advanced/vpn/xl2tpd', labelKey: 'nav.vpnXl2tpd', icon: 'vpn' },
          { to: '/advanced/vpn/pptp', labelKey: 'nav.vpnPptp', icon: 'vpn' },
          { to: '/advanced/vpn/xl2tp', labelKey: 'nav.vpnXl2tp', icon: 'vpn' },
          { to: '/advanced/vpn/users', labelKey: 'nav.vpnUsers', icon: 'user' },
          { to: '/advanced/vpn/status', labelKey: 'nav.vpnStatus', icon: 'clients' },
          { to: '/advanced/vpn/openvpn', labelKey: 'nav.vpnOpenvpn', icon: 'vpn' },
        ],
      },
      {
        labelKey: 'nav.groupSystem',
        children: [
          { to: '/advanced/system/device', labelKey: 'nav.sysInfo', icon: 'info' },
          { to: '/advanced/system/upgrade', labelKey: 'nav.sysUpgrade', icon: 'upgrade' },
          { to: '/advanced/system/reset', labelKey: 'nav.sysReset', icon: 'dmz' },
          { to: '/advanced/system/config', labelKey: 'nav.sysBackup', icon: 'backup' },
          { to: '/advanced/system/reboot', labelKey: 'nav.sysReboot', icon: 'power' },
          { to: '/advanced/system/sche-reboot', labelKey: 'nav.sysScheReboot', icon: 'time' },
          { to: '/advanced/system/time', labelKey: 'nav.sysTime', icon: 'time' },
          { to: '/advanced/system/log', labelKey: 'nav.sysLogs', icon: 'logs' },
          { to: '/advanced/system/admin', labelKey: 'nav.sysPassword', icon: 'lock' },
        ],
      },
      {
        labelKey: 'nav.groupTool',
        children: [
          { to: '/advanced/tool/ping', labelKey: 'nav.toolPing', icon: 'diagnose' },
          { to: '/advanced/tool/tracert', labelKey: 'nav.toolTracert', icon: 'route' },
          { to: '/advanced/tool/dhcp-test', labelKey: 'nav.toolDhcpTest', icon: 'dhcp' },
        ],
      },
    ],
  },
]

export function navLeaves(item: PrimaryNavItem): NavChild[] {
  if (item.sections?.length) return item.sections.flatMap((s) => s.children)
  return item.children || []
}

export function findPrimaryByPath(path: string): PrimaryNavItem {
  const normalized = path === '' ? '/' : path
  for (const item of primaryNav) {
    if (item.to === normalized) return item
    if (navLeaves(item).some((c) => c.to === normalized)) return item
    if (item.key === 'home' && normalized === '/') return item
    if (item.key !== 'home' && normalized.startsWith(`/${item.key}`)) return item
    if (item.key === 'wifi' && normalized.startsWith('/wifi')) return item
    if (item.key === 'devices' && normalized.startsWith('/devices')) return item
    if (item.key === 'advanced' && (normalized.startsWith('/advanced') || normalized.startsWith('/system')))
      return item
    if (item.key === 'network' && normalized.startsWith('/network')) return item
  }
  return primaryNav[0]
}

export function showSubnav(item: PrimaryNavItem): boolean {
  return navLeaves(item).length > 0
}
