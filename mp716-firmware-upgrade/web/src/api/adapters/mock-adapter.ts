import { tGlobal } from '@/i18n/t-global'
import { validateHost, validateRange, validateSource } from '@/utils/detect-input'
import { formatDateTime } from '@/utils/format'
import type { RouterAPI } from '../router-api'
import type {
  AdminPasswordChange,
  ApiResponse,
  BackupDownload,
  BackupResult,
  ConfigApplyResult,
  ConfigTaskStatus,
  ConnectedDevice,
  DeviceAclEntry,
  DiagnosticPoll,
  DiagnosticRequest,
  DiagnosticResult,
  DiagnosticType,
  DhcpConfig,
  StaticDhcpBinding,
  DnsConfig,
  FirewallRule,
  FirmwareInfo,
  LoginParams,
  LoginResult,
  PreLoginConfig,
  QuickSettingApplyResult,
  QuickSettingState,
  QuickSettingWan,
  QuickSettingWifi,
  PortForwardRule,
  DeviceInfo,
  SystemInfo,
  SystemLogState,
  SystemStatus,
  ScheRebootConfig,
  SystemTimeConfig,
  WanConfig,
  WanStatus,
  LanConfig,
  LanStatus,
  PptpClientConfig,
  VpnServerConfig,
  VpnUserConfig,
  L2tpClientConfig,
  VpnOnlineUser,
  OpenVpnConfig,
  WireGuardClientConfig,
  WireGuardImportResult,
  WireGuardStatus,
  WifiAdvancedConfig,
  WifiConfig,
  WifiSecondaryConfig,
  PhysicalPortStatus,
  WifiStatus,
  WirelessAclConfig,
  WirelessClient,
} from '../types'
import { WG_SECRET_MASK } from '../types'
import { failure, success } from '../http'
import {
  confirmTask,
  createConfigTask,
  getTask,
  mockAcl,
  mockAclMode,
  setMockAclMode,
  mockDeviceAcl,
  mockDevices,
  mockDhcp,
  mockDns,
  mockFirewall,
  mockLan,
  mockLogs,
  mockPortForwards,
  mockTime,
  mockWan,
  mockWifi,
  mockWirelessClients,
  updateAdminPassword,
  verifyAdminPassword,
} from './mock-state'

function delay<T>(data: T, ms = 220): Promise<ApiResponse<T>> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(success(data)), ms)
  })
}

function applyTask(rollbackSec: number, prefix: string): ConfigApplyResult {
  const taskId = `${prefix}-${Date.now()}`
  createConfigTask(taskId, rollbackSec)
  return { accepted: true, rollbackSec, taskId }
}

let sessionToken: string | null = null

/** 仅用于界面开发的伪密钥，不是有效的 Curve25519 密钥 */
function mockWgKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
}

function wgSecret(value: string, previous: string): string {
  if (value === WG_SECRET_MASK) return previous
  if (value === 'generate') return mockWgKey()
  return value
}

const mockWgClient: WireGuardClientConfig = {
  enabled: false,
  privateKey: '',
  publicKey: '',
  addresses: [],
  dns: [],
  useDns: false,
  mtu: 1420,
  routeMode: 'split',
  allowGlobalRoute: false,
  peer: { publicKey: '', presharedKey: '', endpointHost: '', endpointPort: 51820, allowedIPs: [], keepalive: 25 },
}
const mockDetect: DiagnosticPoll & { type: DiagnosticType | '' } = {
  type: '',
  flag: 0,
  running: false,
  output: '',
  servers: [],
}

export class MockRouterAdapter implements RouterAPI {
  async getPreLoginConfig(): Promise<ApiResponse<PreLoginConfig>> {
    return delay({ firstBoot: 0, needAuthorized: 1, companyName: 'MP716' })
  }

  async login(params: LoginParams): Promise<ApiResponse<LoginResult>> {
    const userOk = params.username === 'admin' || params.username === 'root'
    if (userOk && verifyAdminPassword(params.password)) {
      sessionToken = `mock-${Date.now()}`
      return delay({ token: sessionToken, expiresIn: 3600 })
    }
    return failure('UNAUTHORIZED', '用户名或密码错误')
  }

  async logout(): Promise<ApiResponse<null>> {
    sessionToken = null
    return delay(null)
  }

  async getQuickSetting(): Promise<ApiResponse<QuickSettingState>> {
    return delay({
      firstBoot: 1,
      speed: 1000,
      wan: {
        wanType: 'wired',
        proto: 'dhcp',
        hostName: 'MP716',
        dns: ['223.5.5.5'],
      },
      wifi: { ssid2g: 'MP716-WiFi', encry2g: 1, passphrase2g: '12345678' },
    })
  }

  async applyQuickSetting(
    wan: QuickSettingWan,
    wifi: QuickSettingWifi,
  ): Promise<ApiResponse<QuickSettingApplyResult>> {
    void wan
    void wifi
    return delay({ progressSec: 0, reconnect: false, reconnectIp: '' })
  }

  async completeWizardFirstBoot(): Promise<ApiResponse<null>> {
    return delay(null)
  }

  async ping(): Promise<ApiResponse<{ latencyMs: number }>> {
    return delay({ latencyMs: 12 })
  }

  async getSystemInfo(): Promise<ApiResponse<SystemInfo>> {
    const localTime = formatDateTime(new Date())
    return delay({
      model: 'MP716',
      hostname: 'mp716-gw',
      firmware: 'rel.20241113.014',
      kernel: '6.6.x',
      domain: 'step.YunXM.net',
      deviceNumber: '001CA3364353',
      uptimeSec: 2572,
      localTime,
      cpuLoad: [0.12, 0.08, 0.05],
      memTotalKb: 65536,
      memFreeKb: 42112,
      flashTotalKb: 8192,
      flashFreeKb: 680,
    })
  }

  async getDeviceInfo(): Promise<ApiResponse<DeviceInfo>> {
    return delay({
      productName: 'MP716',
      productModel: 'MP716',
      softwareVersion: '014',
      webuiVersion: 'WEB014',
      lanMac: '00:11:22:33:44:02',
      wanIp: '10.20.30.45',
    })
  }

  async getSystemStatus(): Promise<ApiResponse<SystemStatus>> {
    return delay({
      cpuPercent: 18,
      memoryPercent: 36,
      uptimeSec: 2572,
      wirelessClients: mockWirelessClients.length,
      wiredClients: mockDevices.filter((d) => d.wired).length,
      interfaces: [
        {
          name: 'wan',
          label: 'WAN',
          up: true,
          proto: mockWan.proto,
          ipv4: '10.20.30.45',
          rxBytes: 1_024_000_000,
          txBytes: 512_000_000,
          mac: '00:11:22:33:44:01',
        },
        {
          name: 'lan',
          label: 'LAN',
          up: true,
          proto: 'static',
          ipv4: mockLan.ipv4,
          rxBytes: 900_000_000,
          txBytes: 1_200_000_000,
          mac: '00:11:22:33:44:02',
        },
      ],
    })
  }

  async getWanStatus(): Promise<ApiResponse<WanStatus>> {
    return delay({
      name: 'wan',
      label: 'WAN',
      up: true,
      proto: 'Wired',
      ipv4: '10.251.0.135',
      netmask: '255.255.255.0',
      gateway: '10.251.0.1',
      dns: mockWan.dns,
      connected: true,
      mtu: 1500,
      rxBytes: 1_024_000_000,
      txBytes: 512_000_000,
      rxRateBps: 335.7 * 1024,
      txRateBps: 108.4 * 1024,
      mac: '00:1C:A3:36:43:56',
    })
  }

  async getWanConfig(): Promise<ApiResponse<WanConfig>> {
    return delay({ ...mockWan, password: mockWan.password ? '********' : undefined })
  }

  async updateWanConfig(config: WanConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.proto === 'static' && !config.ipv4) {
      return failure('VALIDATION', '静态 IP 模式下必须填写 IP 地址')
    }
    Object.assign(mockWan, config)
    return delay(applyTask(90, 'wan'))
  }

  async getLanStatus(): Promise<ApiResponse<LanStatus>> {
    return delay({
      name: 'lan',
      label: 'LAN',
      up: true,
      proto: 'static',
      ipv4: mockLan.ipv4,
      dhcpEnabled: mockDhcp.enabled,
      rxBytes: 900_000_000,
      txBytes: 1_200_000_000,
      mac: '00:11:22:33:44:02',
    })
  }

  async getLanConfig(): Promise<ApiResponse<LanConfig>> {
    return delay({ ...mockLan })
  }

  async updateLanConfig(config: LanConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(config.ipv4)) {
      return failure('VALIDATION', 'LAN IP 格式不正确')
    }
    Object.assign(mockLan, config)
    mockDhcp.gateway = config.ipv4
    return delay(applyTask(60, 'lan'))
  }

  async getDhcpConfig(): Promise<ApiResponse<DhcpConfig>> {
    return delay(structuredClone(mockDhcp))
  }

  async updateDhcpConfig(config: DhcpConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.start < 1 || config.limit < 1) {
      return failure('VALIDATION', '地址池参数无效')
    }
    Object.assign(mockDhcp, config)
    return delay(applyTask(30, 'dhcp'))
  }

  async updateDhcpStaticBindings(
    bindings: StaticDhcpBinding[],
  ): Promise<ApiResponse<ConfigApplyResult>> {
    mockDhcp.staticBindings = structuredClone(bindings)
    return delay(applyTask(30, 'dhcp-static'))
  }

  async getDnsConfig(): Promise<ApiResponse<DnsConfig>> {
    return delay({ ...mockDns })
  }

  async updateDnsConfig(config: DnsConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.mode === 'manual' && !config.servers.length) {
      return failure('VALIDATION', '手动模式下至少填写一个 DNS')
    }
    Object.assign(mockDns, config)
    return delay(applyTask(30, 'dns'))
  }

  async getWifiStatus(): Promise<ApiResponse<WifiStatus>> {
    return delay({
      iface: 'ra0',
      band: '2.4GHz',
      enabled: mockWifi.enabled,
      ssid: mockWifi.ssid,
      channel: 6,
      txPower: mockWifi.txPower,
      clients: mockWirelessClients.length,
      security: 'WPAWPA2PSK',
      mode: '11BGN',
      mac: '00:1C:A3:36:43:53',
    })
  }

  async getPhysicalPorts(): Promise<ApiResponse<PhysicalPortStatus[]>> {
    return delay([
      { id: 'lan1', label: 'LAN1', role: 'lan', linkUp: true, speedMbps: 1000 },
      { id: 'lan2', label: 'LAN2', role: 'lan', linkUp: false, speedMbps: 0 },
      { id: 'lan3', label: 'LAN3', role: 'lan', linkUp: false, speedMbps: 0 },
      { id: 'lan4', label: 'LAN4', role: 'lan', linkUp: true, speedMbps: 100 },
      { id: 'wan', label: 'WAN', role: 'wan', linkUp: true, speedMbps: 100 },
    ])
  }

  async getWifiConfig(): Promise<ApiResponse<WifiConfig>> {
    return delay({ ...mockWifi, password: '********' })
  }

  async updateWifiConfig(config: WifiConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (!config.ssid?.trim()) return failure('VALIDATION', 'SSID 不能为空')
    if (config.security !== 'none' && (!config.password || config.password.length < 8)) {
      return failure('VALIDATION', '密码长度至少 8 位')
    }
    if (config.password && config.password !== '********') {
      mockWifi.password = config.password
    }
    Object.assign(mockWifi, { ...config, password: mockWifi.password })
    return delay(applyTask(45, 'wifi'))
  }

  async getWifiSecondaryConfig(): Promise<ApiResponse<WifiSecondaryConfig>> {
    return delay({
      supported: true,
      enabled: false,
      ssid: 'MP716-Guest',
      password: '********',
      hidden: false,
      isolate: true,
    })
  }

  async updateWifiSecondaryConfig(config: WifiSecondaryConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.enabled && !config.ssid?.trim()) return failure('VALIDATION', '副 SSID 不能为空')
    if (config.enabled && config.password && config.password !== '********' && config.password.length < 8) {
      return failure('VALIDATION', '密码长度至少 8 位')
    }
    return delay(applyTask(45, 'wifi-secondary'))
  }

  async getWifiAdvanced(): Promise<ApiResponse<WifiAdvancedConfig>> {
    return delay({
      radioOn: true,
      bgprotectMode: 0,
      beacon: 100,
      dtim: 1,
      rtsThreshold: 2347,
      fragThreshold: 2346,
      txBurst: 1,
      txPreamble: 1,
      wmm: 1,
    })
  }

  async updateWifiAdvanced(config: WifiAdvancedConfig): Promise<ApiResponse<ConfigApplyResult>> {
    void config
    return delay(applyTask(20, 'wifi-adv'))
  }

  async getPptpClient(): Promise<ApiResponse<PptpClientConfig>> {
    return delay({
      enabled: false,
      status: 0,
      address: '0.0.0.0',
      server: '',
      username: '',
      password: '',
      mppe: 0,
      routeType: 0,
      routes: [],
    })
  }

  async updatePptpClient(config: PptpClientConfig): Promise<ApiResponse<ConfigApplyResult>> {
    void config
    return delay(applyTask(20, 'pptp'))
  }

  async getPptpServer(): Promise<ApiResponse<VpnServerConfig>> {
    return delay({
      enabled: false,
      startIp: '172.1.1.10',
      endIp: '172.1.1.20',
      server: '192.168.7.1',
      mppe: 0,
      dnsEnabled: false,
      primaryDns: '',
      secondaryDns: '',
      mtu: 1482,
      mru: 1482,
    })
  }

  async updatePptpServer(config: VpnServerConfig): Promise<ApiResponse<ConfigApplyResult>> {
    void config
    return delay(applyTask(20, 'pptp-server'))
  }

  async getL2tpServer(): Promise<ApiResponse<VpnServerConfig>> {
    return delay({
      enabled: false,
      startIp: '172.1.1.30',
      endIp: '172.1.1.40',
      server: '192.168.7.1',
      ipsecEnabled: false,
      ipsecKey: '',
      dnsEnabled: false,
      primaryDns: '',
      secondaryDns: '',
      mtu: 1400,
      mru: 1400,
    })
  }

  async updateL2tpServer(config: VpnServerConfig): Promise<ApiResponse<ConfigApplyResult>> {
    void config
    return delay(applyTask(20, 'l2tp-server'))
  }

  async getVpnUsers(): Promise<ApiResponse<VpnUserConfig>> {
    return delay({
      users: [],
      types: ['all', 'pptp', 'l2tp'],
      pptpStart: '172.1.1.10',
      pptpEnd: '172.1.1.20',
      l2tpStart: '172.1.1.30',
      l2tpEnd: '172.1.1.40',
    })
  }

  async updateVpnUsers(config: VpnUserConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.users.length > 32) return failure('VALIDATION', '最多 32 个用户')
    return delay(applyTask(20, 'vpn-users'))
  }

  async getL2tpClient(): Promise<ApiResponse<L2tpClientConfig>> {
    return delay({
      enabled: false,
      status: 0,
      address: '',
      server: '',
      username: '',
      password: '',
      ipsecKey: '',
      serverEnabled: false,
    })
  }

  async updateL2tpClient(config: L2tpClientConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.enabled && config.serverEnabled) return failure('VALIDATION', 'L2TP 当前工作在服务器模式，客户端暂不可用')
    return delay(applyTask(20, 'l2tp-client'))
  }

  async getVpnStatus(): Promise<ApiResponse<VpnOnlineUser[]>> {
    return delay([])
  }

  async disconnectVpnUser(pid: string): Promise<ApiResponse<null>> {
    if (!pid.trim()) return failure('VALIDATION', '缺少用户进程号')
    return delay(null)
  }

  async getOpenVpn(): Promise<ApiResponse<OpenVpnConfig>> {
    return delay({
      enabled: false,
      status: 2,
      mode: 0,
      host: '',
      username: '',
      password: '',
      port: 0,
      configUploaded: false,
    })
  }

  async updateOpenVpn(config: OpenVpnConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.enabled && config.mode === 1 && !config.configUploaded) return failure('VALIDATION', '请先上传配置文件')
    return delay(applyTask(20, 'openvpn'))
  }

  async uploadOpenVpn(file: File, _kind: 'config' | 'cert' = 'config'): Promise<ApiResponse<ConfigApplyResult>> {
    void _kind
    if (file.size > 1024 * 1024) return failure('VALIDATION', '文件不能大于1M!')
    return delay(applyTask(0, 'openvpn-file'))
  }

  async getWireGuardClient(): Promise<ApiResponse<WireGuardClientConfig>> {
    const c = structuredClone(mockWgClient)
    return delay({
      ...c,
      hasPrivateKey: !!c.privateKey,
      privateKey: c.privateKey ? WG_SECRET_MASK : '',
      peer: { ...c.peer, presharedKey: c.peer.presharedKey ? WG_SECRET_MASK : '' },
      reservedNets: [{ label: 'lan', cidr: '192.168.199.0/24' }],
      serviceAvailable: true,
    })
  }

  async updateWireGuardClient(config: WireGuardClientConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.routeMode === 'global' && config.enabled && !config.allowGlobalRoute)
      return failure('VALIDATION', '全局模式会让 LAN 上网流量经隧道转发，请先勾选“允许全局路由”')
    if (config.enabled && (!config.addresses.length || !config.peer.publicKey || !config.peer.endpointHost))
      return failure('VALIDATION', '请填写隧道地址、对端公钥与 Endpoint')
    const { privateKey: prevPrivate, publicKey: prevPublic } = mockWgClient
    const prevPsk = mockWgClient.peer.presharedKey
    const privateKey = wgSecret(config.privateKey, prevPrivate)
    if (config.enabled && !privateKey) return failure('VALIDATION', '请先生成或填写本机私钥')
    Object.assign(mockWgClient, structuredClone({ ...config, privateKey, reservedNets: undefined, serviceAvailable: undefined, serviceMessage: undefined }))
    mockWgClient.publicKey = !privateKey ? '' : privateKey === prevPrivate && prevPublic ? prevPublic : mockWgKey()
    mockWgClient.peer.presharedKey = wgSecret(config.peer.presharedKey, prevPsk)
    return delay(applyTask(30, 'wg-client'))
  }

  async importWireGuardClient(text: string): Promise<ApiResponse<WireGuardImportResult>> {
    if (!/\[Interface\]/i.test(text) || !/\[Peer\]/i.test(text)) return failure('VALIDATION', '无法识别的 WireGuard 配置')
    if (/^\s*(Pre|Post)(Up|Down)\s*=/im.test(text)) return failure('VALIDATION', '出于安全原因，不支持 PostUp 等脚本指令')
    const pick = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'im').exec(text)?.[1]?.trim() ?? ''
    const list = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean)
    const allowed = list(pick('AllowedIPs'))
    const global = allowed.includes('0.0.0.0/0') || allowed.includes('::/0')
    const [host, port] = pick('Endpoint').split(':')
    Object.assign(mockWgClient, {
      enabled: false,
      privateKey: pick('PrivateKey'),
      publicKey: mockWgKey(),
      addresses: list(pick('Address')),
      dns: list(pick('DNS')),
      useDns: global && list(pick('DNS')).length > 0,
      routeMode: global ? 'global' : 'split',
      allowGlobalRoute: false,
      peer: {
        ...mockWgClient.peer,
        publicKey: pick('PublicKey'),
        presharedKey: pick('PresharedKey'),
        endpointHost: host ?? '',
        endpointPort: Number(port) || 51820,
        allowedIPs: allowed.filter((a) => a !== '0.0.0.0/0' && a !== '::/0'),
      },
    })
    return delay({ ...applyTask(30, 'wg-import'), warnings: global ? ['配置包含 0.0.0.0/0，已设为全局模式；启用前须确认允许全局路由'] : [] })
  }

  async getWireGuardStatus(): Promise<ApiResponse<WireGuardStatus>> {
    const enabled = mockWgClient.enabled
    return delay({
      available: true,
      missing: [],
      client: {
        enabled,
        up: false,
        error: false,
        address: '',
        ifaceState: enabled ? 'down' : 'disabled',
        handshakeState: 'none',
        endpoint: '',
        latestHandshake: 0,
        handshakeAgeSec: -1,
        rxBytes: 0,
        txBytes: 0,
        errors: [],
        probe: { state: 'skipped', target: '', reason: enabled ? 'iface-down' : 'disabled', ageSec: -1 },
      },
    })
  }

  async getWirelessClients(): Promise<ApiResponse<WirelessClient[]>> {
    return delay(structuredClone(mockWirelessClients))
  }

  async getConnectedDevices(): Promise<ApiResponse<ConnectedDevice[]>> {
    return delay(structuredClone(mockDevices))
  }

  async getDeviceAclList(): Promise<ApiResponse<DeviceAclEntry[]>> {
    return delay(mockDeviceAcl.map((mac) => ({ mac })))
  }

  async addDeviceAcl(mac: string): Promise<ApiResponse<null>> {
    const addr = mac.trim()
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(addr)) {
      return failure('VALIDATION', `MAC 格式无效: ${addr}`)
    }
    const key = addr.toLowerCase()
    if (!mockDeviceAcl.some((m) => m.toLowerCase() === key)) mockDeviceAcl.push(addr)
    return delay(null)
  }

  async removeDeviceAcl(mac: string): Promise<ApiResponse<null>> {
    const key = mac.trim().toLowerCase()
    const idx = mockDeviceAcl.findIndex((m) => m.toLowerCase() === key)
    if (idx >= 0) mockDeviceAcl.splice(idx, 1)
    return delay(null)
  }

  async getWirelessAcl(): Promise<ApiResponse<WirelessAclConfig>> {
    return delay({
      mode: mockAclMode,
      entries: structuredClone(mockAcl),
    })
  }

  async updateWirelessAcl(config: WirelessAclConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.entries.length > 10) return failure('VALIDATION', '最多 10 条 ACL 规则')
    for (const e of config.entries) {
      if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(e.mac)) {
        return failure('VALIDATION', `MAC 格式无效: ${e.mac}`)
      }
    }
    setMockAclMode(config.mode)
    const policy: 'allow' | 'deny' = config.mode === 'allow' ? 'allow' : 'deny'
    mockAcl.splice(
      0,
      mockAcl.length,
      ...config.entries.map((e) => ({ ...e, mac: e.mac.toUpperCase(), policy })),
    )
    return delay(applyTask(30, 'wacl'))
  }

  async getFirewallRules(): Promise<ApiResponse<FirewallRule[]>> {
    return delay(structuredClone(mockFirewall))
  }

  async updateFirewallRules(rules: FirewallRule[]): Promise<ApiResponse<ConfigApplyResult>> {
    mockFirewall.splice(0, mockFirewall.length, ...rules)
    return delay(applyTask(30, 'fw'))
  }

  async getPortForwards(): Promise<ApiResponse<PortForwardRule[]>> {
    return delay(structuredClone(mockPortForwards))
  }

  async updatePortForwards(rules: PortForwardRule[]): Promise<ApiResponse<ConfigApplyResult>> {
    mockPortForwards.splice(0, mockPortForwards.length, ...rules)
    return delay(applyTask(30, 'pf'))
  }

  async getDmzConfig(): Promise<ApiResponse<import('../types').DmzConfig>> {
    return delay({ enabled: false, hostIp: '192.168.1.100' })
  }

  async updateDmzConfig(config: import('../types').DmzConfig): Promise<ApiResponse<ConfigApplyResult>> {
    void config
    return delay(applyTask(30, 'dmz'))
  }

  async getUpnpConfig(): Promise<ApiResponse<import('../types').UpnpConfig>> {
    return delay({ supported: true, enabled: false })
  }

  async updateUpnpConfig(config: import('../types').UpnpConfig): Promise<ApiResponse<ConfigApplyResult>> {
    void config
    return delay(applyTask(30, 'upnp'))
  }

  async getDdnsConfig(): Promise<ApiResponse<import('../types').DdnsConfig>> {
    return delay({
      supported: true,
      enabled: false,
      provider: 'duckdns.org',
      domain: '',
      username: '',
      hostname: '',
    })
  }

  async updateDdnsConfig(config: import('../types').DdnsConfig): Promise<ApiResponse<ConfigApplyResult>> {
    void config
    return delay(applyTask(30, 'ddns'))
  }

  async getSystemCapabilities(): Promise<ApiResponse<import('../types').NativeCapabilities>> {
    return delay({
      apiContract: 'mp716-native/v1',
      routes: [],
      firmwareUpgrade: true,
      firmwareFlashEnabled: false,
      wanModes: ['wired'],
      wifiModes: ['11g', '11n'],
      services: { ntp: true, pptpd: true, l2tp: true, openvpn: true },
      bundle: {
        staticRoutes: true,
        firewall: true,
        portForward: true,
        dmz: true,
        upnp: true,
        ddns: true,
        qos: true,
        dnsPage: true,
      },
      hardware: { physicalLanOrderVerified: true, cellularModemVerified: false },
    })
  }

  async getStaticRoutes(): Promise<ApiResponse<import('../types').NetworkStaticRoute[]>> {
    return delay([
      {
        id: 'mp716_rt_0',
        enabled: true,
        interface: 'wan',
        target: '10.8.0.0',
        netmask: '255.255.255.0',
        gateway: '192.168.1.1',
        metric: 0,
      },
    ])
  }

  async updateStaticRoutes(
    routes: import('../types').NetworkStaticRoute[],
  ): Promise<ApiResponse<ConfigApplyResult>> {
    void routes
    return delay(applyTask(60, 'network'))
  }

  async getQosCapability(): Promise<ApiResponse<import('../types').QosCapability>> {
    return delay({ supported: true, backend: 'sqm' })
  }

  async getQosConfig(): Promise<ApiResponse<import('../types').QosConfig>> {
    return delay({ enabled: false, downloadKbps: 51200, uploadKbps: 10240 })
  }

  async updateQosConfig(config: import('../types').QosConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.enabled && (config.downloadKbps < 1 || config.uploadKbps < 1)) {
      return failure('VALIDATION', '启用 QoS 时需设置正数限速值')
    }
    return delay(applyTask(30, 'qos'))
  }

  async startDiagnostic(req: DiagnosticRequest): Promise<ApiResponse<null>> {
    if (req.type === 'ping') {
      const message =
        validateHost(req.target, tGlobal) ||
        validateSource(req.source ?? '', tGlobal) ||
        validateRange(
          req.count == null ? '' : String(req.count),
          1,
          100,
          tGlobal('validation.detect.pingCountRequired'),
          tGlobal('validation.detect.pingCountRange'),
        )
      if (message) return failure('VALIDATION', message)
    } else if (req.type === 'traceroute') {
      const message =
        validateHost(req.target, tGlobal) ||
        validateRange(
          req.maxHops == null ? '' : String(req.maxHops),
          1,
          20,
          tGlobal('validation.detect.hopsRequired'),
          tGlobal('validation.detect.hopsRange'),
        ) ||
        validateRange(
          req.timeoutSec == null ? '' : String(req.timeoutSec),
          1,
          10,
          tGlobal('validation.detect.timeoutRequired'),
          tGlobal('validation.detect.timeoutRange'),
        )
      if (message) return failure('VALIDATION', message)
    } else if (req.type !== 'dhcp') {
      return failure('VALIDATION', '不支持的诊断类型')
    }
    mockDetect.type = req.type
    mockDetect.flag = 1
    mockDetect.running = true
    mockDetect.output = ''
    mockDetect.servers = []
    return delay(null)
  }

  async pollDiagnostic(type: DiagnosticType): Promise<ApiResponse<DiagnosticPoll>> {
    if (type === 'dns') return failure('VALIDATION', '不支持的诊断类型')
    if (!mockDetect.running || mockDetect.type !== type) {
      return delay({
        flag: mockDetect.flag,
        running: false,
        output: mockDetect.output,
        servers: mockDetect.servers.map((item) => ({ ...item })),
      })
    }
    if (type === 'dhcp') {
      mockDetect.running = false
      mockDetect.flag = 2
      mockDetect.servers = [{ ip: '192.168.1.1', mac: 'AA:BB:CC:DD:EE:FF' }]
      return delay({ flag: 2, running: false, output: '', servers: mockDetect.servers.map((item) => ({ ...item })) })
    }
    const line = type === 'ping' ? '64 bytes from target: icmp_seq=1 ttl=54 time=12.1 ms' : ' 1  192.168.1.1  1.204 ms'
    mockDetect.output = mockDetect.output ? `${mockDetect.output}\n${line}` : line
    mockDetect.running = false
    mockDetect.flag = 2
    return delay({ flag: 2, running: false, output: mockDetect.output, servers: [] })
  }

  async stopDiagnostic(type: DiagnosticType): Promise<ApiResponse<null>> {
    if (type === 'dns') return failure('VALIDATION', '不支持的诊断类型')
    if (mockDetect.type === type) mockDetect.running = false
    return delay(null)
  }

  async runDiagnostic(req: DiagnosticRequest): Promise<ApiResponse<DiagnosticResult>> {
    if (req.type !== 'dhcp' && !req.target.trim()) return failure('VALIDATION', '请填写诊断目标')
    const output =
      req.type === 'ping'
        ? `PING ${req.target}: 56 data bytes\n64 bytes from ${req.target}: icmp_seq=1 ttl=54 time=18.2 ms\n--- ping statistics ---\n1 packets transmitted, 1 received, 0% packet loss`
        : req.type === 'traceroute'
          ? `traceroute to ${req.target}\n 1  192.168.1.1  1.123 ms\n 2  10.20.30.1  8.442 ms\n 3  ${req.target}  19.881 ms`
          : req.type === 'dhcp'
            ? '192.168.1.1'
            : `Server: 192.168.1.1\nAddress: 192.168.1.1#53\n\nName: ${req.target}\nAddress: 223.5.5.5`
    return delay({ success: true, output, durationMs: 420 })
  }

  async changeAdminPassword(params: AdminPasswordChange): Promise<ApiResponse<null>> {
    if (!updateAdminPassword(params)) {
      return failure('VALIDATION', '原密码错误或新密码不符合要求（至少 8 位）')
    }
    return delay(null)
  }

  async getSystemTime(): Promise<ApiResponse<SystemTimeConfig>> {
    mockTime.localTime = formatDateTime(new Date())
    return delay({ ...mockTime })
  }

  async updateSystemTime(config: SystemTimeConfig): Promise<ApiResponse<ConfigApplyResult>> {
    Object.assign(mockTime, config)
    return delay(applyTask(20, 'time'))
  }

  async useBrowserTime(localTime: string): Promise<ApiResponse<null>> {
    mockTime.localTime = localTime
    return delay(null)
  }

  async getScheReboot(): Promise<ApiResponse<ScheRebootConfig>> {
    return delay({
      mode: 0,
      remainHour: 0,
      remainMinute: 30,
      hour: 0,
      minute: 0,
      weeks: 0,
      timeDay: 0,
      remainingSec: 0,
    })
  }

  async updateScheReboot(config: ScheRebootConfig): Promise<ApiResponse<ConfigApplyResult>> {
    void config
    return delay(applyTask(20, 'sche-reboot'))
  }

  async getFirmwareInfo(): Promise<ApiResponse<FirmwareInfo>> {
    return delay({
      currentVersion: 'OpenWrt 25.12.6-mp716-dev',
      buildDate: '2026-03-01',
      hardware: 'MP716 / MT7628',
      canUpgrade: true,
    })
  }

  async getFirmwareV2Info(): Promise<ApiResponse<import('../types').FirmwareV2EngineInfo>> {
    return success({ engine: 'v2', model: 'MP716', flashReal: false, dryRunOnly: true })
  }
  async uploadFirmwareV2(): Promise<ApiResponse<import('../types').FirmwareV2UploadResult>> {
    return success({ validated: true, flashWrite: false, dryRunOnly: true })
  }
  async getFirmwareV2Status(): Promise<ApiResponse<import('../types').FirmwareV2Status>> {
    return success({ state: 'IDLE', ts: Math.floor(Date.now() / 1000) })
  }
  async applyFirmwareV2(): Promise<ApiResponse<ConfigApplyResult>> {
    return success({ accepted: false, rollbackSec: 0, taskId: 'dry-run' })
  }
  async uploadFirmware(file: Blob): Promise<ApiResponse<ConfigApplyResult>> {
    if (file.size > 8 * 1024 * 1024) {
      return failure('VALIDATION', '固件文件超过 Flash 容量限制')
    }
    return delay({
      accepted: true,
      rollbackSec: 0,
      taskId: 'fw-upload',
      validated: true,
      flashWrite: false,
      message: '固件校验通过；Flash 刷写未启用（默认安全策略）',
    })
  }

  async getSystemLogs(limit = 200): Promise<ApiResponse<SystemLogState>> {
    const content = mockLogs
      .slice(0, limit)
      .map((entry) => `${entry.time} ${entry.level} ${entry.message}`)
      .join('\n')
    return delay({ enabled: true, content })
  }

  async updateSyslog(enabled: boolean): Promise<ApiResponse<ConfigApplyResult>> {
    void enabled
    return delay({ accepted: true, rollbackSec: 0 })
  }

  async clearSyslog(): Promise<ApiResponse<null>> {
    return delay(null)
  }

  async backupConfig(): Promise<ApiResponse<BackupResult>> {
    return delay({
      filename: `mp716-backup-${Date.now()}.json`,
      size: 2048,
      checksum: 'mock-sha256:deadbeef',
    })
  }

  async downloadBackup(): Promise<ApiResponse<BackupDownload>> {
    const snapshot = {
      wan: mockWan,
      lan: mockLan,
      dhcp: mockDhcp,
      dns: mockDns,
      wifi: mockWifi,
    }
    const text = JSON.stringify(snapshot, null, 2)
    const contentBase64 = btoa(unescape(encodeURIComponent(text)))
    return delay({
      filename: `mp716-backup-${Date.now()}.json`,
      mime: 'application/json',
      contentBase64,
    })
  }

  async restoreConfig(file: Blob): Promise<ApiResponse<ConfigApplyResult>> {
    const text = await file.text()
    try {
      JSON.parse(text)
    } catch {
      return failure('VALIDATION', '配置文件格式无效')
    }
    return delay(applyTask(120, 'restore'))
  }

  async getActiveConfigTask(): Promise<ApiResponse<ConfigTaskStatus | null>> {
    return success(null)
  }
  async getConfigTaskStatus(taskId: string): Promise<ApiResponse<ConfigTaskStatus>> {
    const task = getTask(taskId)
    if (!task) return failure('VALIDATION', '任务不存在')
    return delay(task)
  }

  async confirmConfigTask(taskId: string): Promise<ApiResponse<ConfigTaskStatus>> {
    const task = confirmTask(taskId)
    if (!task) return failure('VALIDATION', '任务不存在')
    if (task.state === 'rolled_back') {
      return failure('ROLLBACK', '任务已超时回滚，无法确认')
    }
    return delay(task)
  }

  async disconnectDevice(deviceId: string): Promise<ApiResponse<null>> {
    const idx = mockDevices.findIndex((d) => d.id === deviceId)
    if (idx < 0) return failure('VALIDATION', '终端不存在')
    mockDevices[idx].online = false
    return delay(null)
  }

  async rebootDevice(): Promise<ApiResponse<ConfigApplyResult>> {
    return delay({ accepted: true, rollbackSec: 0 })
  }

  async factoryReset(params: {
    confirmToken: string
  }): Promise<ApiResponse<ConfigApplyResult>> {
    if (params.confirmToken !== 'FACTORY_RESET') {
      return failure('FORBIDDEN', '确认口令不正确')
    }
    return delay({ accepted: true, rollbackSec: 0 })
  }
}
