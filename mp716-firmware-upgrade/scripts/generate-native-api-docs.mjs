/** Generate the advertised native API catalog and OpenAPI from pinned source. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const project = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(resolve(project, 'web/package.json'))
const ts = require('typescript')
const source = ts.createSourceFile('types.ts', readFileSync(resolve(project, 'web/src/api/types.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
const nodes = new Map(source.statements.filter(s => ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)).map(s => [s.name.text, s]))
const ref = name => ({ $ref: '#/components/schemas/' + name })
const array = name => ({ type: 'array', items: ref(name) })
const str = { type: 'string' }, bool = { type: 'boolean' }, integer = { type: 'integer' }
function object(properties = {}, required = Object.keys(properties)) {
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}
function comment(node) {
  return ts.getJSDocCommentsAndTags(node).map(x => typeof x.comment === 'string' ? x.comment : '').filter(Boolean).join('\n')
}
function convert(node) {
  if (!node) return {}
  if (ts.isParenthesizedTypeNode(node)) return convert(node.type)
  if (ts.isArrayTypeNode(node)) return { type: 'array', items: convert(node.elementType) }
  if (ts.isUnionTypeNode(node)) {
    const values = node.types.map(convert)
    if (values.every(x => 'const' in x) && new Set(values.map(x => typeof x.const)).size === 1)
      return { type: typeof values[0].const, enum: values.map(x => x.const) }
    return { anyOf: values }
  }
  if (ts.isLiteralTypeNode(node)) {
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return { type: 'null' }
    if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return { type: 'boolean', const: true }
    if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return { type: 'boolean', const: false }
    if (ts.isNumericLiteral(node.literal)) return { type: 'number', const: Number(node.literal.text) }
    if (ts.isStringLiteral(node.literal)) return { type: 'string', const: node.literal.text }
  }
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(source)
    if (name === 'Record') return { type: 'object', additionalProperties: convert(node.typeArguments?.[1]) }
    if (name === 'Array') return { type: 'array', items: convert(node.typeArguments?.[0]) }
    if (!nodes.has(name)) throw new Error('Unknown type: ' + name)
    return ref(name)
  }
  if (ts.isIndexedAccessTypeNode(node) && ts.isTypeReferenceNode(node.objectType) && ts.isLiteralTypeNode(node.indexType)) {
    const target = nodes.get(node.objectType.typeName.getText(source))
    const property = target.members.find(x => x.name?.getText(source) === node.indexType.literal.text)
    return convert(property.type)
  }
  if (ts.isTypeLiteralNode(node)) return members(node.members)
  const types = new Map([[ts.SyntaxKind.StringKeyword, 'string'], [ts.SyntaxKind.NumberKeyword, 'number'], [ts.SyntaxKind.BooleanKeyword, 'boolean']])
  if (types.has(node.kind)) return { type: types.get(node.kind) }
  if ([ts.SyntaxKind.UnknownKeyword, ts.SyntaxKind.AnyKeyword].includes(node.kind)) return {}
  throw new Error('Unsupported type syntax: ' + node.getText(source))
}
function members(list) {
  const properties = {}, required = []
  for (const member of list) {
    if (ts.isIndexSignatureDeclaration(member)) continue
    const name = member.name.getText(source).replace(/^['"]|['"]$/g, '')
    properties[name] = { ...convert(member.type), ...(comment(member) ? { description: comment(member) } : {}) }
    if (!member.questionToken) required.push(name)
  }
  return object(properties, required)
}
const schemas = {}
for (const [name, node] of nodes) {
  if (node.typeParameters?.length) continue
  let schema = ts.isInterfaceDeclaration(node) ? members(node.members) : convert(node.type)
  if (node.heritageClauses?.length) schema = { allOf: [...node.heritageClauses.flatMap(x => x.types.map(y => ref(y.expression.getText(source)))), schema] }
  schemas[name] = { ...schema, ...(comment(node) ? { description: comment(node) } : {}) }
}
schemas.NativeCapabilities = object({ apiContract: { type: 'string', const: 'mp716-native/v1' }, routes: { type: 'array', items: str }, firmwareUpgrade: bool, wanModes: { type: 'array', items: str }, wifiModes: { type: 'array', items: str }, services: { type: 'object', additionalProperties: bool }, hardware: { type: 'object', additionalProperties: bool }, testStatus: str })
schemas.DiagnosticRequest.required = ['type']
schemas.DiagnosticRequest.allOf = [{ if: { properties: { type: { enum: ['ping', 'traceroute', 'dns'] } } }, then: { required: ['target'] } }]
schemas.DiagnosticRequest.properties.count = { type: 'integer', minimum: 1, maximum: 100 }
schemas.DiagnosticRequest.properties.maxHops = { type: 'integer', minimum: 1, maximum: 20 }
schemas.DiagnosticRequest.properties.timeoutSec = { type: 'integer', minimum: 1, maximum: 10 }
schemas.LoginParams.properties.username = { type: 'string', enum: ['admin', 'root'] }
schemas.LoginParams.properties.password = { type: 'string', writeOnly: true, minLength: 1 }
schemas.LoginResult.properties.token = { type: 'string', pattern: '^[a-f0-9]{32}$' }
schemas.LoginResult.properties.expiresIn.description = 'Seconds; login requests a 600-second rpcd session. Use the returned value.'
schemas.DhcpConfig.properties.leasetime = { type: 'string', pattern: '^[1-9][0-9]{0,6}[smhdw]?$', description: 'String, e.g. 7200 or 12h; do not send a JSON number.' }
schemas.NativeError = object({ ok: { type: 'boolean', const: false }, code: str, message: str, details: {}, ts: { type: 'number', description: 'Unix seconds from the firmware.' } }, ['ok', 'code', 'message', 'ts'])
schemas.FirmwareInfo.properties.validationOnly = bool
for (const name of ['rxRateBps','txRateBps']) {
  schemas.WanStatus.allOf.at(-1).properties[name].description = 'Current firmware samples byte deltas per second (byte/s). Multiply by 8 before displaying bit/s; the existing UI label uses bps.'
}
for (const [name, fields] of Object.entries({
  NativeServiceInfo: ['serviceAvailable','serviceMessage'],
  PptpClientConfig: ['status','address'], L2tpClientConfig: ['status','address','serverEnabled'],
  OpenVpnConfig: ['status','configUploaded'], VpnUserConfig: ['types','pptpStart','pptpEnd','l2tpStart','l2tpEnd'],
  WifiConfig: ['rawEncryption','supportedModes','macfilter','maclist'],
  WifiAdvancedConfig: ['supportsLegacyOptions','supportsDtim','radioOn'],
  SystemTimeConfig: ['localTime'], ScheRebootConfig: ['localTime','timezone','timeDay','remainingSec'],
})) {
  const schema = schemas[name].properties ? schemas[name] : schemas[name].allOf.at(-1)
  for (const field of fields) if (schema.properties[field]) schema.properties[field].readOnly = true
}
const data = {
  'auth/prelogin': ['PreLoginConfig', '登录前状态'], 'home/physical-ports': [array('PhysicalPortStatus'), '物理网口状态与核验标记'],
  'hosts/connected': [array('ConnectedDevice'), '终端列表'], 'hosts/device-acl': [array('DeviceAclEntry'), '终端禁止上网列表'],
  'network/dhcp/config': ['DhcpConfig', 'DHCP 配置与静态租约'], 'network/dns/config': ['DnsConfig', 'DNS 配置'],
  'network/lan/config': ['LanConfig', 'LAN 配置'], 'network/lan/status': ['LanStatus', 'LAN 状态'],
  'network/wan/config': ['WanConfig', 'WAN 配置'], 'network/wan/status': ['WanStatus', 'WAN 状态与流量采样'],
  'system/capabilities': ['NativeCapabilities', '设备接口和服务能力'], 'system/config-task/:id': ['ConfigTaskStatus', '配置任务状态'],
  'system/device': ['DeviceInfo', '设备资料'], 'system/firmware': ['FirmwareInfo', '固件版本与仅校验能力'],
  'system/info': ['SystemInfo', '系统信息'], 'system/logs': ['SystemLogState', '日志开关和指定条数的最近日志'],
  'system/ping': [object({ latencyMs: { type: 'number', const: 0 } }), '检查会话及 API 存活；不探测外网'],
  'system/sche-reboot': ['ScheRebootConfig', '定时重启配置'], 'system/status': ['SystemStatus', '运行状态'],
  'system/time': ['SystemTimeConfig', '时区与 NTP 配置'], 'vpn/online': [array('VpnOnlineUser'), 'VPN 在线会话'],
  'vpn/openvpn': ['OpenVpnConfig', 'OpenVPN 客户端配置'], 'vpn/pptp': ['PptpClientConfig', 'PPTP 客户端配置'],
  'vpn/pptpd': ['VpnServerConfig', 'PPTP 服务器配置'], 'vpn/users': ['VpnUserConfig', 'VPN 用户及地址池'],
  'vpn/xl2tp': ['L2tpClientConfig', 'L2TP 客户端配置'], 'vpn/xl2tpd': ['VpnServerConfig', 'L2TP 服务器配置'],
  'wireless/acl': ['WirelessAclConfig', '无线 MAC 访问控制'], 'wireless/advanced': ['WifiAdvancedConfig', '无线高级配置'],
  'wireless/clients': [array('WirelessClient'), '无线关联终端'], 'wireless/config': ['WifiConfig', '无线基础配置'],
  'wireless/status': ['WifiStatus', '无线运行状态'], 'wizard/quick': ['QuickSettingState', '快速设置向导状态'],
}
const configTypes = { 'network/dhcp/config': 'DhcpConfig', 'network/dns/config': 'DnsConfig', 'network/lan/config': 'LanConfig', 'network/wan/config': 'WanConfig', 'system/sche-reboot': 'ScheRebootConfig', 'system/time': 'SystemTimeConfig', 'vpn/openvpn': 'OpenVpnConfig', 'vpn/pptp': 'PptpClientConfig', 'vpn/pptpd': 'VpnServerConfig', 'vpn/users': 'VpnUserConfig', 'vpn/xl2tp': 'L2tpClientConfig', 'vpn/xl2tpd': 'VpnServerConfig', 'wireless/acl': 'WirelessAclConfig', 'wireless/advanced': 'WifiAdvancedConfig', 'wireless/config': 'WifiConfig' }
const bodies = Object.fromEntries(Object.entries(configTypes).map(([path, name]) => [path, object({ config: ref(name), ...(/^(network|wireless)\//.test(path) ? { confirmTimeoutSec: { type: 'integer', minimum: 30, maximum: 180, default: 90 } } : {}) }, ['config'])]))
Object.assign(bodies, {
  'auth/login': ref('LoginParams'), 'auth/logout': object(),
  'hosts/device-acl': object({ mac: str, action: { type: 'string', enum: ['add', 'remove'] } }),
  'hosts/disconnect': object({ deviceId: str }),
  'network/dhcp/static': object({ bindings: { ...array('StaticDhcpBinding'), maxItems: 64 }, confirmTimeoutSec: { type: 'integer', minimum: 30, maximum: 180, default: 90 } }, ['bindings']),
  'system/backup/download': object(), 'system/config-task/cancel': object({ taskId: { type: 'string', pattern: '^[a-f0-9]{32}$' } }),
  'system/config-task/confirm': object({ taskId: { type: 'string', pattern: '^[a-f0-9]{32}$' } }),
  'system/factory-reset': object({ confirmToken: { type: 'string', const: 'RESET' } }),
  'system/logs': object({ enabled: bool }), 'system/logs/clear': object(), 'system/password': ref('AdminPasswordChange'),
  'system/reboot': object(), 'system/restore': object({ backup: { type: 'object', description: 'Parsed JSON previously exported by this firmware; vendor 014 tar.gz is not this format.' } }),
  'system/time/browser': object({ localTime: { type: 'string', pattern: '^20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$' } }),
  'tools/diagnostic': ref('DiagnosticRequest'), 'tools/diagnostic/start': ref('DiagnosticRequest'),
  'tools/diagnostic/poll': object({ type: ref('DiagnosticType') }), 'tools/diagnostic/stop': object({ type: ref('DiagnosticType') }),
  'vpn/online/disconnect': object({ pid: { type: 'string', pattern: '^[1-9][0-9]{0,7}$' } }),
  'vpn/openvpn/upload': object({ filename: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,128}$' }, kind: { type: 'string', enum: ['config', 'cert'] }, contentBase64: { type: 'string', contentEncoding: 'base64', maxLength: 349528 } }),
  'wizard/complete': object(), 'wizard/quick': object({ wan: ref('QuickSettingWan'), wifi: ref('QuickSettingWifi') }),
})
const nullResponse = { type: 'null' }
const postData = Object.fromEntries(['auth/logout', 'hosts/device-acl', 'hosts/disconnect', 'system/logs/clear', 'system/password', 'system/time/browser', 'tools/diagnostic/start', 'tools/diagnostic/stop', 'wizard/complete'].map(path => [path, nullResponse]))
postData['vpn/online/disconnect'] = object({ disconnected: bool }, ['disconnected'])
Object.assign(postData, { 'auth/login': ref('LoginResult'), 'system/backup/download': ref('BackupDownload'), 'system/config-task/cancel': ref('ConfigTaskStatus'), 'system/config-task/confirm': ref('ConfigTaskStatus'), 'system/firmware-package/verify': ref('FirmwareVerificationReport'), 'tools/diagnostic': ref('DiagnosticResult'), 'tools/diagnostic/poll': ref('DiagnosticPoll'), 'wizard/quick': ref('QuickSettingApplyResult') })
const specialDescriptions = {
  'auth/login': '登录并创建 rpcd 会话', 'auth/logout': '退出当前会话', 'hosts/device-acl': '立即加入/解除终端禁止上网列表；无配置任务倒计时',
  'hosts/disconnect': '断开当前无线会话；不能断开当前管理终端或有线终端', 'network/dhcp/static': '整表替换静态租约，非单条追加；可回滚',
  'system/backup/download': '导出配置；返回 JSON 信封中的 Base64 内容，不是直接文件流',
  'system/config-task/cancel': '请求撤销并等待设备完成回滚', 'system/config-task/confirm': '仅在 phase=applied 时确认当前会话拥有的任务',
  'system/factory-reset': '清空可写配置并重启；危险操作，无应用倒计时回滚', 'system/firmware-package/verify': '上传原始 .mp716upd 字节并验签；不刷写固件',
  'system/logs': '保存日志开关并应用，可回滚', 'system/logs/clear': '清空日志缓冲区', 'system/password': '修改 root 管理密码；不是配置倒计时任务',
  'system/reboot': '接受后约 3 秒发起重启', 'system/restore': '恢复自研 JSON 配置备份并进入应用/回滚流程',
  'system/time/browser': '立即设置设备本地时钟；不是配置倒计时任务',
  'tools/diagnostic': '同步网络检测，最多等待约 10 秒；success 描述探测结果', 'tools/diagnostic/start': '启动当前会话的异步检测',
  'tools/diagnostic/poll': '读取当前会话检测进度；该 POST 不修改持久配置', 'tools/diagnostic/stop': '停止当前会话的检测进程',
  'vpn/online/disconnect': '断开指定受管 PPP VPN 会话', 'vpn/openvpn/upload': 'Base64 JSON 上传并持久保存 VPN 配置/证书，可回滚；单文件解码后最多 256 KiB',
  'wizard/complete': '完成快速设置并持久保存标记', 'wizard/quick': '同时应用有线 WAN 与 2.4GHz Wi-Fi，可能断开当前管理连接',
}
const routes = JSON.parse(readFileSync(resolve(project, 'integration/ram-web/native-routes.json'), 'utf8'))
const paths = {}, catalog = []
function envelope(schema) { return object({ ok: { type: 'boolean', const: true }, data: schema, ts: { type: 'number', description: 'Firmware Unix seconds.' } }) }
for (const entry of routes) {
  const [method, path] = entry.split(' ')
  const url = '/' + path.replace(':id', '{id}')
  const read = method === 'GET'
  if (read && !data[path] || !read && !bodies[path] && path !== 'system/firmware-package/verify') throw new Error('Missing route documentation: ' + entry)
  const summary = read ? data[path][1] : specialDescriptions[path] || ('保存' + data[path][1] + '，进入应用/回滚流程')
  const response = read ? (typeof data[path][0] === 'string' ? ref(data[path][0]) : data[path][0]) : postData[path] || ref('ConfigApplyResult')
  const operation = { tags: [path.split('/')[0]], operationId: method.toLowerCase() + '_' + path.replace(/[^a-zA-Z0-9]+/g, '_'), summary,
    responses: { 200: { description: 'Success envelope; accepted does not mean applied, confirmed or upgraded.', content: { 'application/json': { schema: envelope(response) } } } },
    'x-mp716-persistent-change': !read && !path.startsWith('auth/') && !path.startsWith('tools/') && !['system/backup/download','system/firmware-package/verify','system/reboot','vpn/online/disconnect','hosts/disconnect','system/time/browser','system/logs/clear'].includes(path) }
  for (const [status, description] of [['400','Validation failed; firmware verifier details may still show signature_checked=true.'],['401','Missing/expired session; log in again.'],['404','Unknown or unavailable interface.'],['409','Device busy; finish the pending configuration task.'],['500','Internal service failure.'],['503','Session service unavailable.']]) operation.responses[status] = { description, content: { 'application/json': { schema: ref('NativeError') } } }
  if (['auth/prelogin','auth/login'].includes(path)) operation.security = []
  if (path.includes(':id')) operation.parameters = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{32}$' } }]
  if (read && path === 'system/logs') operation.parameters = [
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 } },
  ]
  if (!read) operation.requestBody = { required: true, content: path === 'system/firmware-package/verify'
    ? { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }
    : { 'application/json': { schema: bodies[path] } } }
  paths[url] ??= {}; paths[url][method.toLowerCase()] = operation
  catalog.push({ method, path: '/cgi-bin/mp716' + url, summary, request: read ? '—' : path === 'system/firmware-package/verify' ? '原始二进制 .mp716upd' : configTypes[path] ? `{ config: ${configTypes[path]} }` : JSON.stringify(bodies[path]).includes('$ref') ? '见 OpenAPI Schema' : Object.keys(bodies[path].properties || {}).join(', ') || '{}', response: response.$ref?.split('/').at(-1) || (response.type === 'array' ? response.items.$ref.split('/').at(-1) + '[]' : response.type || 'object') })
}
const document = { openapi: '3.1.0', info: { title: 'MP716 native firmware Web API', version: 'mp716-native-v1-firmware-1.0.7', description: 'Current firmware 1.0.7, Web 0.2.1. Generated from the advertised native-routes.json and shared TypeScript DTOs. Some DTOs contain vendor compatibility/read-only fields; prefer GET then patch. This specification does not expose firmware flashing. GET is generally observational, but reading a configuration task can trigger expiry handling. See mp716-native-web-api.md for exact effects, units and local debugging.' }, servers: [{ url: 'http://127.0.0.1:5173/cgi-bin/mp716', description: 'Local Vite proxy; calls the real router' }, { url: 'http://192.168.199.1/cgi-bin/mp716', description: 'Router LAN API; browser cross-origin requests are not enabled' }], security: [{ bearerAuth: [] }], paths, components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'rpcd 32-character lowercase hexadecimal session token' } }, schemas } }
function validateRefs(value) {
  if (!value || typeof value !== 'object') return
  if (value.$ref && !schemas[value.$ref.split('/').at(-1)]) throw new Error('Broken reference: ' + value.$ref)
  for (const child of Object.values(value)) validateRefs(child)
}
validateRefs(document)
writeFileSync(resolve(project, 'docs/mp716-native-openapi.json'), JSON.stringify(document, null, 2) + '\n')
const markdown = '# MP716 原生接口完整清单\n\n由 `scripts/generate-native-api-docs.mjs` 生成。共 ' + routes.length + ' 条声明路由；请求和响应均指 JSON 信封内的 `data`，二进制上传除外。详细鉴权、限制、参数 Schema 与本地代理方式见 [联调文档](mp716-native-web-api.md) 和 [OpenAPI](mp716-native-openapi.json)。\n\n'+
  ['| 方法 | 完整路径 | 说明 | 请求体 | 成功 data |','| --- | --- | --- | --- | --- |', ...catalog.map(r => `| ${r.method} | \`${r.path}\` | ${r.summary} | ${r.request} | ${r.response} |`)].join('\n') + '\n\n共享 DTO 中的原厂兼容字段不表示当前固件支持对应能力。未列入本清单的 V2 刷写、QoS、防火墙和端口转发方法不能仅因前端存在方法名而调用。\n'
writeFileSync(resolve(project, 'docs/mp716-native-api-catalog.md'), markdown)
console.log(JSON.stringify({ ok: true, operations: routes.length, paths: Object.keys(paths).length, schemas: Object.keys(schemas).length }))
