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
  FirmwareV2EngineInfo,
  FirmwareV2Status,
  FirmwareV2UploadResult,
  LoginParams,
  LoginResult,
  PreLoginConfig,
  QuickSettingApplyResult,
  QuickSettingState,
  QuickSettingWan,
  QuickSettingWifi,
  PortForwardRule,
  QosCapability,
  QosConfig,
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
  WifiAdvancedConfig,
  WifiConfig,
  WifiStatus,
  WirelessAclConfig,
  WirelessClient,
  HomeDashboard,
} from '../types'
import { requestJson, failure } from '../http'
import { readVerificationReport } from '../firmware-verification'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/cgi-bin/mp716'
const DEVICE_GET_CACHE_MS = 4_000
const DEVICE_GET_CACHE_MS_BY_SEGMENT: Record<string, number> = {
  'home/dashboard': 12_000,
}

type TokenProvider = () => string | null

const deviceGetCache = new Map<string, { at: number; res: ApiResponse<unknown> }>()
const deviceGetInflight = new Map<string, Promise<ApiResponse<unknown>>>()

export class DeviceRouterAdapter implements RouterAPI {
  private getToken: TokenProvider

  constructor(getToken: TokenProvider) {
    this.getToken = getToken
  }

  private path(segment: string): string {
    return `${API_BASE.replace(/\/$/, '')}/${segment.replace(/^\//, '')}`
  }

  private async call<T>(
    segment: string,
    body?: unknown,
    method: 'GET' | 'POST' = body ? 'POST' : 'GET',
  ): Promise<ApiResponse<T>> {
    if (method === 'POST') {
      deviceGetCache.clear()
      deviceGetInflight.clear()
    }
    if (method === 'GET') {
      const now = Date.now()
      const cacheMs = DEVICE_GET_CACHE_MS_BY_SEGMENT[segment] ?? DEVICE_GET_CACHE_MS
      const cached = deviceGetCache.get(segment)
      if (cached && now - cached.at < cacheMs) {
        return cached.res as ApiResponse<T>
      }
      let inflight = deviceGetInflight.get(segment)
      if (!inflight) {
        inflight = requestJson<T>(this.path(segment), {
          method: 'GET',
          token: this.getToken(),
        }).then((res) => {
          deviceGetCache.set(segment, { at: Date.now(), res: res as ApiResponse<unknown> })
          deviceGetInflight.delete(segment)
          return res as ApiResponse<unknown>
        })
        deviceGetInflight.set(segment, inflight)
      }
      return inflight as Promise<ApiResponse<T>>
    }
    return requestJson<T>(this.path(segment), {
      method,
      body,
      token: this.getToken(),
    })
  }

  /** 首页聚合：设备端只扫一次终端列表与物理口 */
  getHomeDashboard() {
    return this.call<HomeDashboard>('home/dashboard')
  }

  getPreLoginConfig() {
    return this.call<PreLoginConfig>('auth/prelogin')
  }
  login(params: LoginParams) {
    return this.call<LoginResult>('auth/login', params)
  }
  logout() {
    return this.call<null>('auth/logout', {})
  }
  getQuickSetting() {
    return this.call<QuickSettingState>('wizard/quick')
  }
  applyQuickSetting(wan: QuickSettingWan, wifi: QuickSettingWifi) {
    return this.call<QuickSettingApplyResult>('wizard/quick', { wan, wifi })
  }
  completeWizardFirstBoot() {
    return this.call<null>('wizard/complete', {})
  }
  ping() {
    return this.call<{ latencyMs: number }>('system/ping')
  }
  getSystemInfo() {
    return this.call<SystemInfo>('system/info')
  }
  getDeviceInfo() {
    return this.call<DeviceInfo>('system/device')
  }
  getSystemStatus() {
    return this.call<SystemStatus>('system/status')
  }
  getWanStatus() {
    return this.call<WanStatus>('network/wan/status')
  }
  getWanConfig() {
    return this.call<WanConfig>('network/wan/config')
  }
  updateWanConfig(config: WanConfig, options?: { confirmTimeoutSec?: number }) {
    return this.call<ConfigApplyResult>('network/wan/config', {
      config,
      confirmTimeoutSec: options?.confirmTimeoutSec ?? 90,
    })
  }
  getLanStatus() {
    return this.call<LanStatus>('network/lan/status')
  }
  getLanConfig() {
    return this.call<LanConfig>('network/lan/config')
  }
  updateLanConfig(config: LanConfig, options?: { confirmTimeoutSec?: number }) {
    return this.call<ConfigApplyResult>('network/lan/config', {
      config,
      confirmTimeoutSec: options?.confirmTimeoutSec ?? 60,
    })
  }
  getDhcpConfig() {
    return this.call<DhcpConfig>('network/dhcp/config')
  }
  updateDhcpConfig(config: DhcpConfig) {
    return this.call<ConfigApplyResult>('network/dhcp/config', { config })
  }
  updateDhcpStaticBindings(bindings: StaticDhcpBinding[]) {
    return this.call<ConfigApplyResult>('network/dhcp/static', { bindings })
  }
  getDnsConfig() {
    return this.call<DnsConfig>('network/dns/config')
  }
  updateDnsConfig(config: DnsConfig) {
    return this.call<ConfigApplyResult>('network/dns/config', { config })
  }
  getWifiStatus() {
    return this.call<WifiStatus>('wireless/status')
  }
  getPhysicalPorts() {
    return this.call<import('../types').PhysicalPortStatus[]>('home/physical-ports')
  }
  getWifiConfig() {
    return this.call<WifiConfig>('wireless/config')
  }
  updateWifiConfig(config: WifiConfig) {
    return this.call<ConfigApplyResult>('wireless/config', { config })
  }
  getWifiAdvanced() {
    return this.call<WifiAdvancedConfig>('wireless/advanced')
  }
  updateWifiAdvanced(config: WifiAdvancedConfig) {
    return this.call<ConfigApplyResult>('wireless/advanced', { config })
  }
  getPptpClient() {
    return this.call<PptpClientConfig>('vpn/pptp')
  }
  updatePptpClient(config: PptpClientConfig) {
    return this.call<ConfigApplyResult>('vpn/pptp', { config })
  }
  getPptpServer() {
    return this.call<VpnServerConfig>('vpn/pptpd')
  }
  updatePptpServer(config: VpnServerConfig) {
    return this.call<ConfigApplyResult>('vpn/pptpd', { config })
  }
  getL2tpServer() {
    return this.call<VpnServerConfig>('vpn/xl2tpd')
  }
  updateL2tpServer(config: VpnServerConfig) {
    return this.call<ConfigApplyResult>('vpn/xl2tpd', { config })
  }
  getVpnUsers() {
    return this.call<VpnUserConfig>('vpn/users')
  }
  updateVpnUsers(config: VpnUserConfig) {
    return this.call<ConfigApplyResult>('vpn/users', { config })
  }
  getL2tpClient() {
    return this.call<L2tpClientConfig>('vpn/xl2tp')
  }
  updateL2tpClient(config: L2tpClientConfig) {
    return this.call<ConfigApplyResult>('vpn/xl2tp', { config })
  }
  getVpnStatus() {
    return this.call<VpnOnlineUser[]>('vpn/online')
  }
  disconnectVpnUser(pid: string) {
    return this.call<null>('vpn/online/disconnect', { pid })
  }
  getOpenVpn() {
    return this.call<OpenVpnConfig>('vpn/openvpn')
  }
  updateOpenVpn(config: OpenVpnConfig) {
    return this.call<ConfigApplyResult>('vpn/openvpn', { config })
  }
  async uploadOpenVpn(file: File, kind: 'config' | 'cert') {
    if (file.size > 256 * 1024) return failure('VALIDATION', 'OpenVPN 文件不能大于 256 KiB')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const raw = Array.from(bytes, n => String.fromCharCode(n)).join('')
    return this.call<ConfigApplyResult>('vpn/openvpn/upload', { filename: file.name, kind, contentBase64: btoa(raw) })
  }

  getWirelessClients() {
    return this.call<WirelessClient[]>('wireless/clients')
  }
  getWirelessAcl() {
    return this.call<WirelessAclConfig>('wireless/acl')
  }
  updateWirelessAcl(config: WirelessAclConfig) {
    return this.call<ConfigApplyResult>('wireless/acl', { config })
  }
  getConnectedDevices() {
    return this.call<ConnectedDevice[]>('hosts/connected')
  }
  getDeviceAclList() {
    return this.call<DeviceAclEntry[]>('hosts/device-acl')
  }
  addDeviceAcl(mac: string) {
    return this.call<null>('hosts/device-acl', { mac, action: 'add' })
  }
  removeDeviceAcl(mac: string) {
    return this.call<null>('hosts/device-acl', { mac, action: 'remove' })
  }
  disconnectDevice(deviceId: string) {
    return this.call<null>('hosts/disconnect', { deviceId })
  }
  getFirewallRules() {
    return this.call<FirewallRule[]>('firewall/rules')
  }
  updateFirewallRules(rules: FirewallRule[]) {
    return this.call<ConfigApplyResult>('firewall/rules', { rules })
  }
  getPortForwards() {
    return this.call<PortForwardRule[]>('firewall/port-forwards')
  }
  updatePortForwards(rules: PortForwardRule[]) {
    return this.call<ConfigApplyResult>('firewall/port-forwards', { rules })
  }
  getQosCapability() {
    return this.call<QosCapability>('network/qos/capability')
  }
  getQosConfig() {
    return this.call<QosConfig>('network/qos/config')
  }
  updateQosConfig(config: QosConfig) {
    return this.call<ConfigApplyResult>('network/qos/config', { config })
  }
  runDiagnostic(req: DiagnosticRequest) {
    return this.call<DiagnosticResult>('tools/diagnostic', req)
  }
  startDiagnostic(req: DiagnosticRequest) {
    return this.call<null>('tools/diagnostic/start', req)
  }
  pollDiagnostic(type: DiagnosticType) {
    return this.call<DiagnosticPoll>('tools/diagnostic/poll', { type })
  }
  stopDiagnostic(type: DiagnosticType) {
    return this.call<null>('tools/diagnostic/stop', { type })
  }
  changeAdminPassword(params: AdminPasswordChange) {
    return this.call<null>('system/password', params)
  }
  getSystemTime() {
    return this.call<SystemTimeConfig>('system/time')
  }
  updateSystemTime(config: SystemTimeConfig) {
    return this.call<ConfigApplyResult>('system/time', { config })
  }
  useBrowserTime(localTime: string) {
    return this.call<null>('system/time/browser', { localTime })
  }
  getScheReboot() {
    return this.call<ScheRebootConfig>('system/sche-reboot')
  }
  updateScheReboot(config: ScheRebootConfig) {
    return this.call<ConfigApplyResult>('system/sche-reboot', { config })
  }
  getFirmwareInfo() {
    return this.call<FirmwareInfo>('system/firmware')
  }
  async uploadFirmware(
    file: Blob,
    _options?: { keepSettings?: boolean; maxBytes?: number; maxSizeLabel?: string },
  ): Promise<ApiResponse<ConfigApplyResult>> {
    const token = this.getToken()
    try {
      const response = await fetch(this.path('system/firmware-package/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: file,
        credentials: 'same-origin',
      })
      const result = await response.json()
      if (!response.ok || result.ok !== true) return failure('VALIDATION', result.message || '固件校验失败', result.details)
      const report = readVerificationReport(result.data)
      if (!report || report.ok !== true || report.signature_checked !== true || report.flash_write !== false) return failure('VALIDATION', '固件校验结果无效', result.data)
      return { ok: true, data: { accepted: false, rollbackSec: 0, validated: true, flashWrite: false, message: '固件验签通过，未执行刷写', verificationReport: report }, ts: Date.now() }
    } catch {
      return failure('NETWORK', '无法连接固件校验接口')
    }
  }
  getFirmwareV2Info() {
    return this.call<FirmwareV2EngineInfo>('system/firmware-v2/info')
  }
  uploadFirmwareV2(file: Blob) {
    return this.uploadBlob<FirmwareV2UploadResult>('system/firmware-v2/upload', file)
  }
  getFirmwareV2Status() {
    return this.call<FirmwareV2Status>('system/firmware-v2/status')
  }
  applyFirmwareV2() {
    return this.call<ConfigApplyResult>('system/firmware-v2/apply', { confirm: true })
  }
  getSystemLogs(limit = 200) {
    return this.call<SystemLogState>(`system/logs?limit=${limit}`)
  }
  updateSyslog(enabled: boolean) {
    return this.call<ConfigApplyResult>('system/logs', { enabled })
  }
  clearSyslog() {
    return this.call<null>('system/logs/clear', {})
  }
  backupConfig() {
    return this.call<BackupResult>('system/backup', {})
  }
  downloadBackup() {
    return this.call<BackupDownload>('system/backup/download', {})
  }
  async restoreConfig(file: Blob) {
    if (file.size > 2 * 1024 * 1024) return failure('VALIDATION', '配置文件不能大于 2 MiB')
    try {
      const backup: unknown = JSON.parse(await file.text())
      return this.call<ConfigApplyResult>('system/restore', { backup })
    } catch {
      return failure('VALIDATION', '请选择自研 OpenWrt 后台导出的配置备份')
    }
  }
  getConfigTaskStatus(taskId: string) {
    return this.call<ConfigTaskStatus>(`system/config-task/${encodeURIComponent(taskId)}`)
  }
  confirmConfigTask(taskId: string) {
    return this.call<ConfigTaskStatus>('system/config-task/confirm', { taskId })
  }

  cancelConfigTask(taskId: string) {
    return this.call<ConfigTaskStatus>('system/config-task/cancel', { taskId })
  }
  rebootDevice() {
    return this.call<ConfigApplyResult>('system/reboot', {})
  }
  factoryReset(params: { confirmToken: string }) {
    return this.call<ConfigApplyResult>('system/factory-reset', params)
  }

  private async uploadBlob<T>(segment: string, file: Blob): Promise<ApiResponse<T>> {
    const form = new FormData()
    form.append('file', file)
    const token = this.getToken()
    const res = await fetch(this.path(segment), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      credentials: 'same-origin',
    })
    if (!res.ok) return failure('INTERNAL', '上传失败')
    return (await res.json()) as ApiResponse<T>
  }
}
