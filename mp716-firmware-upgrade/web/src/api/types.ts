/** MP716 RouterAPI 统一数据契约 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'DEVICE_BUSY'
  | 'ROLLBACK'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL'

export interface ApiResult<T> {
  ok: true
  data: T
  ts: number
}

export interface ApiFailure {
  ok: false
  code: ApiErrorCode
  message: string
  /** 可选 i18n key；展示层优先用它翻译 */
  messageKey?: string
  details?: unknown
  ts: number
}

export type ApiResponse<T> = ApiResult<T> | ApiFailure

export interface DeviceInfo {
  productName: string
  productModel: string
  softwareVersion: string
  webuiVersion: string
  lanMac: string
  wanIp: string
}

export interface SystemInfo {
  model: string
  hostname: string
  firmware: string
  kernel: string
  /** get_home_system_info.domain */
  domain?: string
  /** get_home_system_info.device_umber */
  deviceNumber?: string
  uptimeSec: number
  localTime: string
  cpuLoad: number[]
  memTotalKb: number
  memFreeKb: number
  flashTotalKb: number
  flashFreeKb: number
}

export interface InterfaceStatus {
  name: string
  label: string
  up: boolean
  proto: string
  ipv4?: string
  ipv6?: string
  rxBytes: number
  txBytes: number
  mac?: string
}

export interface SystemStatus {
  cpuPercent: number
  memoryPercent: number
  uptimeSec: number
  interfaces: InterfaceStatus[]
  wirelessClients: number
  wiredClients: number
}

export interface WanStatus extends InterfaceStatus {
  gateway?: string
  dns: string[]
  connected: boolean
  netmask?: string
  mtu?: number
  uptimeSec?: number
  rxRateBps?: number
  txRateBps?: number
}

export type WanProto = 'dhcp' | 'static' | 'pppoe'

export interface WanConfig {
  proto: WanProto
  username?: string
  password?: string
  ipv4?: string
  netmask?: string
  gateway?: string
  dns: string[]
  /** 有线 DHCP / 静态的 cc_mtu */
  mtu: number
  hostname?: string
  macaddr?: string
  /** 原厂 def_mac_addr，克隆 MAC 取消时还原 */
  defaultMac?: string
  /** 当前管理终端 MAC（get_current_user_info.usr_mac），供克隆 */
  clientMac?: string
  /** wired 或 mobile。保存只提交读取到的值 */
  wanMode?: string
  /** 移动：0 自动拨号，1 手动 APN */
  useApn?: number
  apnName?: string
  apnUser?: string
  apnPassword?: string
  authType?: number
  /** PPPoE 的 ppp_mtu */
  pppMtu?: number
  ac?: string
  service?: string
}

export interface LanStatus extends InterfaceStatus {
  netmask?: string
  /** get_network_info.lan_infos.client_sum */
  clientCount?: number
  dhcpEnabled?: boolean
}

export interface LanConfig {
  ipv4: string
  netmask: string
  /** 原厂 LAN 读取没有该开关时留空 */
  dhcpRelay?: boolean
}

export interface StaticDhcpBinding {
  ipv4: string
  mac: string
  hostname: string
}

export interface DhcpLease {
  hostname: string
  mac: string
  ipv4: string
  expiresSec: number
}

export interface DhcpConfig {
  enabled: boolean
  start: number
  limit: number
  /** 原厂为秒，例如 7200。也接受 12h / 30m */
  leasetime: string
  gateway: string
  dns: string[]
  leases: DhcpLease[]
  /** 原厂 start_ip / end_ip。有值时保存以它们为准 */
  startIp?: string
  endIp?: string
  /** 原厂允许池范围 */
  minIp?: string
  maxIp?: string
  /** get_dhcps_server_config.static_dhcp_arr */
  staticBindings?: StaticDhcpBinding[]
}

export interface DnsConfig {
  mode: 'auto' | 'manual'
  servers: string[]
}

export interface WifiAdvancedConfig {
  supportsLegacyOptions?: boolean
  supportsDtim?: boolean
  /** 2.4G 射频是否打开。关闭时原厂不展示高级项 */
  radioOn: boolean
  /** 0 自动，1 开启，2 关闭 */
  bgprotectMode: number
  beacon: number
  dtim: number
  rtsThreshold: number
  fragThreshold: number
  /** 0 关闭，1 开启 */
  txBurst: number
  /** 0 长前导，1 短前导，2 自动 */
  txPreamble: number
  /** 0 关闭，1 开启 */
  wmm: number
}

export interface L2tpClientConfig {
  enabled: boolean
  status: number
  address: string
  server: string
  username: string
  password: string
  /** IPSec 预共享密钥，明文提交 */
  ipsecKey: string
  /** 服务器模式已开启时，客户端不能同时打开 */
  serverEnabled: boolean
}

export interface VpnOnlineUser {
  pid: string
  username: string
  type: string
  dialIp: string
  assignIp: string
  /** 设备返回的上线时间，unix 秒换成本地时间 */
  joinedAt: string
}

export interface OpenVpnConfig {
  enabled: boolean
  /** 1 连接成功，0 连接失败，其他为未连接 */
  status: number
  /** 0 表单，1 上传配置文件 */
  mode: number
  host: string
  username: string
  password: string
  port: number
  /** 本次会话是否已上传配置文件。只有上传模式保存时用到 */
  configUploaded?: boolean
}

export interface VpnUser {
  type: string
  username: string
  password: string
  /** 空字符串表示 AUTO */
  address: string
  comment: string
  /** 原厂格式：192.168.7.0/24，多段用分号分隔 */
  routes: string
}

export interface VpnUserConfig {
  users: VpnUser[]
  types: string[]
  pptpStart: string
  pptpEnd: string
  l2tpStart: string
  l2tpEnd: string
}

export interface VpnServerConfig {
  enabled: boolean
  startIp: string
  endIp: string
  server: string
  /** PPTP 的 MPPE。0 加密，1 可选加密，2 不加密 */
  mppe?: number
  /** L2TP 的 IPSec 开关 */
  ipsecEnabled?: boolean
  ipsecKey?: string
  dnsEnabled: boolean
  primaryDns: string
  secondaryDns: string
  mtu: number
  mru: number
}

export interface PptpStaticRoute {
  target: string
  netmask: string
}

/** 原厂 PPTP 客户端。状态和地址只读，保存时不覆盖。 */
export interface PptpClientConfig {
  enabled: boolean
  /** 0 未连接，其他值表示已连接 */
  status: number
  address: string
  server: string
  username: string
  password: string
  /** 0 加密，1 可选加密，2 不加密 */
  mppe: number
  /** 0 手动，1 自动 */
  routeType: number
  routes: PptpStaticRoute[]
}

export interface WifiStatus {
  iface: string
  band: '2.4GHz'
  enabled: boolean
  ssid: string
  channel: number
  /** 原厂 auto_channel：1 表示当前信道旁标注 (AUTO) */
  autoChannel?: boolean
  txPower: number
  /** HYID 108 wireless_arr[].client_sum，仅无线关联数 */
  clients: number
  /** 原厂 auth_mode 原文，如 WPAWPA2PSK */
  security: string
  /** 原厂 band 码译出的模式，如 11BGN。没有记录时留空 */
  mode?: string
  /** 原厂 wireless_arr[].bssid */
  mac?: string
}

/** HYID 108 port_arr：物理网口，与逻辑 wan/lan 接口分离 */
export interface PhysicalPortStatus {
  id: string
  label: string
  role: 'lan' | 'wan'
  linkUp: boolean
  speedMbps: number
}

export type WifiSecurity =
  | 'none'
  | 'wpa-psk'
  | 'wpa2-psk'
  | 'wpa-wpa2-psk'
  | 'wpa3-sae'
  | 'wpa2-wpa3'

export type WifiMode = '11b' | '11g' | '11n' | '11bg' | '11bgn'
export type WifiCipher = 'tkip' | 'aes' | 'tkipaes'
export type WifiHtMode = 'AUTO' | 'HT20' | 'HT40'
export type WifiTxPowerPercent = 100 | 75 | 50 | 25 | 12 | 0

/** 设备契约字段 + UI 扩展（设备端可忽略未知字段） */
export interface WifiConfig {
  enabled: boolean
  ssid: string
  hidden: boolean
  channel: number | 'auto'
  /** 发射功率百分比 */
  txPower: number
  security: WifiSecurity
  password?: string
  cipher?: WifiCipher
  mode?: WifiMode
  htmode?: WifiHtMode
  txpowerPercent?: WifiTxPowerPercent
  maxClients?: number
  isolate?: boolean
  macfilter?: 'disable' | 'allow' | 'deny'
  maclist?: string[]
}

/** 配置确认句柄（前端 ApplyBanner） */
export interface ApplyHandle {
  applyId: string
  timeoutSec: number
}

export interface WirelessClient {
  mac: string
  ipv4?: string
  hostname: string
  ssid: string
  rssi: number
  txRateMbps: number
  rxRateMbps: number
  connectedSec: number
}

export interface DeviceAclEntry {
  mac: string
}

export interface ConnectedDevice {
  blocked?: boolean
  id: string
  mac: string
  ipv4: string
  hostname: string
  interface: string
  wired?: boolean
  online?: boolean
  rxBytes: number
  txBytes: number
  lastSeen: string
}

export interface FirewallRule {
  id: string
  name: string
  enabled: boolean
  src: string
  dest: string
  proto: string
  action: 'ACCEPT' | 'DROP' | 'REJECT'
}

export interface PortForwardRule {
  id: string
  name: string
  enabled: boolean
  proto: string
  extPort: number
  intIp: string
  intPort: number
}

export interface SystemLogEntry {
  id: number
  time: string
  facility: string
  level: string
  message: string
}

/** 原厂日志是一整段文本，没有拆成时间、级别和内容。 */
export interface SystemLogState {
  enabled: boolean
  content: string
}

export interface BackupResult {
  filename: string
  size: number
  checksum: string
}

export interface ConfigApplyResult {
  accepted: boolean
  rollbackSec: number
  taskId?: string
  validated?: boolean
  flashWrite?: boolean
  message?: string
  verificationReport?: FirmwareVerificationReport
}

export interface FirmwareVerificationReport {
  ok: boolean
  code: number
  signature_checked: boolean
  flash_write: boolean
  [key: string]: unknown
}

export interface QosCapability {
  supported: boolean
  backend: 'sqm' | 'none'
  reason?: string
}

export interface QosConfig {
  enabled: boolean
  downloadKbps: number
  uploadKbps: number
}

export interface PreLoginConfig {
  /** 1 表示仍在首次向导流程 */
  firstBoot: number
  /** 0 时首次启动可直接进向导而不先登录 */
  needAuthorized: number
  companyName?: string
  sysMode?: number
}

export interface LoginParams {
  username: string
  password: string
}

export interface LoginResult {
  token: string
  expiresIn: number
}

/** 原厂 main.9b45205a 向导 HYID 9/10 的 WAN 段 */
export interface QuickSettingWan {
  wanType: 'wired' | 'mobile'
  proto: 'dhcp' | 'static' | 'pppoe'
  hostName?: string
  ipAddr?: string
  subnetMask?: string
  gateway?: string
  dns: string[]
  username?: string
  password?: string
  ac?: string
  service?: string
  useApn?: number
  apnName?: string
  apnUser?: string
  apnPassword?: string
  authType?: number
}

export interface QuickSettingWifi {
  ssid2g: string
  /** 0 无加密，1 加密 */
  encry2g: number
  passphrase2g?: string
}

export interface QuickSettingState {
  /** 0 表示向导已结束，应跳转首页 */
  firstBoot: number
  speed?: number
  wan: QuickSettingWan
  wifi: QuickSettingWifi
}

export interface QuickSettingApplyResult {
  progressSec: number
  reconnect: boolean
  reconnectIp: string
}

export type WirelessAclMode = 'disable' | 'allow' | 'deny'

export interface WirelessAclEntry {
  id: string
  mac: string
  /** 与整表 mode 对齐；原厂整表仅一种策略 */
  policy: 'allow' | 'deny'
  note?: string
}

/** 原厂 wifi_admin + macfilter_arr */
export interface WirelessAclConfig {
  mode: WirelessAclMode
  entries: WirelessAclEntry[]
}

export type DiagnosticType = 'ping' | 'traceroute' | 'dns' | 'dhcp'

export interface DiagnosticRequest {
  type: DiagnosticType
  target: string
  count?: number
  /** 原厂 start_host_addr，Ping 的指定源地址 */
  source?: string
  /** 原厂 max_hops */
  maxHops?: number
  /** 原厂 timeout，单位秒 */
  timeoutSec?: number
}

export interface DiagnosticResult {
  success: boolean
  output: string
  durationMs: number
}

export interface DhcpDetectServer {
  ip: string
  mac: string
}

/** 原厂检测轮询：flag 1 进行中，0 或 2 结束 */
export interface DiagnosticPoll {
  flag: number
  running: boolean
  output: string
  servers: DhcpDetectServer[]
}

export interface SystemTimeConfig {
  /** 原厂时区字符串，例如 CST-8 */
  timezone: string
  ntpEnabled: boolean
  /** 固定 3 个 NTP 服务器槽位，空字符串也要原样提交 */
  ntpServers: string[]
  localTime: string
}

export interface ScheRebootConfig {
  /** 0 关闭，1 倒计时，2 指定时间重启 */
  mode: number
  remainHour: number
  remainMinute: number
  hour: number
  minute: number
  /** 周日 1、周一 2、周二 4、周三 8、周四 16、周五 32、周六 64。七天全选为 255 */
  weeks: number
  /** 设备当前时间，unix 秒 */
  timeDay: number
  /** 距离重启的秒数。0 表示当前没有倒计时 */
  remainingSec: number
}

export interface AdminPasswordChange {
  oldPassword: string
  newPassword: string
}

export interface FirmwareInfo {
  currentVersion: string
  buildDate: string
  hardware: string
  canUpgrade: boolean
  /** 设备端：存在 /etc/mp716/allow-flash-upgrade 时为 true */
  flashUpgradeEnabled?: boolean
  /** 原厂 get_upgrade_info 的 maxsize，字节。0 表示页面不限制 */
  maxBytes?: number
  /** 原厂 maxsize_tip，例如 8M */
  maxSizeLabel?: string
  upgradeEngine?: 'v1' | 'v2' | string
}

export interface FirmwareV2EngineInfo {
  engine: string
  model: string
  flashReal: boolean
  dryRunOnly?: boolean
}

export interface FirmwareV2UploadResult {
  validated: boolean
  signed?: boolean
  flashWrite: boolean
  dryRunOnly?: boolean
  message?: string
}

export interface FirmwareV2Status {
  state: string
  taskId?: string
  message?: string
  ts?: number
}

export interface ConfigTaskStatus {
  taskId: string
  state: 'pending' | 'confirmed' | 'rolled_back' | 'failed'
  message?: string
  remainingSec: number
}

export interface BackupDownload {
  filename: string
  mime: string
  contentBase64: string
}
