import type { IconName } from '@/components/icons'

/** 不进 29 叶 menulist 的 Bundle 深链（对齐 factory-full-parity-roadmap B 层） */
export interface BundleLink {
  to: string
  routeName: string
  icon: IconName
  /** capabilities.bundle 字段；缺失表示始终展示 */
  capabilityKey?: keyof import('@/api/types').NativeBundleCapabilities
}

export const bundleLinks: BundleLink[] = [
  { to: '/network/dns', routeName: 'network-dns', icon: 'network', capabilityKey: 'dnsPage' },
  { to: '/network/ddns', routeName: 'network-ddns', icon: 'wan', capabilityKey: 'ddns' },
  { to: '/network/qos', routeName: 'network-qos', icon: 'activity', capabilityKey: 'qos' },
  { to: '/network/static-route', routeName: 'network-static-route', icon: 'route', capabilityKey: 'staticRoutes' },
  { to: '/advanced/security/firewall', routeName: 'security-firewall', icon: 'firewall', capabilityKey: 'firewall' },
  { to: '/advanced/security/port-forward', routeName: 'security-port-forward', icon: 'port', capabilityKey: 'portForward' },
  { to: '/advanced/security/dmz', routeName: 'security-dmz', icon: 'dmz', capabilityKey: 'dmz' },
  { to: '/advanced/security/upnp', routeName: 'security-upnp', icon: 'advanced', capabilityKey: 'upnp' },
]