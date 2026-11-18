import { formatDateTime } from '@/utils/format'
import type {
  AdminPasswordChange,
  ConfigTaskStatus,
  DhcpConfig,
  DnsConfig,
  FirewallRule,
  PortForwardRule,
  SystemLogEntry,
  SystemTimeConfig,
  WanConfig,
  LanConfig,
  WifiConfig,
  WirelessAclEntry,
  WirelessClient,
  ConnectedDevice,
} from '../types'

export const mockWan: WanConfig = {
  proto: 'dhcp',
  dns: ['223.5.5.5', '223.6.6.6'],
  mtu: 1500,
  hostname: 'ROUTE',
  macaddr: '00:1C:A3:36:43:56',
  defaultMac: '00:1C:A3:36:43:56',
  clientMac: 'AA:BB:CC:DD:EE:10',
  wanMode: 'wired',
}

export const mockLan: LanConfig = {
  ipv4: '192.168.199.1',
  netmask: '255.255.255.0',
  dhcpRelay: false,
}

export const mockWifi: WifiConfig = {
  enabled: true,
  ssid: 'MP716-4353',
  hidden: false,
  channel: 6,
  txPower: 100,
  security: 'wpa-wpa2-psk',
  password: 'changeme123',
  cipher: 'aes',
  mode: '11bgn',
  htmode: 'AUTO',
  txpowerPercent: 100,
  maxClients: 32,
  isolate: false,
  macfilter: 'disable',
  maclist: [],
}

export const mockDhcp: DhcpConfig = {
  enabled: true,
  start: 100,
  limit: 150,
  leasetime: '12h',
  gateway: '192.168.199.1',
  dns: ['192.168.199.1'],
  leases: [
    {
      hostname: 'phone-01',
      mac: 'AA:BB:CC:DD:EE:01',
      ipv4: '192.168.1.101',
      expiresSec: 36000,
    },
  ],
}

export const mockDns: DnsConfig = {
  mode: 'auto',
  servers: [],
}

export const mockFirewall: FirewallRule[] = [
  {
    id: 'fw-1',
    name: '允许 LAN 访问',
    enabled: true,
    src: 'lan',
    dest: 'wan',
    proto: 'tcp udp',
    action: 'ACCEPT',
  },
]

export const mockPortForwards: PortForwardRule[] = [
  {
    id: 'pf-1',
    name: 'Web 服务',
    enabled: true,
    proto: 'tcp',
    extPort: 8080,
    intIp: '192.168.1.10',
    intPort: 80,
  },
]

export let mockAclMode: import('../types').WirelessAclMode = 'deny'

export function setMockAclMode(mode: import('../types').WirelessAclMode) {
  mockAclMode = mode
}

export const mockAcl: WirelessAclEntry[] = [
  {
    id: 'acl-1',
    mac: 'AA:BB:CC:DD:EE:99',
    policy: 'deny',
    note: '测试黑名单',
  },
]

export const mockWirelessClients: WirelessClient[] = [
  {
    mac: 'AA:BB:CC:DD:EE:01',
    ipv4: '192.168.1.101',
    hostname: 'phone-01',
    ssid: mockWifi.ssid,
    rssi: -52,
    txRateMbps: 72,
    rxRateMbps: 65,
    connectedSec: 3600,
  },
  {
    mac: 'AA:BB:CC:DD:EE:03',
    ipv4: '192.168.1.108',
    hostname: 'pad-01',
    ssid: mockWifi.ssid,
    rssi: -61,
    txRateMbps: 54,
    rxRateMbps: 48,
    connectedSec: 1200,
  },
]

/** 终端防蹭网 ACL（HYID 60–62 对应 mock） */
export const mockDeviceAcl: string[] = []

export const mockDevices: ConnectedDevice[] = [
  {
    id: '1',
    mac: 'AA:BB:CC:DD:EE:01',
    ipv4: '192.168.1.101',
    hostname: '手机-01',
    interface: 'ra0',
    wired: false,
    online: true,
    rxBytes: 12_000_000,
    txBytes: 4_000_000,
    lastSeen: new Date().toISOString(),
  },
  {
    id: '2',
    mac: 'AA:BB:CC:DD:EE:02',
    ipv4: '192.168.1.105',
    hostname: '台式机',
    interface: 'lan1',
    wired: true,
    online: true,
    rxBytes: 120_000_000,
    txBytes: 80_000_000,
    lastSeen: new Date().toISOString(),
  },
]

export const mockLogs: SystemLogEntry[] = Array.from({ length: 30 }).map((_, i) => ({
  id: i + 1,
  time: new Date(Date.now() - i * 60_000).toISOString(),
  facility: i % 3 === 0 ? 'network' : 'system',
  level: i % 5 === 0 ? 'warning' : 'info',
  message: `模拟日志条目 #${i + 1}：服务运行正常`,
}))

export const mockTime: SystemTimeConfig = {
  timezone: 'Asia/Shanghai',
  ntpEnabled: true,
  ntpServers: ['ntp.aliyun.com', 'cn.pool.ntp.org'],
  localTime: formatDateTime(new Date()),
}

let adminPassword = 'admin'

export function verifyAdminPassword(input: string): boolean {
  return input === adminPassword
}

export function updateAdminPassword(change: AdminPasswordChange): boolean {
  if (change.oldPassword !== adminPassword) return false
  if (change.newPassword.length < 8) return false
  adminPassword = change.newPassword
  return true
}

const tasks = new Map<string, ConfigTaskStatus>()

export function createConfigTask(taskId: string, rollbackSec: number) {
  tasks.set(taskId, {
    taskId,
    state: 'pending',
    remainingSec: rollbackSec,
    message: '等待用户确认或超时回滚',
  })
}

export function getTask(taskId: string): ConfigTaskStatus | undefined {
  const task = tasks.get(taskId)
  if (!task) return undefined
  if (task.state === 'pending' && task.remainingSec > 0) {
    task.remainingSec = Math.max(0, task.remainingSec - 1)
    if (task.remainingSec === 0) {
      task.state = 'rolled_back'
      task.message = '未确认，配置已回滚'
    }
  }
  return { ...task }
}

export function confirmTask(taskId: string): ConfigTaskStatus | undefined {
  const task = tasks.get(taskId)
  if (!task) return undefined
  if (task.state !== 'pending') return { ...task }
  task.state = 'confirmed'
  task.message = '配置已确认生效'
  task.remainingSec = 0
  return { ...task }
}
