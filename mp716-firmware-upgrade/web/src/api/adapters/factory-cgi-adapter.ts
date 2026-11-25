import { tGlobal } from '../../i18n/t-global'
import { validateHost, validateRange, validateSource } from '../../utils/detect-input'
import type { RouterAPI } from '../router-api'
import type {
  AdminPasswordChange,
  ApiErrorCode,
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
  DhcpDetectServer,
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
  PptpStaticRoute,
  VpnServerConfig,
  VpnUser,
  VpnUserConfig,
  L2tpClientConfig,
  VpnOnlineUser,
  OpenVpnConfig,
  WifiAdvancedConfig,
  WifiCipher,
  WifiConfig,
  WifiSecondaryConfig,
  WifiHtMode,
  WifiMode,
  WifiSecurity,
  PhysicalPortStatus,
  WifiStatus,
  WifiTxPowerPercent,
  WirelessAclConfig,
  WirelessAclEntry,
  WirelessClient,
} from '../types'
import { failure, requestForm, requestJson, success } from '../http'
import { HUAYI_HYID, MODEM_HYID } from '../factory-hyid'
import { HUAYI_CGI, MODEM_CGI, STREAM_CGI } from '../factory-endpoints'
import { md5Hex } from '../factory/md5'
import { isIpv4, isMac } from '../../utils/validate'

/** 原厂会话在 Cookie 里。这个值只给本地路由守卫用，不是设备返回的 token。 */
const HUAYI_SESSION_MARKER = 'huayi-session'

const BLOCKED = '原厂 CGI 契约未录制，拒绝按文件名猜测请求'
const WIFI_RADIO_24 = 0

/** 供录制完成后的真实请求使用；未录制前不得据此猜测 action */
export const factoryCgiPaths = { huayi: HUAYI_CGI, modem: MODEM_CGI } as const

/** 开发期临时放行登录；契约接通后应关闭 VITE_AUTH_BYPASS */
function authBypassEnabled() {
  return import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === '1'
}

function readErrcode(body: HuayiBody): number | null {
  const code = body.errcode
  if (typeof code === 'number' && Number.isFinite(code)) return code
  if (typeof code === 'string' && code.trim() !== '' && Number.isFinite(Number(code))) return Number(code)
  return null
}

function loginErrorCode(errcode: number | null): ApiErrorCode {
  if (errcode === 4001) return 'UNAUTHORIZED'
  if (errcode === 4011) return 'DEVICE_BUSY'
  if (errcode === 4000 || errcode === 4006) return 'VALIDATION'
  return 'INTERNAL'
}

function loginErrorMessage(errcode: number | null): string {
  if (errcode === 4000 || errcode === 4006) return '密码不正确'
  if (errcode === 4011) return '登录受限，请稍后再试'
  if (errcode === 4001) return '会话无效或已过期，请重新登录'
  if (errcode === 4005) return '登录参数缺失'
  return `登录失败（${errcode ?? 'unknown'}）`
}

function blocked<T>(method: string): Promise<ApiResponse<T>> {
  return Promise.resolve(failure('NOT_IMPLEMENTED', `${method}：${BLOCKED}`))
}

const PHYSICAL_PORT_ORDER = ['LAN1', 'LAN2', 'LAN3', 'LAN4', 'WAN'] as const

function defaultPhysicalPorts(): PhysicalPortStatus[] {
  return PHYSICAL_PORT_ORDER.map((label) => ({
    id: label.toLowerCase(),
    label,
    role: label === 'WAN' ? 'wan' : 'lan',
    linkUp: false,
    speedMbps: 0,
  }))
}

function parsePhysicalPorts(body: Record<string, unknown>): PhysicalPortStatus[] {
  const rows = record(body).port_arr
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return defaultPhysicalPorts()
  const mapped = list.map((item) => {
    const row = record(item)
    const label = text(row.port) || 'LAN'
    const role: 'lan' | 'wan' = /^wan/i.test(label) ? 'wan' : 'lan'
    return {
      id: label.toLowerCase(),
      label,
      role,
      linkUp: num(row.link) === 1,
      speedMbps: num(row.speed) ?? 0,
    }
  })
  mapped.sort((a, b) => {
    const ai = PHYSICAL_PORT_ORDER.indexOf(a.label as (typeof PHYSICAL_PORT_ORDER)[number])
    const bi = PHYSICAL_PORT_ORDER.indexOf(b.label as (typeof PHYSICAL_PORT_ORDER)[number])
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  return mapped.length > 0 ? mapped : defaultPhysicalPorts()
}

interface HuayiBody {
  errcode?: number | string
  huayi_r?: unknown
}

const WIRELESS_BAND: Record<number, string> = {
  0: '11BG',
  1: '11B',
  2: '11A',
  4: '11G',
  6: '11N',
  8: '11AN',
  9: '11BGN',
  14: '11AC',
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function enabledFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

function ipv4ToInt(ip: string): number | null {
  if (!isIpv4(ip)) return null
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0)
}

function lastOctet(ip: string): number {
  const n = Number(ip.split('.').pop())
  return Number.isInteger(n) ? n : 0
}

function parseStaticDhcpArr(value: unknown): StaticDhcpBinding[] {
  if (!Array.isArray(value)) return []
  const rows: StaticDhcpBinding[] = []
  for (const item of value) {
    const row = record(item)
    const ipv4 = text(row.ip_addr)
    const mac = text(row.mac_addr)
    if (!ipv4 || !mac) continue
    rows.push({ ipv4, mac, hostname: text(row.name) })
  }
  return rows
}

function staticDhcpPayload(bindings: StaticDhcpBinding[]): Record<string, string>[] {
  return bindings.map((b) => ({
    ip_addr: b.ipv4.trim(),
    mac_addr: b.mac.trim(),
    name: b.hostname.trim(),
  }))
}

function poolLimit(startIp: string, endIp: string): number {
  const start = ipv4ToInt(startIp)
  const end = ipv4ToInt(endIp)
  if (start == null || end == null || end < start) return 0
  return end - start + 1
}

function endFromStart(startIp: string, limit: number): string {
  const parts = startIp.split('.')
  if (parts.length !== 4 || !Number.isInteger(limit) || limit < 1) return ''
  const last = Number(parts[3]) + limit - 1
  if (!Number.isInteger(last) || last > 255) return ''
  parts[3] = String(last)
  return parts.join('.')
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

function isAsciiText(value: string): boolean {
  return /^[\u0020-\u007E]*$/.test(value)
}

function hasForbiddenVpnChar(value: string): boolean {
  return /['"\\#]/.test(value)
}

function isContiguousNetmask(value: string): boolean {
  const packed = ipv4ToInt(value.trim())
  if (packed == null) return false
  const host = ~packed >>> 0
  return (host & (host + 1)) === 0
}

function pptpRoutes(value: unknown): PptpStaticRoute[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = record(item)
    return { target: text(row.target), netmask: text(row.subnet_mask) }
  })
}

function sameSegment(left: string, right: string): boolean {
  const a = ipv4ToInt(left)
  const b = ipv4ToInt(right)
  if (a == null || b == null) return false
  return (a & 0xffffff00) === (b & 0xffffff00)
}

function poolOverlaps(start: string, end: string, otherStart: string, otherEnd: string): boolean {
  const a1 = ipv4ToInt(start)
  const a2 = ipv4ToInt(end)
  const b1 = ipv4ToInt(otherStart)
  const b2 = ipv4ToInt(otherEnd)
  if (a1 == null || a2 == null || b1 == null || b2 == null) return false
  return (a1 <= b2 && a1 >= b1) || (a2 >= b1 && a2 <= b2)
}

function vpnServerError(
  config: VpnServerConfig,
  otherStart: string,
  otherEnd: string,
  conflictMessage: string,
): string | null {
  const start = config.startIp.trim()
  const end = config.endIp.trim()
  const server = config.server.trim()
  if (!isIpv4(start) || !isIpv4(end) || !isIpv4(server)) return '地址格式无效'
  const startInt = ipv4ToInt(start)
  const endInt = ipv4ToInt(end)
  if (startInt == null || endInt == null || startInt > endInt) return '起始 IP 不能大于结束 IP'
  if (poolOverlaps(start, end, otherStart, otherEnd)) return conflictMessage
  if (sameSegment(server, start) || sameSegment(server, end)) return '服务器地址不能和客户端地址在同一网段'
  if (config.dnsEnabled && (!isIpv4(config.primaryDns.trim()) || !isIpv4(config.secondaryDns.trim()))) {
    return 'DNS 地址无效'
  }
  if (!inRange(config.mtu, 576, 1492) || !inRange(config.mru, 576, 1492)) return 'MTU / MRU 范围是 576–1492'
  return null
}

function vpnServerFrom(body: Record<string, unknown>, enableKey: string): VpnServerConfig {
  return {
    enabled: enabledFlag(body[enableKey]),
    startIp: text(body[enableKey === 'pptpd_enable' ? 'pptpd_start_addr' : 'xl2tpd_start_addr']),
    endIp: text(body[enableKey === 'pptpd_enable' ? 'pptpd_end_addr' : 'xl2tpd_end_addr']),
    server: text(body.server_addr),
    mppe: num(body.mppe) ?? 0,
    ipsecEnabled: enabledFlag(body.ipsec_enable),
    ipsecKey: text(body.ipsec_key),
    dnsEnabled: enabledFlag(body.dns_enable),
    primaryDns: text(body.primary_dns),
    secondaryDns: text(body.secondary_dns),
    mtu: num(body.mtu) ?? 0,
    mru: num(body.mru) ?? 0,
  }
}

async function saveVpnServer(
  config: VpnServerConfig,
  spec: {
    getId: number
    setId: number
    enableKey: string
    startKey: string
    endKey: string
    otherStartKey: string
    otherEndKey: string
    conflict: string
    withMppe: boolean
  },
): Promise<ApiResponse<ConfigApplyResult>> {
  const current = await postHuayi(spec.getId)
  if (!current.ok) return current
  const body = record(current.data.huayi_r)
  if (!config.enabled) {
    if (!enabledFlag(body[spec.enableKey])) return success(APPLIED)
    const saved = await postHuayi(spec.setId, { ...body, [spec.enableKey]: false })
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  const invalid = vpnServerError(config, text(body[spec.otherStartKey]), text(body[spec.otherEndKey]), spec.conflict)
  if (invalid) return failure('VALIDATION', invalid)
  if (spec.withMppe && !inRange(config.mppe ?? 0, 0, 2)) return failure('VALIDATION', 'MPPE 加密方式无效')
  const payload: Record<string, unknown> = {
    ...body,
    [spec.enableKey]: true,
    [spec.startKey]: config.startIp.trim(),
    [spec.endKey]: config.endIp.trim(),
    server_addr: config.server.trim(),
    dns_enable: config.dnsEnabled,
    primary_dns: config.primaryDns.trim(),
    secondary_dns: config.secondaryDns.trim(),
    mtu: config.mtu,
    mru: config.mru,
  }
  if (spec.withMppe) payload.mppe = config.mppe ?? 0
  else {
    payload.ipsec_enable = Boolean(config.ipsecEnabled)
    payload.ipsec_key = config.ipsecKey ?? ''
  }
  if (samePayload(body, payload)) return success(APPLIED)
  const saved = await postHuayi(spec.setId, payload)
  if (!saved.ok) return saved
  return success(APPLIED)
}

function prefixToMask(prefix: number): string {
  const bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return [24, 16, 8, 0].map((shift) => String((bits >>> shift) & 255)).join('.')
}

function maskToPrefix(mask: string): number | null {
  if (!isContiguousNetmask(mask)) return null
  const value = ipv4ToInt(mask)
  if (value == null) return null
  let bits = 0
  let rest = value
  while ((rest & 0x80000000) !== 0) {
    bits += 1
    rest = (rest << 1) >>> 0
  }
  return bits
}

function routesToText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      const row = record(item)
      const prefix = maskToPrefix(text(row.subnet_mask))
      const target = text(row.target)
      return prefix == null || !target ? '' : `${target}/${prefix}`
    })
    .filter(Boolean)
    .join(';')
}

function ipInPool(ip: string, start: string, end: string): boolean {
  const value = ipv4ToInt(ip)
  const from = ipv4ToInt(start)
  const to = ipv4ToInt(end)
  return value != null && from != null && to != null && value >= from && value <= to
}

function parseVpnRoutes(value: string): { target: string; subnet_mask: string }[] | string {
  const raw = value.trim()
  if (!raw) return []
  if (raw.length > 128) return '静态路由最多 128 个字符'
  const routes: { target: string; subnet_mask: string }[] = []
  for (const part of raw.split(';')) {
    const item = part.trim()
    if (!item) continue
    const [target, prefixText] = item.split('/')
    const prefix = Number(prefixText)
    if (!target || !isIpv4(target) || !inRange(prefix, 0, 32)) return '静态路由格式无效'
    routes.push({ target: target.trim(), subnet_mask: prefixToMask(prefix) })
  }
  return routes
}

function vpnAccountError(value: string, label: string): string | null {
  if (!value.trim()) return `${label}不能为空`
  if (value.length > 32) return `${label}最多 32 个字符`
  if (!isAsciiText(value)) return `${label}只支持 ASCII`
  if (hasForbiddenVpnChar(value)) return `${label}不能包含 ' " \\ #`
  return null
}

function readableText(value: unknown): string {
  const raw = text(value)
  return isAsciiText(raw) ? raw : ''
}

function l2tpClientFrom(body: Record<string, unknown>): L2tpClientConfig {
  const address = readableText(body.xl2tp_addr) || readableText(body.xl2tp_ip)
  return {
    enabled: enabledFlag(body.xl2tp_enable),
    status: num(body.xl2tp_status) ?? 0,
    address,
    server: text(body.server_addr),
    username: text(body.usr),
    password: text(body.pwd),
    ipsecKey: text(body.ipsec_key),
    serverEnabled: enabledFlag(body.xl2tpd_enable),
  }
}

function l2tpClientError(config: L2tpClientConfig): string | null {
  const server = config.server.trim()
  if (!server) return '服务器地址不能为空'
  if (server.length > 63) return '服务器地址最多 63 个字符'
  if (!isAsciiText(server)) return '服务器地址只支持 ASCII'
  const user = vpnAccountError(config.username, '用户名')
  if (user) return user
  const password = vpnAccountError(config.password, '密码')
  if (password) return password
  if (!config.ipsecKey) return '预共享密钥不能为空'
  if (config.ipsecKey.length < 8 || config.ipsecKey.length > 63) return '预共享密钥长度为 8-63 个字符'
  if (!isAsciiText(config.ipsecKey)) return '预共享密钥只支持 ASCII'
  return null
}

function openVpnError(config: OpenVpnConfig): string | null {
  const host = config.host.trim()
  if (host.length > 32) return '服务器地址最多 32 个字符'
  if (!isAsciiText(host)) return '服务器地址只支持 ASCII'
  if (/["'`\\]/.test(host)) return '服务器地址不能包含 " \' ` \\'
  const user = vpnAccountError(config.username, '用户名')
  if (user) return user
  const password = vpnAccountError(config.password, '密码')
  if (password) return password
  if (!inRange(config.port, 80, 65535)) return '端口范围为 80-65535'
  return null
}

function vpnUsersFrom(body: Record<string, unknown>): VpnUserConfig {
  const rows = Array.isArray(body.vpnusr_arr) ? body.vpnusr_arr : []
  const types = Array.isArray(body.vpn_type_arr)
    ? body.vpn_type_arr.map((item) => text(record(item).authenticate)).filter(Boolean)
    : []
  return {
    users: rows.map((item) => {
      const row = record(item)
      return {
        type: text(row.authenticate),
        username: text(row.usr),
        password: text(row.pwd),
        address: text(row.remote_addr),
        comment: text(row.com),
        routes: routesToText(row.route_arr),
      }
    }),
    types,
    pptpStart: text(body.pptpd_start_addr),
    pptpEnd: text(body.pptpd_end_addr),
    l2tpStart: text(body.xl2tpd_start_addr),
    l2tpEnd: text(body.xl2tpd_end_addr),
  }
}

function vpnUsersPayload(
  users: VpnUser[],
  body: Record<string, unknown>,
): Record<string, unknown>[] | string {
  if (users.length > 32) return '最多 32 个用户'
  const names = new Set<string>()
  const pptpStart = text(body.pptpd_start_addr)
  const pptpEnd = text(body.pptpd_end_addr)
  const l2tpStart = text(body.xl2tpd_start_addr)
  const l2tpEnd = text(body.xl2tpd_end_addr)
  const built: Record<string, unknown>[] = []
  for (const user of users) {
    const username = user.username
    const nameError = vpnAccountError(username, '用户名')
    if (nameError) return nameError
    const passwordError = vpnAccountError(user.password, '密码')
    if (passwordError) return passwordError
    if (names.has(username)) return '用户名已存在'
    names.add(username)
    if (user.comment.length > 16) return '备注最多 16 个字符'
    const address = user.address.trim()
    if (address) {
      if (!isIpv4(address)) return '分配 IP 格式无效'
      const inPptp = ipInPool(address, pptpStart, pptpEnd)
      const inL2tp = ipInPool(address, l2tpStart, l2tpEnd)
      const allowed = user.type === 'pptp' ? inPptp : user.type === 'all' ? inPptp || inL2tp : inL2tp
      if (!allowed) return '分配 IP 必须在起始和结束地址之间'
    }
    const routes = parseVpnRoutes(user.routes)
    if (typeof routes === 'string') return routes
    built.push({
      route_arr: routes,
      authenticate: user.type,
      usr: username,
      pwd: user.password,
      remote_addr: address,
      com: user.comment,
    })
  }
  return built
}

function pptpClientError(config: PptpClientConfig): string | null {
  if (!config.enabled) return null
  const server = config.server.trim()
  if (!server) return '服务器地址不能为空'
  if (server.length > 63) return '服务器地址最多 63 个字符'
  if (!isAsciiText(server)) return '服务器地址只支持 ASCII'
  const username = config.username
  const password = config.password
  if (!username.trim()) return '用户名不能为空'
  if (username.length > 32) return '用户名最多 32 个字符'
  if (!isAsciiText(username)) return '用户名只支持 ASCII'
  if (hasForbiddenVpnChar(username)) return '用户名不能包含 \' " \\ #'
  if (!password.trim()) return '密码不能为空'
  if (password.length > 32) return '密码最多 32 个字符'
  if (!isAsciiText(password)) return '密码只支持 ASCII'
  if (hasForbiddenVpnChar(password)) return '密码不能包含 \' " \\ #'
  if (!inRange(config.mppe, 0, 2)) return 'MPPE 加密方式无效'
  if (!inRange(config.routeType, 0, 1)) return '路由模式无效'
  if (config.routeType !== 0) return null
  const seen = new Set<string>()
  for (const route of config.routes) {
    const target = route.target.trim()
    if (!isIpv4(target)) return '静态路由 IP 格式无效'
    if (!isContiguousNetmask(route.netmask)) return '静态路由子网掩码格式无效'
    if (seen.has(target)) return '该 IP 已存在'
    seen.add(target)
  }
  return null
}

function formatUnix(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function clockError(hour: number, minute: number): string | null {
  if (!Number.isInteger(hour)) return '小时不能为空!'
  if (!inRange(hour, 0, 23)) return '小时范围只能为0-23!'
  if (!Number.isInteger(minute)) return '分钟不能为空!'
  if (!inRange(minute, 0, 59)) return '分钟范围只能为0-59!'
  return null
}

function scheRebootError(config: ScheRebootConfig): string | null {
  if (!inRange(config.mode, 0, 2)) return '重启模式无效'
  if (config.mode === 1) {
    const clock = clockError(config.remainHour, config.remainMinute)
    if (clock) return clock
    if (config.remainHour * 3600 + config.remainMinute * 60 < 600) return '不能少于10分钟!'
  }
  if (config.mode === 2) {
    if (config.weeks === 0) return '请选择指定星期!'
    const clock = clockError(config.hour, config.minute)
    if (clock) return clock
  }
  return null
}

function ntpServers(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : []
  return [0, 1, 2].map((index) => text(rows[index]))
}

function wifiAdvancedError(config: WifiAdvancedConfig): string | null {
  if (!inRange(config.bgprotectMode, 0, 2)) return 'BG 保护模式无效'
  if (!inRange(config.beacon, 20, 1024)) return 'Beacon 间隔范围是 20–1024'
  if (!inRange(config.dtim, 1, 255)) return 'DTIM 范围是 1–255'
  if (!inRange(config.rtsThreshold, 1, 2347)) return 'RTS 阈值范围是 1–2347'
  if (!inRange(config.fragThreshold, 256, 2346)) return '分片阈值范围是 256–2346'
  if (!inRange(config.txBurst, 0, 1)) return 'TX Burst 无效'
  if (!inRange(config.txPreamble, 0, 2)) return '前导码类型无效'
  if (!inRange(config.wmm, 0, 1)) return 'WMM 无效'
  return null
}

function dnsArr(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => text(item)).filter(Boolean)
}

function parseQuickSetting(body: Record<string, unknown>): QuickSettingState {
  const ssid = record(body.ssid_config)
  const proto = text(body.proto)
  const wanProto: QuickSettingWan['proto'] =
    proto === 'static' || proto === 'pppoe' ? proto : 'dhcp'
  return {
    firstBoot: num(body.first_boot) ?? 0,
    speed: num(body.speed),
    wan: {
      wanType: text(body.wan_type) === 'mobile' ? 'mobile' : 'wired',
      proto: wanProto,
      hostName: text(body.host_name),
      ipAddr: statusIp(body.ip_addr),
      subnetMask: statusIp(body.subnet_mask),
      gateway: statusIp(body.gateway),
      dns: dnsArr(body.dns_arr),
      username: text(body.usr),
      password: text(body.pwd),
      ac: text(body.ac),
      service: text(body.service),
      useApn: num(body.use_apn),
      apnName: text(body.apn_name),
      apnUser: text(body.apn_usr),
      apnPassword: text(body.apn_pwd),
      authType: num(body.auth_type),
    },
    wifi: {
      ssid2g: text(ssid.ssid_2g),
      encry2g: num(ssid.encry_2g) ?? 0,
      passphrase2g: text(ssid.passphrase_2g),
    },
  }
}

function quickSettingWanPayload(wan: QuickSettingWan): Record<string, unknown> {
  if (wan.wanType === 'mobile') {
    if (wan.useApn === 1) {
      return {
        wan_type: 'mobile',
        use_apn: 1,
        apn_name: wan.apnName || '',
        apn_usr: wan.apnUser || '',
        apn_pwd: wan.apnPassword || '',
        auth_type: wan.authType ?? 0,
        proto: 'dhcp',
      }
    }
    return { wan_type: 'mobile', use_apn: 0, proto: 'dhcp' }
  }
  if (wan.proto === 'dhcp') {
    return { wan_type: 'wired', proto: 'dhcp', host_name: wan.hostName || '' }
  }
  if (wan.proto === 'static') {
    return {
      wan_type: 'wired',
      proto: 'static',
      ip_addr: wan.ipAddr || '',
      subnet_mask: wan.subnetMask || '',
      gateway: wan.gateway || '',
      dns_arr: wan.dns,
    }
  }
  return {
    wan_type: 'wired',
    proto: 'pppoe',
    usr: wan.username || '',
    pwd: wan.password || '',
    ac: wan.ac || '',
    service: wan.service || '',
  }
}

function quickSettingWifiPayload(wifi: QuickSettingWifi): Record<string, unknown> {
  return {
    ssid_2g: wifi.ssid2g,
    encry_2g: wifi.encry2g,
    passphrase_2g: wifi.encry2g === 0 ? '' : wifi.passphrase2g || '',
  }
}

function leaseSeconds(value: string): number | null {
  const raw = value.trim()
  const hours = /^(\d+)\s*h$/i.exec(raw)
  if (hours) return Number(hours[1]) * 3600
  const minutes = /^(\d+)\s*m$/i.exec(raw)
  if (minutes) return Number(minutes[1]) * 60
  if (/^\d+$/.test(raw)) return Number(raw)
  return null
}

const cgiInFlight = new Map<string, Promise<ApiResponse<HuayiBody>>>()
/** 读类 HYID 短缓存：合并路由 ping 与首页同 HYID，减轻刷新串行重复 */
const cgiCache = new Map<string, { at: number; res: ApiResponse<HuayiBody> }>()
const CGI_READ_CACHE_TTL_MS = 2_500
const CGI_READ_CACHE_HYIDS = new Set<number>([
  HUAYI_HYID.getPreLoginConfig,
  HUAYI_HYID.getNetworkInfo,
  HUAYI_HYID.getAllStaList,
  HUAYI_HYID.getHomeSystemInfo,
  HUAYI_HYID.getHomeNetworkInfo,
])

function cgiRequestKey(url: string, hyid: number, extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return `${url}#${hyid}`
  const ordered = Object.keys(extra)
    .sort()
    .map((k) => `${k}=${JSON.stringify(extra[k])}`)
    .join('&')
  return `${url}#${hyid}?${ordered}`
}

function canCacheCgiRead(hyid: number, extra?: Record<string, unknown>): boolean {
  return CGI_READ_CACHE_HYIDS.has(hyid) && (!extra || Object.keys(extra).length === 0)
}

async function postHuayi(hyid: number, extra?: Record<string, unknown>): Promise<ApiResponse<HuayiBody>> {
  return postCgi(HUAYI_CGI, hyid, extra)
}

async function postModem(hyid: number, extra?: Record<string, unknown>): Promise<ApiResponse<HuayiBody>> {
  return postCgi(MODEM_CGI, hyid, extra)
}

async function postCgi(
  url: string,
  hyid: number,
  extra?: Record<string, unknown>,
): Promise<ApiResponse<HuayiBody>> {
  const key = cgiRequestKey(url, hyid, extra)
  if (canCacheCgiRead(hyid, extra)) {
    const hit = cgiCache.get(key)
    if (hit && Date.now() - hit.at < CGI_READ_CACHE_TTL_MS) return hit.res
  }
  const pending = cgiInFlight.get(key)
  if (pending) return pending

  const flight = (async () => {
    const res = await requestJson<HuayiBody>(url, {
      method: 'POST',
      timeoutMs: 20_000,
      body: { ...extra, HYID: hyid },
    })
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode === 2000) {
      if (canCacheCgiRead(hyid, extra)) cgiCache.set(key, { at: Date.now(), res })
      return res
    }
    if (errcode === 4001) return failure('UNAUTHORIZED', '会话无效或已过期，请重新登录', res.data)
    return failure('INTERNAL', `原厂 CGI 失败（${errcode ?? 'unknown'}）`, res.data)
  })()

  cgiInFlight.set(key, flight)
  try {
    return await flight
  } finally {
    if (cgiInFlight.get(key) === flight) cgiInFlight.delete(key)
  }
}

function blank(value: unknown): string {
  return text(value).trim()
}

function statusIp(value: unknown): string | undefined {
  const raw = blank(value)
  if (!raw || raw === '0.0.0.0') return undefined
  return raw
}

function dnsFromWanStatus(wan: Record<string, unknown>): string[] {
  const dns = wan.dns_server_addr_addr
  if (Array.isArray(dns)) return dns.map((item) => blank(item)).filter(Boolean)
  const single = blank(dns)
  return single ? [single] : []
}

function dnsFromWan(body: Record<string, unknown>): string[] {
  const raw = Array.isArray(body.dns_arr) ? body.dns_arr : Array.isArray(body.dns_usb_arr) ? body.dns_usb_arr : []
  return raw.map((item) => text(item).trim()).filter(Boolean)
}

function samePayload(current: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  return Object.entries(payload).every(([key, value]) => {
    if (typeof value === 'boolean') return enabledFlag(current[key]) === value
    if (key === 'mac_addr') return blank(current[key]).toUpperCase() === blank(value).toUpperCase()
    if (key === 'dns_arr' && Array.isArray(value)) {
      const list = Array.isArray(current.dns_arr)
        ? current.dns_arr
        : Array.isArray(current.dns_usb_arr)
          ? current.dns_usb_arr
          : []
      const normalized = list.map((item) => text(item).trim()).filter(Boolean)
      return normalized.length === value.length && normalized.every((item, index) => item === value[index])
    }
    return blank(current[key]) === blank(value)
  })
}

const APPLIED: ConfigApplyResult = { accepted: true, rollbackSec: 0 }
const RESTORE_MAX_BYTES = 2 * 1024 * 1024

const HWMODE_BY_MODE: Partial<Record<WifiMode, number>> = {
  '11bg': 0,
  '11b': 1,
  '11g': 4,
  '11n': 6,
  '11bgn': 9,
}

function securityFromAuth(authMode: string, encryp: number | undefined): WifiSecurity {
  switch (authMode) {
    case 'disable':
      return 'none'
    case 'WPAPSK':
      return 'wpa-psk'
    case 'WPA2PSK':
      return 'wpa2-psk'
    case 'WPAPSKWPA2PSK':
      return 'wpa-wpa2-psk'
    default:
      return encryp === 0 ? 'none' : 'wpa-wpa2-psk'
  }
}

function authFromSecurity(security: WifiSecurity): string | null {
  switch (security) {
    case 'none':
      return 'disable'
    case 'wpa-psk':
      return 'WPAPSK'
    case 'wpa2-psk':
      return 'WPA2PSK'
    case 'wpa-wpa2-psk':
      return 'WPAPSKWPA2PSK'
    default:
      return null
  }
}

function cipherFromFactory(value: string): WifiCipher {
  if (value === 'TKIP') return 'tkip'
  if (value === 'TKIPAES') return 'tkipaes'
  return 'aes'
}

function cipherToFactory(value: WifiCipher | undefined): string {
  if (value === 'tkip') return 'TKIP'
  if (value === 'tkipaes') return 'TKIPAES'
  return 'AES'
}

function modeFromHw(hwmode: number | undefined): WifiMode {
  if (hwmode === 0) return '11bg'
  if (hwmode === 1) return '11b'
  if (hwmode === 4) return '11g'
  if (hwmode === 6) return '11n'
  return '11bgn'
}

function htmodeFromBand(band: number | undefined): WifiHtMode {
  if (band === 0) return 'HT20'
  if (band === 2) return 'HT40'
  return 'AUTO'
}

function txPowerFrom(value: number | undefined): WifiTxPowerPercent {
  if (value === 75 || value === 50 || value === 25 || value === 12 || value === 0) return value
  return 100
}

function forbiddenWifiChar(value: string): boolean {
  return /["'`\\]/.test(value)
}

function pause(ms: number): Promise<void> {
  if (import.meta.env.MODE === 'test') return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function detectSpec(type: DiagnosticType): {
  start: number
  poll: number
  stop: number
  flagKey: string
  contentKey: string
} | null {
  if (type === 'ping') {
    return {
      start: HUAYI_HYID.doPingDetect,
      poll: HUAYI_HYID.getPingDetectResult,
      stop: HUAYI_HYID.stopPingDetect,
      flagKey: 'ping_detct',
      contentKey: 'action_content',
    }
  }
  if (type === 'traceroute') {
    return {
      start: HUAYI_HYID.doTracertDetect,
      poll: HUAYI_HYID.getTracertDetectResult,
      stop: HUAYI_HYID.stopTracertDetect,
      flagKey: 'tracert_detect',
      contentKey: 'action_content',
    }
  }
  if (type === 'dhcp') {
    return {
      start: HUAYI_HYID.doDhcpDetect,
      poll: HUAYI_HYID.getDhcpDetectResult,
      stop: HUAYI_HYID.stopDhcpDetect,
      flagKey: 'ping_detct',
      contentKey: 'action_arr',
    }
  }
  return null
}

function detectServers(content: unknown): DhcpDetectServer[] {
  if (!Array.isArray(content)) return []
  return content.map((item) => {
    if (typeof item === 'string') return { ip: item, mac: '' }
    const row = record(item)
    return { ip: text(row.ip_addr), mac: text(row.mac_addr) }
  })
}

function detectOutput(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .filter(Boolean)
      .join('\n')
  }
  return text(content)
}

async function readDetectSnapshot(
  hyid: number,
  flagKey: string,
  contentKey: string,
): Promise<ApiResponse<DiagnosticPoll>> {
  const res = await postHuayi(hyid)
  if (!res.ok) return res
  const body = record(res.data.huayi_r)
  const flag = num(body[flagKey]) ?? 0
  const content = body[contentKey]
  return success({
    flag,
    running: flag === 1,
    output: detectOutput(content),
    servers: detectServers(content),
  })
}

async function pollDetect(
  hyid: number,
  flagKey: string,
  contentKey: string,
  waitMs: number,
): Promise<ApiResponse<{ flag: number; text: string }>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await pause(waitMs)
    const res = await postHuayi(hyid)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    const flag = num(body[flagKey])
    const content = body[contentKey]
    const output = Array.isArray(content)
      ? content.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).filter(Boolean).join('\n')
      : text(content)
    if (flag === 0 || flag === 2) return success({ flag, text: output })
  }
  return failure('TIMEOUT', '检测超时')
}

/**
 * 生产适配器只面对原厂 CGI。
 * 用户名原样提交，不把 admin 改写成 root。
 * 只有契约里 captured 的动作才会发 HTTP。
 */
export class FactoryCgiAdapter implements RouterAPI {
  async getPreLoginConfig(): Promise<ApiResponse<PreLoginConfig>> {
    const res = await postHuayi(HUAYI_HYID.getPreLoginConfig)
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode !== 2000) return failure('INTERNAL', `预登录配置失败（${errcode ?? 'unknown'}）`, res.data)
    const body = record(res.data.huayi_r)
    return success({
      firstBoot: num(body.first_boot) ?? 0,
      needAuthorized: num(body.need_authorized) ?? 1,
      companyName: text(body.company_name) || undefined,
      sysMode: num(body.sysmode),
    })
  }
  async login(params: LoginParams): Promise<ApiResponse<LoginResult>> {
    if (authBypassEnabled()) {
      return success<LoginResult>({ token: 'factory-dev-bypass', expiresIn: 86400 })
    }
    const res = await requestJson<HuayiBody>(HUAYI_CGI, {
      method: 'POST',
      timeoutMs: 20_000,
      body: {
        hy_username: params.username.trim(),
        hy_userpwd: md5Hex(params.password),
        HYID: HUAYI_HYID.doLoginAuth,
      },
    })
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode === 2000) return success({ token: HUAYI_SESSION_MARKER, expiresIn: 0 })
    return failure(loginErrorCode(errcode), loginErrorMessage(errcode), res.data)
  }
  async logout(): Promise<ApiResponse<null>> {
    if (authBypassEnabled()) return success(null)
    const res = await requestJson<HuayiBody>(HUAYI_CGI, {
      method: 'POST',
      timeoutMs: 20_000,
      body: { HYID: HUAYI_HYID.doHuayiLogout },
    })
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode === 2000) return success(null)
    return failure('INTERNAL', `登出失败（${errcode ?? 'unknown'}）`, res.data)
  }
  async getQuickSetting(): Promise<ApiResponse<QuickSettingState>> {
    const res = await postHuayi(HUAYI_HYID.getQuickSettingConfig)
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode !== 2000) return failure('INTERNAL', `读取向导失败（${errcode ?? 'unknown'}）`, res.data)
    return success(parseQuickSetting(record(res.data.huayi_r)))
  }
  async applyQuickSetting(
    wan: QuickSettingWan,
    wifi: QuickSettingWifi,
  ): Promise<ApiResponse<QuickSettingApplyResult>> {
    if (!wifi.ssid2g.trim()) return failure('VALIDATION', 'SSID 不能为空')
    if (wifi.encry2g !== 0 && (wifi.passphrase2g || '').length < 8) {
      return failure('VALIDATION', '无线密码至少 8 位')
    }
    const res = await postHuayi(HUAYI_HYID.setQuickSettingConfig, {
      ...quickSettingWanPayload(wan),
      ...quickSettingWifiPayload(wifi),
    })
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode !== 2000) return failure('INTERNAL', `向导保存失败（${errcode ?? 'unknown'}）`, res.data)
    const data = record(res.data)
    return success({
      progressSec: num(data.progresstime) ?? 0,
      reconnect: enabledFlag(data.reconnection),
      reconnectIp: text(data.reconnection_addr),
    })
  }
  async completeWizardFirstBoot(): Promise<ApiResponse<null>> {
    const res = await postHuayi(HUAYI_HYID.setFirstBoot, { first_boot: 0 })
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode !== 2000) return failure('INTERNAL', `关闭向导失败（${errcode ?? 'unknown'}）`, res.data)
    return success(null)
  }
  async ping(): Promise<ApiResponse<{ latencyMs: number }>> {
    if (authBypassEnabled()) return success({ latencyMs: 0 })
    const started = Date.now()
    const res = await postHuayi(HUAYI_HYID.getHomeSystemInfo)
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode !== 2000) {
      return failure(
        errcode === 4001 ? 'UNAUTHORIZED' : 'INTERNAL',
        errcode === 4001 ? '会话无效或已过期，请重新登录' : `会话探测失败（${errcode ?? 'unknown'}）`,
        res.data,
      )
    }
    return success({ latencyMs: Date.now() - started })
  }
  async getSystemInfo(): Promise<ApiResponse<SystemInfo>> {
    const res = await postHuayi(HUAYI_HYID.getHomeSystemInfo)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    return success({
      model: text(body.pro_name),
      hostname: '',
      firmware: text(body.fw_version),
      kernel: '',
      domain: blank(body.domain) || undefined,
      deviceNumber: blank(body.device_umber) || undefined,
      uptimeSec: num(body.uptime) ?? 0,
      localTime: text(body.time_day),
      cpuLoad: [],
      memTotalKb: 0,
      memFreeKb: 0,
      flashTotalKb: 0,
      flashFreeKb: 0,
    })
  }
  async getDeviceInfo(): Promise<ApiResponse<DeviceInfo>> {
    const res = await postHuayi(HUAYI_HYID.getDeviceInfo)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    return success({
      productName: text(body.product_name),
      productModel: text(body.product_model),
      softwareVersion: text(body.software_version),
      webuiVersion: text(body.webui_version),
      lanMac: text(body.lan_mac),
      wanIp: blank(body.ip_address),
    })
  }
  async getSystemStatus(): Promise<ApiResponse<SystemStatus>> {
    const res = await postHuayi(HUAYI_HYID.getHomeSystemInfo)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    return success({
      cpuPercent: 0,
      memoryPercent: 0,
      uptimeSec: num(body.uptime) ?? 0,
      interfaces: [],
      wirelessClients: 0,
      wiredClients: 0,
    })
  }
  async getWanStatus(): Promise<ApiResponse<WanStatus>> {
    const res = await postHuayi(HUAYI_HYID.getNetworkInfo)
    if (!res.ok) return res
    const wan = record(record(res.data.huayi_r).wan_infos)
    const linkUp = num(wan.link) === 1
    return success({
      name: 'wan',
      label: 'WAN',
      up: linkUp,
      connected: linkUp,
      proto: text(wan.net_type),
      ipv4: statusIp(wan.ip_addr),
      netmask: statusIp(wan.subnet_mask),
      gateway: statusIp(wan.gateway),
      dns: dnsFromWanStatus(wan),
      mac: blank(wan.mac_addr) || undefined,
      mtu: num(wan.mtu_num),
      rxBytes: num(wan.rx_bytes) ?? 0,
      txBytes: num(wan.tx_bytes) ?? 0,
      rxRateBps: num(wan.rx_bps) ?? 0,
      txRateBps: num(wan.tx_bps) ?? 0,
    })
  }
  async getWanConfig(): Promise<ApiResponse<WanConfig>> {
    const [res, userRes] = await Promise.all([
      postModem(MODEM_HYID.getWanConfig),
      postHuayi(HUAYI_HYID.getCurrentUserInfo),
    ])
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    const proto = text(body.proto)
    if (proto !== 'dhcp' && proto !== 'static' && proto !== 'pppoe') {
      return failure('INTERNAL', '未知的 WAN 协议')
    }
    const ccMtu = num(body.cc_mtu) ?? 1500
    const pppMtu = num(body.ppp_mtu) ?? 1492
    const macaddr = blank(body.mac_addr)
    const defaultMac = blank(body.def_mac_addr) || macaddr
    const clientMac = userRes.ok ? blank(record(userRes.data.huayi_r).usr_mac) : ''
    const hostname = blank(body.hostname) || blank(body.host_name)
    return success({
      proto,
      username: text(body.usr),
      password: text(body.pwd),
      ipv4: blank(body.ip_addr),
      netmask: blank(body.subnet_mask),
      gateway: blank(body.gateway),
      dns: dnsFromWan(body),
      mtu: ccMtu,
      hostname,
      macaddr,
      defaultMac: defaultMac || undefined,
      clientMac: clientMac || undefined,
      wanMode: blank(body.wan_mode),
      useApn: num(body.use_apn) ?? 0,
      apnName: text(body.apn_name),
      apnUser: text(body.apn_usr),
      apnPassword: text(body.apn_pwd),
      authType: num(body.auth_type) ?? 0,
      pppMtu,
      ac: text(body.ac),
      service: text(body.service),
    })
  }
  async updateWanConfig(config: WanConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const current = await postModem(MODEM_HYID.getWanConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    const wanMode = config.wanMode || blank(body.wan_mode)
    const mac = (config.macaddr || blank(body.mac_addr)).trim().toUpperCase()
    if (!isMac(mac)) return failure('VALIDATION', 'MAC 地址格式无效')
    let payload: Record<string, unknown>
    if (wanMode === 'mobile') {
      const mtu = config.mtu
      if (!Number.isInteger(mtu) || mtu < 576 || mtu > 1500) return failure('VALIDATION', 'MTU 范围是 576–1500')
      const mobileBase = {
        wan_mode: 'mobile',
        proto: 'dhcp',
        cc_mtu: mtu,
        hostname: config.hostname ?? blank(body.hostname) ?? blank(body.host_name),
        mac_addr: mac,
      }
      if (config.useApn === 1) {
        const apnName = (config.apnName || '').trim()
        if (!apnName) return failure('VALIDATION', '请填写 APN 名称')
        payload = {
          ...mobileBase,
          use_apn: 1,
          apn_name: apnName,
          apn_usr: config.apnUser ?? '',
          apn_pwd: config.apnPassword ?? '',
          auth_type: config.authType ?? 0,
        }
      } else {
        payload = { ...mobileBase, use_apn: 0 }
      }
      if (samePayload(body, payload)) return success(APPLIED)
      const saved = await postModem(MODEM_HYID.setEthWanConfig, payload)
      if (!saved.ok) return saved
      return success(APPLIED)
    }
    if (config.proto === 'static') {
      const ip = (config.ipv4 || '').trim()
      const mask = (config.netmask || '').trim()
      const gateway = (config.gateway || '').trim()
      if (!isIpv4(ip) || !isContiguousNetmask(mask) || !isIpv4(gateway)) {
        return failure('VALIDATION', '静态地址、掩码或网关无效')
      }
      const dns = config.dns.map((item) => item.trim()).filter(Boolean)
      if (dns.some((item) => !isIpv4(item))) return failure('VALIDATION', 'DNS 地址无效')
      if (dns.length >= 2 && dns[0] === dns[1]) return failure('VALIDATION', '两个 DNS 不能相同')
      const mtu = config.mtu
      if (!Number.isInteger(mtu) || mtu < 576 || mtu > 1500) return failure('VALIDATION', 'MTU 范围是 576–1500')
      payload = {
        wan_mode: wanMode,
        proto: 'static',
        ip_addr: ip,
        subnet_mask: mask,
        gateway,
        dns_arr: dns,
        mac_addr: mac,
        cc_mtu: mtu,
      }
    } else if (config.proto === 'pppoe') {
      const username = (config.username || '').trim()
      if (!username) return failure('VALIDATION', '请输入宽带账号')
      const mtu = config.pppMtu ?? config.mtu
      if (!Number.isInteger(mtu) || mtu < 576 || mtu > 1500) return failure('VALIDATION', 'MTU 范围是 576–1500')
      payload = {
        wan_mode: wanMode,
        proto: 'pppoe',
        ppp_mtu: mtu,
        ac: config.ac ?? '',
        service: config.service ?? '',
        mac_addr: mac,
        usr: username,
        pwd: config.password ?? '',
      }
    } else {
      const mtu = config.mtu
      if (!Number.isInteger(mtu) || mtu < 576 || mtu > 1500) return failure('VALIDATION', 'MTU 范围是 576–1500')
      payload = {
        wan_mode: wanMode,
        proto: 'dhcp',
        cc_mtu: mtu,
        hostname: config.hostname ?? blank(body.hostname),
        mac_addr: mac,
      }
    }
    if (samePayload(body, payload)) return success(APPLIED)
    const saved = await postModem(MODEM_HYID.setEthWanConfig, payload)
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  async getLanStatus(): Promise<ApiResponse<LanStatus>> {
    const res = await postHuayi(HUAYI_HYID.getNetworkInfo)
    if (!res.ok) return res
    const lan = record(record(res.data.huayi_r).lan_infos)
    const ipv4 = statusIp(lan.ip_addr)
    return success({
      name: 'lan',
      label: 'LAN',
      up: Boolean(ipv4),
      proto: '',
      ipv4,
      netmask: statusIp(lan.subnet_mask),
      mac: blank(lan.mac_addr) || undefined,
      clientCount: num(lan.client_sum) ?? 0,
      rxBytes: 0,
      txBytes: 0,
    })
  }
  async getLanConfig(): Promise<ApiResponse<LanConfig>> {
    const res = await postHuayi(HUAYI_HYID.getLanConfig)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    return success({
      ipv4: text(body.ip_addr),
      netmask: text(body.subnet_mask),
    })
  }
  async updateLanConfig(config: LanConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const ip = config.ipv4.trim()
    const mask = config.netmask.trim()
    if (!isIpv4(ip) || !isContiguousNetmask(mask)) return failure('VALIDATION', 'LAN 地址或子网掩码无效')
    const current = await postHuayi(HUAYI_HYID.getLanConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    const payload = { ...body, ip_addr: ip, subnet_mask: mask }
    if (blank(body.ip_addr) === ip && blank(body.subnet_mask) === mask) return success(APPLIED)
    const saved = await postHuayi(HUAYI_HYID.setLanConfig, payload)
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  async getDhcpConfig(): Promise<ApiResponse<DhcpConfig>> {
    const res = await postHuayi(HUAYI_HYID.getDhcpsServerConfig)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    const startIp = text(body.start_ip)
    const endIp = text(body.end_ip)
    const lease = num(body.lease_time)
    return success({
      enabled: enabledFlag(body.dhcp_enable),
      start: lastOctet(startIp),
      limit: poolLimit(startIp, endIp),
      leasetime: lease == null ? '' : String(lease),
      gateway: '',
      dns: [],
      leases: [],
      startIp,
      endIp,
      minIp: text(body.min_ip),
      maxIp: text(body.max_ip),
      staticBindings: parseStaticDhcpArr(body.static_dhcp_arr),
    })
  }
  async updateDhcpConfig(config: DhcpConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const seconds = leaseSeconds(config.leasetime)
    if (seconds == null || seconds < 300 || seconds > 604800) {
      return failure('VALIDATION', '租约时间需为 300–604800 秒')
    }
    const current = await postHuayi(HUAYI_HYID.getDhcpsServerConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    const startIp = config.startIp || text(body.start_ip)
    const endIp = config.endIp || endFromStart(startIp, config.limit)
    if (!isIpv4(startIp) || !isIpv4(endIp)) {
      return failure('VALIDATION', '地址池起止地址无效')
    }
    const minIp = text(body.min_ip)
    const maxIp = text(body.max_ip)
    const start = ipv4ToInt(startIp)
    const end = ipv4ToInt(endIp)
    const min = ipv4ToInt(minIp)
    const max = ipv4ToInt(maxIp)
    if (
      start == null ||
      end == null ||
      end < start ||
      (min != null && start < min) ||
      (max != null && end > max)
    ) {
      return failure('VALIDATION', minIp && maxIp ? `地址池需落在 ${minIp}–${maxIp}` : '地址池范围无效')
    }
    const saved = await postHuayi(HUAYI_HYID.setDhcpsServerConfig, {
      ...body,
      dhcp_enable: config.enabled,
      start_ip: startIp,
      end_ip: endIp,
      lease_time: seconds,
    })
    if (!saved.ok) return saved
    return success({ accepted: true, rollbackSec: 0 })
  }
  async updateDhcpStaticBindings(
    bindings: StaticDhcpBinding[],
  ): Promise<ApiResponse<ConfigApplyResult>> {
    const current = await postHuayi(HUAYI_HYID.getDhcpsServerConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    for (const row of bindings) {
      if (!isIpv4(row.ipv4.trim()) || !row.mac.trim()) {
        return failure('VALIDATION', '静态绑定的 IP 或 MAC 无效')
      }
    }
    const saved = await postHuayi(HUAYI_HYID.setDhcpsServerConfig, {
      ...body,
      static_dhcp_arr: staticDhcpPayload(bindings),
    })
    if (!saved.ok) return saved
    return success({ accepted: true, rollbackSec: 0 })
  }
  getDnsConfig() {
    return blocked<DnsConfig>('getDnsConfig')
  }
  updateDnsConfig(config: DnsConfig) {
    void config
    return blocked<ConfigApplyResult>('updateDnsConfig')
  }
  async getWifiStatus(): Promise<ApiResponse<WifiStatus>> {
    const res = await postHuayi(HUAYI_HYID.getHomeNetworkInfo)
    if (!res.ok) return res
    const rows = record(res.data.huayi_r).wireless_arr
    const radio = record(Array.isArray(rows) ? rows[0] : undefined)
    const band = num(radio.band)
    return success({
      iface: '',
      band: '2.4GHz',
      enabled: num(radio.status) === 1,
      ssid: text(radio.ssid),
      channel: num(radio.channel) ?? 0,
      autoChannel: num(radio.auto_channel) === 1,
      txPower: 0,
      clients: num(radio.client_sum) ?? 0,
      security: text(radio.auth_mode),
      mode: band === undefined ? undefined : WIRELESS_BAND[band] || '',
      mac: blank(radio.bssid) || undefined,
    })
  }
  async getPhysicalPorts(): Promise<ApiResponse<PhysicalPortStatus[]>> {
    const res = await postHuayi(HUAYI_HYID.getHomeNetworkInfo)
    if (!res.ok) return res
    return success(parsePhysicalPorts(record(res.data.huayi_r)))
  }
  async getWifiConfig(): Promise<ApiResponse<WifiConfig>> {
    const res = await postHuayi(HUAYI_HYID.getWirelessBasicConfig, { wifi_radio: WIFI_RADIO_24 })
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    const channel = num(body.channel) ?? 0
    const power = num(body.tx_power)
    return success({
      enabled: num(body.wifi_admin) === 1,
      ssid: text(body.ssid),
      hidden: num(body.hidden) === 1,
      channel: channel === 0 ? 'auto' : channel,
      txPower: power ?? 0,
      security: securityFromAuth(text(body.auth_mode), num(body.encryp)),
      password: text(body.key),
      cipher: cipherFromFactory(text(body.cipher_mode)),
      mode: modeFromHw(num(body.hwmode)),
      htmode: htmodeFromBand(num(body.band)),
      txpowerPercent: txPowerFrom(power),
      maxClients: num(body.max_num) ?? 0,
      isolate: num(body.noforward) === 1,
    })
  }
  async updateWifiConfig(config: WifiConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const current = await postHuayi(HUAYI_HYID.getWirelessBasicConfig, { wifi_radio: WIFI_RADIO_24 })
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    if (!config.enabled) {
      if (num(body.wifi_admin) === 0) return success(APPLIED)
      const saved = await postHuayi(HUAYI_HYID.setWirelessBasicConfig, {
        ...body,
        wifi_admin: 0,
        wifi_radio: WIFI_RADIO_24,
      })
      if (!saved.ok) return saved
      return success(APPLIED)
    }
    const ssid = config.ssid.trim()
    if (!ssid) return failure('VALIDATION', 'SSID 不能为空')
    if (ssid.length > 32) return failure('VALIDATION', 'SSID 最多 32 个字符')
    if (forbiddenWifiChar(ssid)) return failure('VALIDATION', 'SSID 不能包含 " \' ` \\')
    const maxClients = config.maxClients ?? 0
    if (!Number.isInteger(maxClients) || maxClients < 1 || maxClients > 32) {
      return failure('VALIDATION', '最大终端数范围是 1–32')
    }
    const mode = config.mode || '11bgn'
    const hwmode = HWMODE_BY_MODE[mode]
    if (hwmode === undefined) return failure('VALIDATION', '当前原厂不支持此无线模式')
    const bandwidthChoice = hwmode === 6 || hwmode === 9 || hwmode === 8
    let band = num(body.band) ?? 1
    if (bandwidthChoice) {
      if (config.htmode === 'HT20') band = 0
      else if (config.htmode === 'AUTO' || config.htmode == null) band = 1
      else return failure('VALIDATION', '当前模式只支持 AUTO 或 20M')
    }
    const channelRaw = config.channel
    const channel = channelRaw === 'auto' || channelRaw === 0 ? 0 : Number(channelRaw)
    if (!Number.isInteger(channel) || channel < 0 || channel > 13) return failure('VALIDATION', '信道无效')
    const power = config.txpowerPercent ?? config.txPower
    if (power !== 100 && power !== 75 && power !== 50 && power !== 25 && power !== 12 && power !== 0) {
      return failure('VALIDATION', '发射功率无效')
    }
    const hasAuth = typeof body.auth_mode === 'string' && body.auth_mode !== ''
    const authMode = authFromSecurity(config.security)
    if (hasAuth && !authMode) return failure('VALIDATION', '当前设备不支持该加密方式')
    const encrypted = hasAuth ? authMode !== 'disable' : num(body.encryp) !== 0 && config.security !== 'none'
    let key = text(body.key)
    if (encrypted) {
      key = config.password || ''
      if (key.length < 8) return failure('VALIDATION', '密码至少 8 位')
      if (key.length > 63) return failure('VALIDATION', '密码最多 63 位')
      if (!isAsciiText(key) || forbiddenWifiChar(key)) return failure('VALIDATION', '密码只支持 ASCII，且不能包含 " \' ` \\')
    }
    const payload: Record<string, unknown> = {
      wifi_admin: 1,
      noforward: config.isolate ? 1 : 0,
      band_steering: num(body.band_steering) ?? 0,
      hwmode,
      band,
      channel,
      hidden: config.hidden ? 1 : 0,
      tx_power: power,
      ssid,
      max_num: maxClients,
      wifi_radio: WIFI_RADIO_24,
    }
    if (hasAuth) {
      payload.auth_mode = authMode
      payload.cipher_mode = authMode === 'disable' ? text(body.cipher_mode) : cipherToFactory(config.cipher)
      payload.key = authMode === 'disable' ? text(body.key) : key
    } else {
      payload.encryp = config.security === 'none' ? 0 : 1
      payload.key = config.security === 'none' ? text(body.key) : key
    }
    const comparable = { ...payload }
    delete comparable.wifi_radio
    if (samePayload(body, comparable)) return success(APPLIED)
    const saved = await postHuayi(HUAYI_HYID.setWirelessBasicConfig, payload)
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  getWirelessClients() {
    return blocked<WirelessClient[]>('getWirelessClients')
  }
  async getConnectedDevices(): Promise<ApiResponse<ConnectedDevice[]>> {
    const res = await postHuayi(HUAYI_HYID.getAllStaList)
    if (!res.ok) return res
    const rows = record(res.data.huayi_r).staline_arr
    const list = Array.isArray(rows) ? rows : []
    return success(
      list.map((item, index) => {
        const row = record(item)
        const mac = text(row.mac_addr)
        return {
          id: mac || String(index),
          mac,
          ipv4: text(row.ip_addr),
          hostname: text(row.host_name),
          interface: '',
          online: true,
          rxBytes: 0,
          txBytes: 0,
          lastSeen: '',
        }
      }),
    )
  }
  async getDeviceAclList(): Promise<ApiResponse<DeviceAclEntry[]>> {
    const res = await postHuayi(HUAYI_HYID.getAclList)
    if (!res.ok) return res
    const rows = record(res.data.huayi_r).acl_arr
    const list = Array.isArray(rows) ? rows : []
    return success(
      list
        .map((item) => {
          const mac = text(record(item).acl_addr)
          return mac ? { mac } : null
        })
        .filter((row): row is DeviceAclEntry => row != null),
    )
  }
  async addDeviceAcl(mac: string): Promise<ApiResponse<null>> {
    const addr = mac.trim()
    if (!addr) return failure('VALIDATION', 'MAC 不能为空')
    const res = await postHuayi(HUAYI_HYID.addAclList, { acl_addr: addr })
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode !== 2000) return failure('INTERNAL', `加入 ACL 失败（${errcode ?? 'unknown'}）`, res.data)
    return success(null)
  }
  async removeDeviceAcl(mac: string): Promise<ApiResponse<null>> {
    const addr = mac.trim()
    if (!addr) return failure('VALIDATION', 'MAC 不能为空')
    const res = await postHuayi(HUAYI_HYID.deleteAclList, { acl_addr: addr })
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode !== 2000) return failure('INTERNAL', `移除 ACL 失败（${errcode ?? 'unknown'}）`, res.data)
    return success(null)
  }
  getFirewallRules() {
    return blocked<FirewallRule[]>('getFirewallRules')
  }
  updateFirewallRules(rules: FirewallRule[]) {
    void rules
    return blocked<ConfigApplyResult>('updateFirewallRules')
  }
  getPortForwards() {
    return blocked<PortForwardRule[]>('getPortForwards')
  }
  updatePortForwards(rules: PortForwardRule[]) {
    void rules
    return blocked<ConfigApplyResult>('updatePortForwards')
  }
  getDmzConfig() {
    return blocked<import('../types').DmzConfig>('getDmzConfig')
  }
  updateDmzConfig(config: import('../types').DmzConfig) {
    void config
    return blocked<ConfigApplyResult>('updateDmzConfig')
  }
  getUpnpConfig() {
    return blocked<import('../types').UpnpConfig>('getUpnpConfig')
  }
  updateUpnpConfig(config: import('../types').UpnpConfig) {
    void config
    return blocked<ConfigApplyResult>('updateUpnpConfig')
  }
  getDdnsConfig() {
    return blocked<import('../types').DdnsConfig>('getDdnsConfig')
  }
  updateDdnsConfig(config: import('../types').DdnsConfig) {
    void config
    return blocked<ConfigApplyResult>('updateDdnsConfig')
  }
  getSystemCapabilities() {
    return blocked<import('../types').NativeCapabilities>('getSystemCapabilities')
  }
  getWireGuardClient() {
    return blocked<import('../types').WireGuardClientConfig>('getWireGuardClient')
  }
  updateWireGuardClient(config: import('../types').WireGuardClientConfig) {
    void config
    return blocked<ConfigApplyResult>('updateWireGuardClient')
  }
  importWireGuardClient(text: string) {
    void text
    return blocked<import('../types').WireGuardImportResult>('importWireGuardClient')
  }
  getWireGuardStatus() {
    return blocked<import('../types').WireGuardStatus>('getWireGuardStatus')
  }
  getStaticRoutes() {
    return blocked<import('../types').NetworkStaticRoute[]>('getStaticRoutes')
  }
  updateStaticRoutes(routes: import('../types').NetworkStaticRoute[]) {
    void routes
    return blocked<ConfigApplyResult>('updateStaticRoutes')
  }
  getQosCapability() {
    return blocked<QosCapability>('getQosCapability')
  }
  getQosConfig() {
    return blocked<QosConfig>('getQosConfig')
  }
  updateQosConfig(config: QosConfig) {
    void config
    return blocked<ConfigApplyResult>('updateQosConfig')
  }
  getWifiSecondaryConfig() {
    return blocked<WifiSecondaryConfig>('getWifiSecondaryConfig')
  }
  updateWifiSecondaryConfig(config: WifiSecondaryConfig) {
    void config
    return blocked<ConfigApplyResult>('updateWifiSecondaryConfig')
  }
  async getWifiAdvanced(): Promise<ApiResponse<WifiAdvancedConfig>> {
    const [basic, adv] = await Promise.all([
      postHuayi(HUAYI_HYID.getWirelessBasicConfig, { wifi_radio: WIFI_RADIO_24 }),
      postHuayi(HUAYI_HYID.getWirelessAdvCfg, { wifi_radio: WIFI_RADIO_24 }),
    ])
    if (!adv.ok) return adv
    if (!basic.ok) return basic
    const radio = record(basic.data.huayi_r)
    const body = record(adv.data.huayi_r)
    return success({
      radioOn: num(radio.wifi_admin) === 1,
      bgprotectMode: num(body.bgprotect_mode) ?? 0,
      beacon: num(body.beacon) ?? 100,
      dtim: num(body.dtim) ?? 1,
      rtsThreshold: num(body.rts_thres) ?? 2347,
      fragThreshold: num(body.frag_thres) ?? 2346,
      txBurst: num(body.tx_burst) ?? 0,
      txPreamble: num(body.tx_preamble) ?? 2,
      wmm: num(body.wmm) ?? 1,
    })
  }
  async updateWifiAdvanced(config: WifiAdvancedConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const invalid = wifiAdvancedError(config)
    if (invalid) return failure('VALIDATION', invalid)
    const current = await postHuayi(HUAYI_HYID.getWirelessAdvCfg, { wifi_radio: WIFI_RADIO_24 })
    if (!current.ok) return current
    const saved = await postHuayi(HUAYI_HYID.setWirelessAdvCfg, {
      ...record(current.data.huayi_r),
      wifi_radio: WIFI_RADIO_24,
      bgprotect_mode: config.bgprotectMode,
      beacon: config.beacon,
      dtim: config.dtim,
      rts_thres: config.rtsThreshold,
      frag_thres: config.fragThreshold,
      tx_burst: config.txBurst,
      tx_preamble: config.txPreamble,
      wmm: config.wmm,
    })
    if (!saved.ok) return saved
    return success({ accepted: true, rollbackSec: 0 })
  }
  async getPptpClient(): Promise<ApiResponse<PptpClientConfig>> {
    const res = await postHuayi(HUAYI_HYID.getPptpClientConfig)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    return success({
      enabled: enabledFlag(body.pptp_enable),
      status: num(body.pptp_status) ?? 0,
      address: text(body.pptp_addr),
      server: text(body.server_addr),
      username: text(body.usr),
      password: text(body.pwd),
      mppe: num(body.mppe) ?? 0,
      routeType: num(body.route_type) ?? 0,
      routes: pptpRoutes(body.pptp_static_arr),
    })
  }
  async updatePptpClient(config: PptpClientConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const invalid = pptpClientError(config)
    if (invalid) return failure('VALIDATION', invalid)
    const current = await postHuayi(HUAYI_HYID.getPptpClientConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    const payload = config.enabled
      ? {
          ...body,
          pptp_enable: true,
          server_addr: config.server.trim(),
          usr: config.username,
          pwd: config.password,
          mppe: config.mppe,
          route_type: config.routeType,
          pptp_static_arr: config.routes.map((route) => ({
            target: route.target.trim(),
            subnet_mask: route.netmask.trim(),
          })),
        }
      : { ...body, pptp_enable: false }
    const saved = await postHuayi(HUAYI_HYID.setPptpClientConfig, payload)
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  async getPptpServer(): Promise<ApiResponse<VpnServerConfig>> {
    const res = await postHuayi(HUAYI_HYID.getPptpServerConfig)
    if (!res.ok) return res
    return success(vpnServerFrom(record(res.data.huayi_r), 'pptpd_enable'))
  }
  async updatePptpServer(config: VpnServerConfig): Promise<ApiResponse<ConfigApplyResult>> {
    return saveVpnServer(config, {
      getId: HUAYI_HYID.getPptpServerConfig,
      setId: HUAYI_HYID.setPptpServerConfig,
      enableKey: 'pptpd_enable',
      startKey: 'pptpd_start_addr',
      endKey: 'pptpd_end_addr',
      otherStartKey: 'xl2tpd_start_addr',
      otherEndKey: 'xl2tpd_end_addr',
      conflict: '地址池与 L2TP 冲突',
      withMppe: true,
    })
  }
  async getL2tpServer(): Promise<ApiResponse<VpnServerConfig>> {
    const res = await postHuayi(HUAYI_HYID.getL2tpServerConfig)
    if (!res.ok) return res
    return success(vpnServerFrom(record(res.data.huayi_r), 'xl2tpd_enable'))
  }
  async updateL2tpServer(config: VpnServerConfig): Promise<ApiResponse<ConfigApplyResult>> {
    if (config.enabled && config.ipsecEnabled && !config.ipsecKey?.trim()) {
      return failure('VALIDATION', '请填写 IPSec 密钥')
    }
    return saveVpnServer(config, {
      getId: HUAYI_HYID.getL2tpServerConfig,
      setId: HUAYI_HYID.setL2tpServerConfig,
      enableKey: 'xl2tpd_enable',
      startKey: 'xl2tpd_start_addr',
      endKey: 'xl2tpd_end_addr',
      otherStartKey: 'pptpd_start_addr',
      otherEndKey: 'pptpd_end_addr',
      conflict: '地址池与 PPTP 冲突',
      withMppe: false,
    })
  }
  async getVpnUsers(): Promise<ApiResponse<VpnUserConfig>> {
    const res = await postHuayi(HUAYI_HYID.getVpnUserConfig)
    if (!res.ok) return res
    return success(vpnUsersFrom(record(res.data.huayi_r)))
  }
  async updateVpnUsers(config: VpnUserConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const current = await postHuayi(HUAYI_HYID.getVpnUserConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    const built = vpnUsersPayload(config.users, body)
    if (typeof built === 'string') return failure('VALIDATION', built)
    const previous = Array.isArray(body.vpnusr_arr) ? body.vpnusr_arr : []
    if (JSON.stringify(previous) === JSON.stringify(built)) return success(APPLIED)
    const saved = await postHuayi(HUAYI_HYID.setVpnUserConfig, { vpnusr_arr: built })
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  async getL2tpClient(): Promise<ApiResponse<L2tpClientConfig>> {
    const res = await postHuayi(HUAYI_HYID.getL2tpClientConfig)
    if (!res.ok) return res
    return success(l2tpClientFrom(record(res.data.huayi_r)))
  }
  async updateL2tpClient(config: L2tpClientConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const current = await postHuayi(HUAYI_HYID.getL2tpClientConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    if (!config.enabled) {
      if (!enabledFlag(body.xl2tp_enable)) return success(APPLIED)
      const saved = await postHuayi(HUAYI_HYID.setL2tpClientConfig, { xl2tp_enable: false })
      if (!saved.ok) return saved
      return success(APPLIED)
    }
    if (enabledFlag(body.xl2tpd_enable)) {
      return failure('VALIDATION', 'L2TP 当前工作在服务器模式，客户端暂不可用')
    }
    const invalid = l2tpClientError(config)
    if (invalid) return failure('VALIDATION', invalid)
    const payload = {
      ...body,
      xl2tp_enable: true,
      server_addr: config.server.trim(),
      usr: config.username,
      pwd: config.password,
      ipsec_key: config.ipsecKey,
    }
    if (samePayload(body, payload)) return success(APPLIED)
    const saved = await postHuayi(HUAYI_HYID.setL2tpClientConfig, payload)
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  async getVpnStatus(): Promise<ApiResponse<VpnOnlineUser[]>> {
    const res = await postHuayi(HUAYI_HYID.getVpnUserOnline)
    if (!res.ok) return res
    const rows = record(res.data.huayi_r).usr_arr
    const list = Array.isArray(rows) ? rows : []
    return success(
      list.map((item) => {
        const row = record(item)
        const joined = num(row.jointime) ?? 0
        return {
          pid: text(row.pid),
          username: text(row.account),
          type: text(row.account_type),
          dialIp: text(row.ip_addr),
          assignIp: text(row.device_addr),
          joinedAt: formatUnix(joined),
        }
      }),
    )
  }
  async disconnectVpnUser(pid: string): Promise<ApiResponse<null>> {
    const id = pid.trim()
    if (!id) return failure('VALIDATION', '缺少用户进程号')
    const saved = await postHuayi(HUAYI_HYID.setVpnUserOnline, {
      pid: /^\d+$/.test(id) ? Number(id) : id,
    })
    if (!saved.ok) return saved
    return success(null)
  }
  async getOpenVpn(): Promise<ApiResponse<OpenVpnConfig>> {
    const res = await postHuayi(HUAYI_HYID.getOpenVpnConfig)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    return success({
      enabled: enabledFlag(body.enable),
      status: num(body.status) ?? 2,
      mode: num(body.option) === 1 ? 1 : 0,
      host: text(body.host_name),
      username: text(body.usr),
      password: text(body.pwd),
      port: num(body.port) ?? 0,
      configUploaded: false,
    })
  }
  async updateOpenVpn(config: OpenVpnConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const current = await postHuayi(HUAYI_HYID.getOpenVpnConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    if (!config.enabled) {
      if (!enabledFlag(body.enable)) return success(APPLIED)
      const saved = await postHuayi(HUAYI_HYID.setOpenVpnConfig, { enable: 0 })
      if (!saved.ok) return saved
      return success(APPLIED)
    }
    if (config.mode === 1) {
      if (!config.configUploaded) return failure('VALIDATION', '请先上传配置文件')
      const saved = await postHuayi(HUAYI_HYID.setOpenVpnConfig, { enable: 1, option: 1 })
      if (!saved.ok) return saved
      return success(APPLIED)
    }
    const invalid = openVpnError(config)
    if (invalid) return failure('VALIDATION', invalid)
    const payload = {
      ...body,
      enable: 1,
      option: 0,
      host_name: config.host.trim(),
      usr: config.username,
      pwd: config.password,
      port: config.port,
    }
    if (samePayload(body, payload)) return success(APPLIED)
    const saved = await postHuayi(HUAYI_HYID.setOpenVpnConfig, payload)
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  async uploadOpenVpn(file: File, kind: 'config' | 'cert'): Promise<ApiResponse<ConfigApplyResult>> {
    if (file.size < 1) return failure('VALIDATION', '请选择要上传的文件')
    if (file.size > 1024 * 1024) return failure('VALIDATION', '文件不能大于1M!')
    const name = file.name || ''
    if (kind === 'cert' && !name) return failure('VALIDATION', '认证文件名不能为空')
    if (kind === 'cert' && /[?#&/\\]/.test(name)) return failure('VALIDATION', '认证文件名包含无效字符')
    const url = kind === 'cert' ? `${STREAM_CGI}?streamid=8&name=${name}` : `${STREAM_CGI}?streamid=7`
    const form = new FormData()
    form.append('userfile', file)
    const res = await requestForm<HuayiBody>(url, form)
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode === 2000) return success(APPLIED)
    if (errcode === 4001) return failure('UNAUTHORIZED', '会话无效或已过期，请重新登录', res.data)
    return failure('INTERNAL', `OpenVPN 文件上传失败（${errcode ?? 'unknown'}）`, res.data)
  }
  async getWirelessAcl(): Promise<ApiResponse<WirelessAclConfig>> {
    const res = await postHuayi(HUAYI_HYID.getWirelessAclCfg, { wifi_radio: WIFI_RADIO_24 })
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    const admin = num(body.wifi_admin) ?? 0
    const mode = admin === 1 ? 'allow' : admin === 2 ? 'deny' : 'disable'
    const policy = mode === 'allow' ? 'allow' : 'deny'
    const rows = Array.isArray(body.macfilter_arr) ? body.macfilter_arr : []
    return success({
      mode,
      entries: rows
        .map((item) => {
          const mac = text(record(item).mac_addr)
          return mac ? { id: mac, mac, policy } : null
        })
        .filter((item): item is WirelessAclEntry => Boolean(item)),
    })
  }
  async updateWirelessAcl(config: WirelessAclConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const entries = config.entries || []
    if (entries.length > 10) return failure('VALIDATION', '最多 10 条 ACL 规则')
    for (const entry of entries) {
      if (!isMac(entry.mac)) return failure('VALIDATION', `MAC 格式无效: ${entry.mac}`)
    }
    const wifiAdmin = config.mode === 'allow' ? 1 : config.mode === 'deny' ? 2 : 0
    const current = await postHuayi(HUAYI_HYID.getWirelessAclCfg, { wifi_radio: WIFI_RADIO_24 })
    if (!current.ok) return current
    const saved = await postHuayi(HUAYI_HYID.setWirelessAlcCfg, {
      ...record(current.data.huayi_r),
      wifi_radio: WIFI_RADIO_24,
      wifi_admin: wifiAdmin,
      macfilter_arr: entries.map((entry) => ({ mac_addr: entry.mac.trim().toUpperCase() })),
    })
    if (!saved.ok) return saved
    return success({ accepted: true, rollbackSec: 0 })
  }
  async runDiagnostic(req: DiagnosticRequest): Promise<ApiResponse<DiagnosticResult>> {
    const started = Date.now()
    if (req.type === 'dhcp') {
      const posted = await postHuayi(HUAYI_HYID.doDhcpDetect)
      if (!posted.ok) return posted
      const polled = await pollDetect(HUAYI_HYID.getDhcpDetectResult, 'ping_detct', 'action_arr', 5000)
      if (!polled.ok) return polled
      const output = polled.data.flag === 2 && !polled.data.text ? '未发现 DHCP 服务器' : polled.data.text
      return success({ success: true, output, durationMs: Date.now() - started })
    }
    const target = req.target.trim()
    if (!target) return failure('VALIDATION', '请填写目标')
    if (req.type === 'ping') {
      const count = Number.isInteger(req.count) && (req.count ?? 0) > 0 ? req.count : 4
      const posted = await postHuayi(HUAYI_HYID.doPingDetect, {
        dest_host_addr: target,
        start_host_addr: '',
        ping_num: count,
      })
      if (!posted.ok) return posted
      const polled = await pollDetect(HUAYI_HYID.getPingDetectResult, 'ping_detct', 'action_content', 3000)
      if (!polled.ok) return polled
      return success({ success: true, output: polled.data.text, durationMs: Date.now() - started })
    }
    if (req.type === 'traceroute') {
      const posted = await postHuayi(HUAYI_HYID.doTracertDetect, {
        dest_host_addr: target,
        max_hops: 10,
        timeout: 5,
      })
      if (!posted.ok) return posted
      const polled = await pollDetect(HUAYI_HYID.getTracertDetectResult, 'tracert_detect', 'action_content', 5000)
      if (!polled.ok) return polled
      return success({ success: true, output: polled.data.text, durationMs: Date.now() - started })
    }
    return failure('VALIDATION', '不支持的诊断类型')
  }
  async startDiagnostic(req: DiagnosticRequest): Promise<ApiResponse<null>> {
    const spec = detectSpec(req.type)
    if (!spec) return failure('VALIDATION', '不支持的诊断类型')
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
      const posted = await postHuayi(spec.start, {
        dest_host_addr: req.target.trim(),
        start_host_addr: (req.source ?? '').trim(),
        ping_num: req.count,
      })
      if (!posted.ok) return posted
      return success(null)
    }
    if (req.type === 'traceroute') {
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
      const posted = await postHuayi(spec.start, {
        dest_host_addr: req.target.trim(),
        max_hops: req.maxHops,
        timeout: req.timeoutSec,
      })
      if (!posted.ok) return posted
      return success(null)
    }
    const posted = await postHuayi(spec.start)
    if (!posted.ok) return posted
    return success(null)
  }
  async pollDiagnostic(type: DiagnosticType): Promise<ApiResponse<DiagnosticPoll>> {
    const spec = detectSpec(type)
    if (!spec) return failure('VALIDATION', '不支持的诊断类型')
    return readDetectSnapshot(spec.poll, spec.flagKey, spec.contentKey)
  }
  async stopDiagnostic(type: DiagnosticType): Promise<ApiResponse<null>> {
    const spec = detectSpec(type)
    if (!spec) return failure('VALIDATION', '不支持的诊断类型')
    const posted = await postHuayi(spec.stop)
    if (!posted.ok) return posted
    return success(null)
  }
  async changeAdminPassword(params: AdminPasswordChange): Promise<ApiResponse<null>> {
    if (params.newPassword.length < 8) return failure('VALIDATION', '新密码至少 8 位')
    if (params.oldPassword === params.newPassword) return failure('VALIDATION', '新旧密码不能相同')
    const state = await postHuayi(HUAYI_HYID.getPasswdState)
    if (!state.ok) return state
    const randomName = num(record(state.data.huayi_r).randomname) ?? 0
    const body =
      randomName > 1594
        ? { hy_prepwd: md5Hex(params.oldPassword), hy_newpwd: md5Hex(params.newPassword) }
        : { hy_newpwd: md5Hex(params.newPassword) }
    const saved = await postHuayi(HUAYI_HYID.changeAdminPassword, body)
    if (!saved.ok) return saved
    return success(null)
  }
  async getSystemTime(): Promise<ApiResponse<SystemTimeConfig>> {
    const res = await postHuayi(HUAYI_HYID.getNtpConfig)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    return success({
      timezone: text(body.time_zone),
      ntpEnabled: enabledFlag(body.ntp_admin),
      ntpServers: ntpServers(body.ntp_server_arr),
      localTime: formatUnix(num(body.time_day) ?? 0),
    })
  }
  async updateSystemTime(config: SystemTimeConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const current = await postHuayi(HUAYI_HYID.getNtpConfig)
    if (!current.ok) return current
    const body = record(current.data.huayi_r)
    const saved = await postHuayi(HUAYI_HYID.setNtpConfig, {
      ntp_admin: config.ntpEnabled,
      time_zone: config.timezone,
      ntp_server_arr: config.ntpEnabled ? ntpServers(config.ntpServers) : ntpServers(body.ntp_server_arr),
    })
    if (!saved.ok) return saved
    return success({ accepted: true, rollbackSec: 0 })
  }
  async useBrowserTime(localTime: string): Promise<ApiResponse<null>> {
    const stamp = localTime.trim()
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp)) {
      return failure('VALIDATION', '时间格式应为 YYYY-MM-DD HH:mm:ss')
    }
    const res = await postHuayi(HUAYI_HYID.useBrowserTime, { current_time: stamp })
    if (!res.ok) return res
    return success(null)
  }
  async getScheReboot(): Promise<ApiResponse<ScheRebootConfig>> {
    const res = await postHuayi(HUAYI_HYID.getScheRebootConfig)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    const rectime = num(body.rectime) ?? 0
    return success({
      mode: num(body.sche_mode) ?? 0,
      remainHour: Math.floor(rectime / 3600),
      remainMinute: Math.floor((rectime % 3600) / 60),
      hour: num(body.hour) ?? 0,
      minute: num(body.minute) ?? 0,
      weeks: num(body.weeks) ?? 0,
      timeDay: num(body.time_day) ?? 0,
      remainingSec: num(body.remaining) ?? 0,
    })
  }
  async updateScheReboot(config: ScheRebootConfig): Promise<ApiResponse<ConfigApplyResult>> {
    const invalid = scheRebootError(config)
    if (invalid) return failure('VALIDATION', invalid)
    const payload: Record<string, unknown> = { sche_mode: config.mode }
    if (config.mode === 1) {
      payload.rectime = config.remainHour * 3600 + config.remainMinute * 60
    }
    if (config.mode === 2) {
      const weeks = config.weeks === 127 ? 255 : config.weeks
      payload.weeks = weeks
      payload.hour = config.hour
      payload.minute = config.minute
      payload.rectime = config.hour * 3600 + config.minute * 60
    }
    const saved = await postHuayi(HUAYI_HYID.setScheRebootConfig, payload)
    if (!saved.ok) return saved
    return success({ accepted: true, rollbackSec: 0 })
  }
  async getFirmwareInfo(): Promise<ApiResponse<FirmwareInfo>> {
    const res = await postHuayi(HUAYI_HYID.getUpgradeInfo)
    if (!res.ok) return res
    const body = record(res.data.huayi_r)
    return success({
      currentVersion: text(body.fw_version),
      buildDate: text(body.release_time),
      hardware: text(body.pro_model),
      canUpgrade: true,
      upgradeEngine: 'v1',
      maxBytes: num(body.maxsize) ?? 0,
      maxSizeLabel: text(body.maxsize_tip),
    })
  }
  async uploadFirmware(
    file: Blob,
    options?: { keepSettings?: boolean },
  ): Promise<ApiResponse<ConfigApplyResult>> {
    if (file.size < 1) return failure('VALIDATION', '请选择要上传的文件')
    const info = await this.getFirmwareInfo()
    if (!info.ok) return info
    const maxBytes = info.data.maxBytes ?? 0
    if (maxBytes > 0 && file.size > maxBytes) {
      const tip = info.data.maxSizeLabel
      return failure('VALIDATION', tip ? `文件不能大于${tip}!` : '文件超过升级大小限制')
    }
    const keep = options?.keepSettings === false ? '0' : '1'
    const form = new FormData()
    form.append('userfile', file)
    const res = await requestForm<HuayiBody>(`${STREAM_CGI}?streamid=4&keep_setting=${keep}`, form)
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode === 2000) {
      return success({ accepted: true, rollbackSec: 0, message: '固件已上传，设备正在升级' })
    }
    if (errcode === 4001) return failure('UNAUTHORIZED', '会话无效或已过期，请重新登录', res.data)
    return failure('INTERNAL', `固件升级失败（${errcode ?? 'unknown'}）`, res.data)
  }
  getFirmwareV2Info() {
    return blocked<import('../types').FirmwareV2EngineInfo>('getFirmwareV2Info')
  }
  uploadFirmwareV2() {
    return blocked<import('../types').FirmwareV2UploadResult>('uploadFirmwareV2')
  }
  getFirmwareV2Status() {
    return blocked<import('../types').FirmwareV2Status>('getFirmwareV2Status')
  }
  applyFirmwareV2() {
    return blocked<ConfigApplyResult>('applyFirmwareV2')
  }
  async getSystemLogs(limit?: number): Promise<ApiResponse<SystemLogState>> {
    void limit
    const [cfg, log] = await Promise.all([
      postHuayi(HUAYI_HYID.getSyslogConfig),
      postHuayi(HUAYI_HYID.displaySyslog),
    ])
    if (!cfg.ok) return cfg
    if (!log.ok) return log
    return success({
      enabled: enabledFlag(record(cfg.data.huayi_r).syslog_admin),
      content: text(record(log.data.huayi_r).log_content),
    })
  }
  async updateSyslog(enabled: boolean): Promise<ApiResponse<ConfigApplyResult>> {
    const saved = await postHuayi(HUAYI_HYID.setSyslogConfig, { syslog_admin: enabled })
    if (!saved.ok) return saved
    return success({ accepted: true, rollbackSec: 0 })
  }
  async clearSyslog(): Promise<ApiResponse<null>> {
    const saved = await postHuayi(HUAYI_HYID.cleanSyslog)
    if (!saved.ok) return saved
    return success(null)
  }
  backupConfig(): Promise<ApiResponse<BackupResult>> {
    return Promise.resolve(success({ filename: 'Configfile', size: 0, checksum: '' }))
  }
  async downloadBackup(): Promise<ApiResponse<BackupDownload>> {
    let res: Response
    try {
      res = await fetch(`${STREAM_CGI}?streamid=2`, { credentials: 'same-origin' })
    } catch {
      return failure('NETWORK', '无法连接设备管理接口')
    }
    if (res.status === 401) return failure('UNAUTHORIZED', '会话无效或已过期，请重新登录')
    if (!res.ok) return failure('INTERNAL', `配置备份失败（${res.status}）`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!)
    return success({
      filename: 'Configfile',
      mime: res.headers.get('Content-Type') || 'application/octet-stream',
      contentBase64: btoa(binary),
    })
  }
  async restoreConfig(file: Blob): Promise<ApiResponse<ConfigApplyResult>> {
    if (file.size < 1) return failure('VALIDATION', '请选择要上传的文件')
    if (file.size > RESTORE_MAX_BYTES) return failure('VALIDATION', '文件不能大于2M!')
    const form = new FormData()
    form.append('userfile', file)
    const res = await requestForm<HuayiBody>(`${STREAM_CGI}?streamid=3`, form)
    if (!res.ok) return res
    const errcode = readErrcode(res.data)
    if (errcode === 4001) return failure('UNAUTHORIZED', '会话无效或已过期，请重新登录', res.data)
    if (errcode !== 2000) return failure('INTERNAL', `配置恢复失败（${errcode ?? 'unknown'}）`, res.data)
    const data = record(res.data)
    return success({
      ...APPLIED,
      progressSec: num(data.progresstime) ?? 0,
      reconnect: enabledFlag(data.reconnection),
      reconnectIp: text(data.reconnection_addr),
    })
  }
  getConfigTaskStatus(taskId: string) {
    void taskId
    return blocked<ConfigTaskStatus>('getConfigTaskStatus')
  }
  confirmConfigTask(taskId: string) {
    void taskId
    return blocked<ConfigTaskStatus>('confirmConfigTask')
  }
  disconnectDevice(deviceId: string) {
    void deviceId
    return blocked<null>('disconnectDevice')
  }
  async rebootDevice(): Promise<ApiResponse<ConfigApplyResult>> {
    const saved = await postHuayi(HUAYI_HYID.restart)
    if (!saved.ok) return saved
    return success(APPLIED)
  }
  async factoryReset(params: { confirmToken: string }): Promise<ApiResponse<ConfigApplyResult>> {
    if (params.confirmToken !== 'RESET') return failure('VALIDATION', '确认口令无效')
    const saved = await postHuayi(HUAYI_HYID.reset)
    if (!saved.ok) return saved
    return success(APPLIED)
  }
}
