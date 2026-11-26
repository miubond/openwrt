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
  DmzConfig,
  UpnpConfig,
  DdnsConfig,
  NativeCapabilities,
  NetworkStaticRoute,
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
  WireGuardClientConfig,
  WireGuardImportResult,
  WireGuardStatus,
  WifiAdvancedConfig,
  WifiConfig,
  WifiSecondaryConfig,
  WifiStatus,
  WirelessAclConfig,
  WirelessClient,
  HomeDashboard,
  HostsOverview,
} from '../types'
import { createGetScheduler, resolveDeviceGetConcurrency } from '../device-get-scheduler'
import { notifySessionActive, notifySessionInvalid } from '../session'
import { requestJson, failure, type RequestOptions } from '../http'
import { readVerificationReport } from '../firmware-verification'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/cgi-bin/mp716'
const DEVICE_GET_CACHE_MS = 4_000
const DEVICE_GET_CACHE_MS_BY_SEGMENT: Record<string, number> = {
  'home/dashboard': 18_000,
  'hosts/overview': 15_000,
  'hosts/connected': 15_000,
  'system/status': 5_000,
  'system/info': 5_000,
  'home/physical-ports': 8_000,
  'wireless/status': 12_000,
  'wireless/config': 30_000,
  'network/wan/config': 30_000,
  'network/lan/config': 30_000,
  'network/dhcp/config': 30_000,
  'system/firmware': 60_000,
  'system/device': 30_000,
  'system/capabilities': 300_000,
  'system/config-task/active': 10_000,
  'wireless/secondary': 30_000,
  'vpn/pptpd': 15_000,
  'vpn/xl2tpd': 15_000,
  'vpn/pptp': 15_000,
  'vpn/xl2tp': 15_000,
}

type TokenProvider = () => string | null

const deviceGetCache = new Map<string, { at: number; res: ApiResponse<unknown> }>()
const deviceGetInflight = new Map<string, Promise<ApiResponse<unknown>>>()
/**
 * 设备 GET 并发上限（默认 1=全局串行）。
 * 构建时设置 VITE_DEVICE_GET_CONCURRENCY=2|3 做 A/B，保留 in-flight 去重。
 */
const deviceGetScheduler = createGetScheduler(
  resolveDeviceGetConcurrency(import.meta.env.VITE_DEVICE_GET_CONCURRENCY as string | undefined),
)

function guardUnauthorized<T>(res: ApiResponse<T>, segment: string): ApiResponse<T> {
  if (!res.ok && res.code === 'UNAUTHORIZED') notifySessionInvalid()
  else if (res.ok && !segment.startsWith('auth/')) notifySessionActive()
  return res
}

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
    request?: Pick<RequestOptions, 'timeoutMs'>,
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
        inflight = deviceGetScheduler.run(() =>
          requestJson<T>(this.path(segment), {
            method: 'GET',
            token: this.getToken(),
            timeoutMs: request?.timeoutMs,
          }).then((res) => {
            const guarded = guardUnauthorized(res, segment)
            /** 勿缓存鉴权失败，否则登录后短时间内仍命中旧 401 */
            if (guarded.ok || (guarded as { code?: string }).code !== 'UNAUTHORIZED') {
              deviceGetCache.set(segment, { at: Date.now(), res: guarded as ApiResponse<unknown> })
            }
            deviceGetInflight.delete(segment)
            return guarded as ApiResponse<unknown>
          }),
        )
        deviceGetInflight.set(segment, inflight)
      }
      return inflight as Promise<ApiResponse<T>>
    }
    return guardUnauthorized(
      await requestJson<T>(this.path(segment), {
        method,
        body,
        token: this.getToken(),
        timeoutMs: request?.timeoutMs,
      }),
      segment,
    )
  }

  /** 首页聚合：设备端只扫一次终端列表与物理口 */
  getHomeDashboard() {
    return this.call<HomeDashboard>('home/dashboard', undefined, 'GET', { timeoutMs: 28_000 })
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
  updateDhcpConfig(config: DhcpConfig, options?: { confirmTimeoutSec?: number }) {
    return this.call<ConfigApplyResult>('network/dhcp/config', {
      config,
      confirmTimeoutSec: options?.confirmTimeoutSec ?? 90,
    })
  }
  updateDhcpStaticBindings(bindings: StaticDhcpBinding[]) {
    return this.call<ConfigApplyResult>('network/dhcp/static', { bindings })
  }
  getDnsConfig() {
    return this.call<DnsConfig>('network/dns/config')
  }
  updateDnsConfig(config: DnsConfig, options?: { confirmTimeoutSec?: number }) {
    return this.call<ConfigApplyResult>('network/dns/config', {
      config,
      confirmTimeoutSec: options?.confirmTimeoutSec ?? 90,
    })
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
  getWifiSecondaryConfig() {
    return this.call<WifiSecondaryConfig>('wireless/secondary')
  }
  updateWifiSecondaryConfig(config: WifiSecondaryConfig, options?: { confirmTimeoutSec?: number }) {
    return this.call<ConfigApplyResult>('wireless/secondary', {
      config,
      ...(options?.confirmTimeoutSec != null ? { confirmTimeoutSec: options.confirmTimeoutSec } : {}),
    })
  }
  updateWifiConfig(config: WifiConfig, options?: { confirmTimeoutSec?: number }) {
    return this.call<ConfigApplyResult>('wireless/config', {
      config,
      confirmTimeoutSec: options?.confirmTimeoutSec ?? 90,
    })
  }
  getWifiAdvanced() {
    return this.call<WifiAdvancedConfig>('wireless/advanced')
  }
  updateWifiAdvanced(config: WifiAdvancedConfig, options?: { confirmTimeoutSec?: number }) {
    return this.call<ConfigApplyResult>('wireless/advanced', {
      config,
      confirmTimeoutSec: options?.confirmTimeoutSec ?? 90,
    })
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
  getWireGuardClient() {
    return this.call<WireGuardClientConfig>('vpn/wireguard/client')
  }
  updateWireGuardClient(config: WireGuardClientConfig) {
    return this.call<ConfigApplyResult>('vpn/wireguard/client', { config })
  }
  importWireGuardClient(text: string) {
    if (text.length > 8192) return Promise.resolve(failure('VALIDATION', 'WireGuard 配置文件不能大于 8 KiB'))
    return this.call<WireGuardImportResult>('vpn/wireguard/client/import', { text })
  }
  getWireGuardStatus() {
    return this.call<WireGuardStatus>('vpn/wireguard/status')
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
  getHostsOverview() {
    return this.call<HostsOverview>('hosts/overview')
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
  getDmzConfig() {
    return this.call<DmzConfig>('firewall/dmz')
  }
  updateDmzConfig(config: DmzConfig) {
    return this.call<ConfigApplyResult>('firewall/dmz', { config })
  }
  getUpnpConfig() {
    return this.call<UpnpConfig>('network/upnp')
  }
  updateUpnpConfig(config: UpnpConfig) {
    return this.call<ConfigApplyResult>('network/upnp', { config })
  }
  getDdnsConfig() {
    return this.call<DdnsConfig>('network/ddns')
  }
  updateDdnsConfig(config: DdnsConfig) {
    return this.call<ConfigApplyResult>('network/ddns', { config })
  }
  getSystemCapabilities() {
    return this.call<NativeCapabilities>('system/capabilities')
  }
  getStaticRoutes() {
    return this.call<NetworkStaticRoute[]>('network/static-routes')
  }
  updateStaticRoutes(routes: NetworkStaticRoute[]) {
    return this.call<ConfigApplyResult>('network/static-routes', { routes })
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
    options?: { keepSettings?: boolean; flash?: boolean },
  ): Promise<ApiResponse<ConfigApplyResult>> {
    const flash = options?.flash === true
    const keep = options?.keepSettings !== false
    const token = this.getToken()
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 180_000)
      const params = new URLSearchParams()
      if (flash) params.set('mode', 'flash')
      if (!keep) params.set('keep', '0')
      const query = params.toString()
      const response = await fetch(this.path('system/firmware-package/verify') + (query ? `?${query}` : ''), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Mp716-Upgrade-Mode': flash ? 'flash' : 'verify',
          'X-Mp716-Keep-Settings': keep ? '1' : '0',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
        credentials: 'same-origin',
        signal: controller.signal,
      })
      clearTimeout(timer)
      const result = (await response.json()) as {
        ok?: boolean
        message?: string
        details?: unknown
        data?: unknown
      }
      const reportPayload = result.details ?? result.data
      if (!response.ok || result.ok !== true) {
        const code =
          response.status === 401
            ? 'UNAUTHORIZED'
            : response.status === 403
              ? 'FORBIDDEN'
              : 'VALIDATION'
        if (code === 'UNAUTHORIZED') notifySessionInvalid()
        return failure(
          code,
          result.message || (flash ? '固件刷写失败' : '固件校验失败'),
          reportPayload,
          code === 'UNAUTHORIZED' ? 'errors.unauthorized' : undefined,
        )
      }
      const report = readVerificationReport(result.data)
      if (flash) {
        if (!report?.ok || !report.signature_checked || !report.flash_write) {
          return failure('VALIDATION', '固件刷写结果无效', result.data)
        }
        return {
          ok: true,
          data: {
            accepted: true,
            rollbackSec: 0,
            validated: true,
            flashWrite: true,
            message: (result.data as { message?: string })?.message || '固件刷写已提交，设备将重启',
            verificationReport: report,
          },
          ts: Date.now(),
        }
      }
      if (
        !report ||
        report.ok !== true ||
        report.signature_checked !== true ||
        report.flash_write !== false
      ) {
        return failure('VALIDATION', '固件校验结果无效', result.data)
      }
      const raw = result.data as { job_id?: string; taskId?: string }
      return {
        ok: true,
        data: {
          accepted: false,
          rollbackSec: 0,
          validated: true,
          flashWrite: false,
          jobId: raw?.job_id || raw?.taskId || '',
          message: '固件验签通过，未执行刷写',
          verificationReport: report,
        },
        ts: Date.now(),
      }
    } catch {
      if (flash) {
        return {
          ok: true,
          data: {
            accepted: true,
            rollbackSec: 0,
            validated: true,
            flashWrite: true,
            message: '固件可能正在刷写，设备将重启；请稍后重新登录',
          },
          ts: Date.now(),
        }
      }
      return failure('NETWORK', '无法连接固件校验接口')
    }
  }
  getFirmwareV2Info() {
    return this.call<FirmwareV2EngineInfo>('system/firmware-v2/info')
  }
  async uploadFirmwareV2(file: Blob): Promise<ApiResponse<FirmwareV2UploadResult>> {
    const token = this.getToken()
    const res = await fetch(this.path('system/firmware-v2/upload'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: file,
      credentials: 'same-origin',
    })
    const body = (await res.json()) as { ok?: boolean; data?: Record<string, unknown>; message?: string }
    if (!res.ok || body.ok !== true) {
      return failure('VALIDATION', body.message || '固件上传失败', body.data)
    }
    const raw = body.data || {}
    const report = readVerificationReport(raw)
    return {
      ok: true,
      data: {
        validated: !!report?.ok,
        signed: !!report?.signature_checked,
        flashWrite: false,
        dryRunOnly: !report?.flash_write,
        jobId: String(raw.job_id || raw.taskId || ''),
        taskId: String(raw.taskId || raw.job_id || ''),
        message: '固件已校验并暂存',
      },
      ts: Date.now(),
    }
  }
  getFirmwareV2Status() {
    return this.call<FirmwareV2Status>('system/firmware-v2/status')
  }
  async applyFirmwareV2(params?: {
    confirm?: boolean
    jobId?: string
    keepSettings?: boolean
  }): Promise<ApiResponse<ConfigApplyResult>> {
    const token = this.getToken()
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 180_000)
      const res = await fetch(this.path('system/firmware-v2/apply'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          confirm: true,
          job_id: params?.jobId,
          taskId: params?.jobId,
          keepSettings: params?.keepSettings !== false,
        }),
        credentials: 'same-origin',
        signal: controller.signal,
      })
      clearTimeout(timer)
      const result = (await res.json()) as {
        ok?: boolean
        message?: string
        data?: unknown
      }
      const reportPayload = result.data
      if (!res.ok || result.ok !== true) {
        const code = res.status === 403 ? 'FORBIDDEN' : res.status === 401 ? 'UNAUTHORIZED' : 'VALIDATION'
        if (code === 'UNAUTHORIZED') notifySessionInvalid()
        return failure(code, result.message || '固件刷写失败', reportPayload)
      }
      const report = readVerificationReport(result.data)
      if (!report?.ok || !report.signature_checked || !report.flash_write) {
        return failure('VALIDATION', '固件刷写结果无效', result.data)
      }
      return {
        ok: true,
        data: {
          accepted: true,
          rollbackSec: 0,
          validated: true,
          flashWrite: true,
          jobId: params?.jobId,
          message: (result.data as { message?: string })?.message || '固件刷写已提交，设备将重启',
          verificationReport: report,
        },
        ts: Date.now(),
      } satisfies ApiResponse<ConfigApplyResult>
    } catch {
      return {
        ok: true,
        data: {
          accepted: true,
          rollbackSec: 0,
          validated: true,
          flashWrite: true,
          message: '固件可能正在刷写，设备将重启；请稍后重新登录',
        },
        ts: Date.now(),
      } satisfies ApiResponse<ConfigApplyResult>
    }
  }
  getSystemLogs(limit = 100) {
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
  getActiveConfigTask() {
    return this.call<ConfigTaskStatus | null>('system/config-task/active')
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

}
