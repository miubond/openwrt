import type {
  ApiResponse,
  BackupResult,
  ConfigApplyResult,
  ConnectedDevice,
  DeviceAclEntry,
  DhcpConfig,
  StaticDhcpBinding,
  DnsConfig,
  FirewallRule,
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
  QosCapability,
  QosConfig,
  AdminPasswordChange,
  BackupDownload,
  ConfigTaskStatus,
  DiagnosticPoll,
  DiagnosticRequest,
  DiagnosticResult,
  DiagnosticType,
  FirmwareInfo,
  FirmwareV2EngineInfo,
  FirmwareV2Status,
  FirmwareV2UploadResult,
  DeviceInfo,
  SystemInfo,
  SystemLogState,
  SystemStatus,
  ScheRebootConfig,
  SystemTimeConfig,
  WirelessAclConfig,
  WanConfig,
  WanStatus,
  LanConfig,
  LanStatus,
  PhysicalPortStatus,
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
  WirelessClient,
} from './types'

/** 全站唯一设备能力接口；页面禁止直接 fetch ubus */
export interface RouterAPI {
  getPreLoginConfig(): Promise<ApiResponse<PreLoginConfig>>
  login(params: LoginParams): Promise<ApiResponse<LoginResult>>
  logout(): Promise<ApiResponse<null>>
  getQuickSetting(): Promise<ApiResponse<QuickSettingState>>
  applyQuickSetting(
    wan: QuickSettingWan,
    wifi: QuickSettingWifi,
  ): Promise<ApiResponse<QuickSettingApplyResult>>
  completeWizardFirstBoot(): Promise<ApiResponse<null>>
  ping(): Promise<ApiResponse<{ latencyMs: number }>>

  getSystemInfo(): Promise<ApiResponse<SystemInfo>>
  getDeviceInfo(): Promise<ApiResponse<DeviceInfo>>
  getSystemStatus(): Promise<ApiResponse<SystemStatus>>

  getWanStatus(): Promise<ApiResponse<WanStatus>>
  getWanConfig(): Promise<ApiResponse<WanConfig>>
  updateWanConfig(
    config: WanConfig,
    options?: { confirmTimeoutSec?: number },
  ): Promise<ApiResponse<ConfigApplyResult>>

  getLanStatus(): Promise<ApiResponse<LanStatus>>
  getLanConfig(): Promise<ApiResponse<LanConfig>>
  updateLanConfig(
    config: LanConfig,
    options?: { confirmTimeoutSec?: number },
  ): Promise<ApiResponse<ConfigApplyResult>>

  getDhcpConfig(): Promise<ApiResponse<DhcpConfig>>
  updateDhcpConfig(
    config: DhcpConfig,
    options?: { confirmTimeoutSec?: number },
  ): Promise<ApiResponse<ConfigApplyResult>>
  updateDhcpStaticBindings(
    bindings: StaticDhcpBinding[],
  ): Promise<ApiResponse<ConfigApplyResult>>

  getDnsConfig(): Promise<ApiResponse<DnsConfig>>
  updateDnsConfig(
    config: DnsConfig,
    options?: { confirmTimeoutSec?: number },
  ): Promise<ApiResponse<ConfigApplyResult>>

  getWifiStatus(): Promise<ApiResponse<WifiStatus>>
  getPhysicalPorts(): Promise<ApiResponse<PhysicalPortStatus[]>>
  getWifiConfig(): Promise<ApiResponse<WifiConfig>>
  updateWifiConfig(
    config: WifiConfig,
    options?: { confirmTimeoutSec?: number },
  ): Promise<ApiResponse<ConfigApplyResult>>
  getWifiSecondaryConfig(): Promise<ApiResponse<WifiSecondaryConfig>>
  updateWifiSecondaryConfig(
    config: WifiSecondaryConfig,
    options?: { confirmTimeoutSec?: number },
  ): Promise<ApiResponse<ConfigApplyResult>>
  getWifiAdvanced(): Promise<ApiResponse<WifiAdvancedConfig>>
  updateWifiAdvanced(
    config: WifiAdvancedConfig,
    options?: { confirmTimeoutSec?: number },
  ): Promise<ApiResponse<ConfigApplyResult>>

  getPptpClient(): Promise<ApiResponse<PptpClientConfig>>
  updatePptpClient(config: PptpClientConfig): Promise<ApiResponse<ConfigApplyResult>>

  getPptpServer(): Promise<ApiResponse<VpnServerConfig>>
  updatePptpServer(config: VpnServerConfig): Promise<ApiResponse<ConfigApplyResult>>
  getL2tpServer(): Promise<ApiResponse<VpnServerConfig>>
  updateL2tpServer(config: VpnServerConfig): Promise<ApiResponse<ConfigApplyResult>>

  getVpnUsers(): Promise<ApiResponse<VpnUserConfig>>
  updateVpnUsers(config: VpnUserConfig): Promise<ApiResponse<ConfigApplyResult>>

  getL2tpClient(): Promise<ApiResponse<L2tpClientConfig>>
  updateL2tpClient(config: L2tpClientConfig): Promise<ApiResponse<ConfigApplyResult>>

  getVpnStatus(): Promise<ApiResponse<VpnOnlineUser[]>>
  disconnectVpnUser(pid: string): Promise<ApiResponse<{ disconnected: boolean } | null>>

  getOpenVpn(): Promise<ApiResponse<OpenVpnConfig>>
  updateOpenVpn(config: OpenVpnConfig): Promise<ApiResponse<ConfigApplyResult>>
  uploadOpenVpn(file: File, kind: 'config' | 'cert'): Promise<ApiResponse<ConfigApplyResult>>

  getWireGuardClient(): Promise<ApiResponse<WireGuardClientConfig>>
  updateWireGuardClient(config: WireGuardClientConfig): Promise<ApiResponse<ConfigApplyResult>>
  /** 导入 wg-quick 配置；导入后为停用状态，需确认后再启用 */
  importWireGuardClient(text: string): Promise<ApiResponse<WireGuardImportResult>>
  getWireGuardStatus(): Promise<ApiResponse<WireGuardStatus>>

  getWirelessClients(): Promise<ApiResponse<WirelessClient[]>>
  getConnectedDevices(): Promise<ApiResponse<ConnectedDevice[]>>
  getHostsOverview?(): Promise<ApiResponse<import('./types').HostsOverview>>
  getDeviceAclList(): Promise<ApiResponse<DeviceAclEntry[]>>
  addDeviceAcl(mac: string): Promise<ApiResponse<null>>
  removeDeviceAcl(mac: string): Promise<ApiResponse<null>>

  getFirewallRules(): Promise<ApiResponse<FirewallRule[]>>
  updateFirewallRules(rules: FirewallRule[]): Promise<ApiResponse<ConfigApplyResult>>
  getPortForwards(): Promise<ApiResponse<PortForwardRule[]>>
  updatePortForwards(rules: PortForwardRule[]): Promise<ApiResponse<ConfigApplyResult>>
  getDmzConfig(): Promise<ApiResponse<DmzConfig>>
  updateDmzConfig(config: DmzConfig): Promise<ApiResponse<ConfigApplyResult>>
  getUpnpConfig(): Promise<ApiResponse<UpnpConfig>>
  updateUpnpConfig(config: UpnpConfig): Promise<ApiResponse<ConfigApplyResult>>
  getDdnsConfig(): Promise<ApiResponse<DdnsConfig>>
  updateDdnsConfig(config: DdnsConfig): Promise<ApiResponse<ConfigApplyResult>>

  getSystemCapabilities?(): Promise<ApiResponse<import('./types').NativeCapabilities>>

  getStaticRoutes(): Promise<ApiResponse<import('./types').NetworkStaticRoute[]>>
  updateStaticRoutes(routes: import('./types').NetworkStaticRoute[]): Promise<ApiResponse<ConfigApplyResult>>

  getQosCapability(): Promise<ApiResponse<QosCapability>>
  getQosConfig(): Promise<ApiResponse<QosConfig>>
  updateQosConfig(config: QosConfig): Promise<ApiResponse<ConfigApplyResult>>

  getWirelessAcl(): Promise<ApiResponse<WirelessAclConfig>>
  updateWirelessAcl(config: WirelessAclConfig): Promise<ApiResponse<ConfigApplyResult>>

  runDiagnostic(req: DiagnosticRequest): Promise<ApiResponse<DiagnosticResult>>
  /** 原厂开始检测：Ping HYID 66、路由跟踪 69、DHCP 32 */
  startDiagnostic(req: DiagnosticRequest): Promise<ApiResponse<null>>
  /** 原厂单次读取检测结果，页面按 3 秒或 5 秒自行轮询 */
  pollDiagnostic(type: DiagnosticType): Promise<ApiResponse<DiagnosticPoll>>
  /** 原厂停止检测：Ping HYID 67、路由跟踪 70、DHCP 33 */
  stopDiagnostic(type: DiagnosticType): Promise<ApiResponse<null>>

  changeAdminPassword(params: AdminPasswordChange): Promise<ApiResponse<null>>

  getSystemTime(): Promise<ApiResponse<SystemTimeConfig>>
  updateSystemTime(config: SystemTimeConfig): Promise<ApiResponse<ConfigApplyResult>>
  /** 原厂 HYID 36 use_browser_time，把浏览器本地时间写入设备 */
  useBrowserTime(localTime: string): Promise<ApiResponse<null>>

  getScheReboot(): Promise<ApiResponse<ScheRebootConfig>>
  updateScheReboot(config: ScheRebootConfig): Promise<ApiResponse<ConfigApplyResult>>

  getFirmwareInfo(): Promise<ApiResponse<FirmwareInfo>>
  uploadFirmware(
    file: Blob,
    options?: { keepSettings?: boolean; flash?: boolean },
  ): Promise<ApiResponse<ConfigApplyResult>>

  getFirmwareV2Info(): Promise<ApiResponse<FirmwareV2EngineInfo>>
  uploadFirmwareV2(file: Blob): Promise<ApiResponse<FirmwareV2UploadResult>>
  getFirmwareV2Status(jobId?: string): Promise<ApiResponse<FirmwareV2Status>>
  applyFirmwareV2(params?: {
    confirm?: boolean
    jobId?: string
    keepSettings?: boolean
  }): Promise<ApiResponse<ConfigApplyResult>>

  getSystemLogs(limit?: number): Promise<ApiResponse<SystemLogState>>
  updateSyslog(enabled: boolean): Promise<ApiResponse<ConfigApplyResult>>
  clearSyslog(): Promise<ApiResponse<null>>

  backupConfig(): Promise<ApiResponse<BackupResult>>
  downloadBackup(): Promise<ApiResponse<BackupDownload>>
  restoreConfig(file: Blob): Promise<ApiResponse<ConfigApplyResult>>

  getActiveConfigTask?(): Promise<ApiResponse<ConfigTaskStatus | null>>
  getConfigTaskStatus(taskId: string): Promise<ApiResponse<ConfigTaskStatus>>
  confirmConfigTask(taskId: string): Promise<ApiResponse<ConfigTaskStatus>>
  cancelConfigTask?(taskId: string): Promise<ApiResponse<ConfigTaskStatus>>

  disconnectDevice(deviceId: string): Promise<ApiResponse<null>>

  rebootDevice(): Promise<ApiResponse<ConfigApplyResult>>
  factoryReset(params: { confirmToken: string }): Promise<ApiResponse<ConfigApplyResult>>
}
