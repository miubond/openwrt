# MP716 固件原生接口与本地 Web 联调

适用：MP716 自研固件 **1.0.10**，Web **0.2.3**，接口契约 **`mp716-native/v1`**。整理日期：2026-11-20，版本于 2026-11-25 按实机更新。主 Web 源码为 `D:\goweb\src\openwrt_system`，固件仓库的 `web/` 是该源码的生成快照。

- [72 条接口完整清单](mp716-native-api-catalog.md)
- [OpenAPI 3.1 JSON，可导入支持 OpenAPI 的接口工具](mp716-native-openapi.json)
- [前端字段类型](../web/src/api/types.ts)
- [实际请求适配器](../web/src/api/adapters/device-adapter.ts)
- [本地启动脚本](../scripts/start-native-web-dev.ps1)

文档来源是当前 `httpd.uc`、`dispatch.uc`、原生处理模块、`native-routes.json` 和前端适配器。接口有实现或服务已安装，不代表 VPN 隧道、硬件端口及所有功能均已实机验收；以能力响应及对应测试报告为准。

## 1. 地址与原厂区别

当前实验室路由器**仅运行**自研栈：OpenWrt **1.0.10**，页面已热更新为 Web **0.2.3**。原厂 014 的 Web 与 HUAYI 程序已在刷写 `firmware` 分区时被替换，**不与**自研后台同时保留。Flash 上的 Bootloader、Config、Factory 未改；「保留配置」指 UCI/身份迁移，不是保留原厂系统。见 [实机运行状态与原厂替换边界](mp716-device-runtime-state.md)。

| 用途 | 地址或格式 |
| --- | --- |
| 设备后台 | `http://192.168.199.1/#/` |
| 设备静态资源 | `/mp716/`；保留兼容的 `/mp716/` 页面入口 |
| 当前原生 API 基地址 | `http://192.168.199.1/cgi-bin/mp716` |
| 本地开发页面 | `http://127.0.0.1:5173/#/` |
| 本地页面请求 API | `/cgi-bin/mp716/...`，由 Vite 代理到设备 |
| 原厂 014（历史/救砖对照） | `/cgi-bin/cgi_huayi.cgi` 等 CGI，通过 HYID 动作号及原厂会话协议区分操作；**当前实机运行栈中不可用** |

`mp716` 是自研固件新增的 API 命名空间。原厂和当前固件的区别同时包括路径、参数、鉴权和返回结构，不能只删除或增加这段路径来转换协议。它与前端资源目录 `/mp716/` 是两个独立用途，也不影响后台使用管理 IP 根入口。

`GET /system/ping` 只检查当前登录会话及 API 存活，返回 `latencyMs: 0`；它不测量外网时延。网络 Ping 使用 `POST /tools/diagnostic` 或异步检测接口。

当前网关未开放供任意浏览器来源使用的 CORS/OPTIONS 流程。本地开发使用同源代理，不需要修改固件或开放 CORS。

## 2. 本地启动方式

普通 `npm run dev` 在此项目中明确使用 `development` 模式，其开发入口可能选择 Mock 或原厂适配器。连接当前自研固件时使用 **`openwrt` 模式**。

先在主源码目录安装锁定的依赖（已安装且未变更依赖时可省略）：

```powershell
Set-Location D:\goweb\src\openwrt_system
npm ci
```

推荐在固件仓库运行随附脚本：

```powershell
Set-Location D:\goweb\src\openwrt\mp716-firmware-upgrade
.\scripts\start-native-web-dev.ps1
# 换管理地址或端口时：
# .\scripts\start-native-web-dev.ps1 -RouterUrl http://192.168.199.1 -Port 5174
```

也可在 PowerShell 中手动启动，设置只作用于当前进程，不写 `.env`：

```powershell
Set-Location D:\goweb\src\openwrt_system
$env:VITE_ROUTER_ADAPTER = 'device'
$env:VITE_AUTH_BYPASS = '0'
$env:VITE_API_BASE = '/cgi-bin/mp716'
$env:VITE_DEV_PROXY_TARGET = 'http://192.168.199.1'
$env:VITE_BASE_PATH = '/'
$env:VITE_ROUTER_BASE = '/'
npm exec -- vite --mode openwrt --host 127.0.0.1 --port 5173 --strictPort
```

打开 `http://127.0.0.1:5173/#/`，使用设备实际管理员凭据登录。服务只监听本机；端口占用时换端口。脚本退出后恢复其设置的环境变量，手动方式可关闭这个 PowerShell 窗口清除变量。修改 Vite 环境变量后须重启开发服务。

现有 Vite 配置的 `/cgi-bin` 代理会保留子路径并转发 `Authorization`。本地请求应形如 `http://127.0.0.1:5173/cgi-bin/mp716/system/info`，不要在前端写死设备绝对 URL。

**本地调试连接的是真实路由器。** 页面上的保存、应用、禁止上网、修改密码、重启和恢复出厂等按钮会执行真实操作；代理没有只读拦截开关。启动开发服务本身不会上传页面、构建固件或刷机。

只检查样式时可运行已有隔离测试：`npm run build:openwrt` 后执行 `npm run test:ui:lp`。此测试使用本机假数据和网络隔离，与上述真实设备联调不同。

## 3. 登录与鉴权

以下路径相对于 API 基地址。

### 登录前状态

```http
GET /auth/prelogin
```

```json
{"ok":true,"data":{"firstBoot":0,"needAuthorized":1},"ts":1795168800}
```

### 登录

```http
POST /auth/login
Content-Type: application/json

{"username":"admin","password":"<设备当前密码>"}
```

`username` 接受 `admin` 或 `root`，网关均使用设备 root 凭据向 rpcd 认证。成功响应：

```json
{"ok":true,"data":{"token":"<32位小写十六进制会话令牌>","expiresIn":600},"ts":1795168800}
```

`expiresIn` 单位为秒，使用实际响应值。受保护请求携带：

```http
Authorization: Bearer <token>
```

只有登录前状态与登录接口允许匿名访问。Cookie 不是此原生 API 的鉴权依据；不要把令牌放在 URL、提交到源码或写进构建环境文件。直接在浏览器地址栏打开受保护 API，没有 Authorization 时返回 401 是正常行为。

退出：`POST /auth/logout`，JSON 请求体 `{}`，仍需携带令牌。401 时重新登录；失败请求不要持续高速重试。

PowerShell 只读检查示例（不在文件中填写密码）：

```powershell
$base = 'http://127.0.0.1:5173/cgi-bin/mp716'
$credential = Get-Credential -UserName admin -Message '输入 MP716 当前管理员密码'
$body = @{ username = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType 'application/json' -Body $body
$headers = @{ Authorization = "Bearer $($login.data.token)" }
Remove-Variable body, credential

Invoke-RestMethod -Uri "$base/system/ping" -Headers $headers
Invoke-RestMethod -Uri "$base/system/info" -Headers $headers
Invoke-RestMethod -Uri "$base/system/capabilities" -Headers $headers

Invoke-RestMethod -Method Post -Uri "$base/auth/logout" -Headers $headers -ContentType 'application/json' -Body '{}'
Remove-Variable login, headers
```

## 4. 公共请求与返回约定

普通 POST 使用 `application/json`；无业务参数时发送 `{}`。当前客户端采用 JSON 包装后的配置，例如 `{ "config": { ... } }`。

成功信封：

```json
{"ok":true,"data":{},"ts":1795168800}
```

失败信封：

```json
{"ok":false,"code":"VALIDATION","message":"请求参数无效","details":null,"ts":1795168800}
```

固件网关的 `ts` 为 Unix 秒。`data` 可能为对象、数组或 null；错误详情可能省略。前端 `http.ts` 在本地生成的网络错误使用 JS 时间戳，不应将所有错误对象的 `ts` 一律解释为设备时间。

| HTTP | 常见含义 |
| --- | --- |
| 200 | HTTP 调用成功；仍需检查 `ok` 及业务任务状态 |
| 400 | JSON/参数校验失败，或固件包校验拒绝 |
| 401 | 未登录、会话过期或令牌无效 |
| 404 | 未实现或未知接口 |
| 409 | `DEVICE_BUSY`：有操作正在执行，或有待确认配置 |
| 500 | 接口或运行服务内部错误 |
| 503 | rpcd 会话服务不可用 |

普通 JSON 请求体上限 65,536 字节；`system/restore` 为 2,097,152 字节；`vpn/openvpn/upload` 为 360,448 字节。登录请求为 1–4,096 字节。`.mp716upd` 原始上传走独立验签入口，由其上传器和验证器另行约束。

## 5. 读接口与字段来源

完整 URL、方法和类型见[接口清单](mp716-native-api-catalog.md)及[OpenAPI](mp716-native-openapi.json)。可先调用这些接口联调展示：

| 功能 | GET 路径 |
| --- | --- |
| 设备/系统 | `/system/info`、`/system/status`、`/system/device` |
| 能力声明 | `/system/capabilities` |
| WAN/LAN | `/network/wan/status`、`/network/wan/config`、`/network/lan/status`、`/network/lan/config` |
| DHCP/DNS | `/network/dhcp/config`、`/network/dns/config` |
| 无线 | `/wireless/status`、`/wireless/config`、`/wireless/advanced`、`/wireless/acl`、`/wireless/clients` |
| 终端/物理口 | `/hosts/connected`、`/hosts/device-acl`、`/home/physical-ports` |
| 系统设置 | `/system/time`、`/system/sche-reboot`、`/system/logs` |
| VPN | `/vpn/pptp`、`/vpn/pptpd`、`/vpn/xl2tp`、`/vpn/xl2tpd`、`/vpn/openvpn`、`/vpn/users`、`/vpn/online` |
| 固件信息 | `/system/firmware` |

注意字段语义：

- `rxBytes`、`txBytes` 是累计字节数。当前 `rxRateBps`、`txRateBps` 的采样实现是累计字节差除以秒数，实际为 **byte/s**；现有 UI 沿用 `bps` 文案。新组件若要显示 bit/s，须乘以 8，并明确单位。采样未就绪时速率可为 0，不要用累计流量替代速率。
- 物理网口：`mappingVerified:false` 时保留 P0–P4 等交换机编号，不猜测 LAN/WAN。`linkKnown:false` 或 `linkUp:null` 表示未知，不应显示为未连接。接口型号和能力不能代替物理端口核验。
- Wi-Fi 信道配置为整数或字符串 `auto`；状态里的自动信道可为 `channel:0`。根据 `supportedModes` 及原生能力显示选项；未支持的蜂窝模式不能仅靠菜单启用。
- `serviceAvailable`、`serviceMessage` 和能力响应 `services` 决定对应 VPN 服务是否可用；不等于已经建立隧道。
- 密码和密钥可能以 `********` 返回。编辑其他字段时保留占位值，不将其当作真实密码另存或显示。
- 当前日志读取固定最近 200 行；适配器附带的 `limit` 查询参数尚未用于服务端行数控制。
- TypeScript DTO 同时兼容旧原厂字段，OpenAPI 由其生成；其中的兼容字段或适配器方法不等于当前固件开放了所有功能。以设备 `routes` 和处理器限制为准。

## 6. 保存、应用、确认和回滚

联调写入前先 GET 当前配置，以完整读取结果为基础修改所需字段，使用现有适配器提交。不要用空对象覆盖完整配置。

核心配置写入格式：

```http
POST /network/wan/config
Content-Type: application/json
Authorization: Bearer <token>

{"config":{"...":"来自 GET network/wan/config 的完整配置，仅修改目标字段"},"confirmTimeoutSec":90}
```

以上为结构示意，不是可直接提交的有效 WAN 配置。

核心 WAN、LAN、DHCP、DNS 和无线接口的 `confirmTimeoutSec` 支持 30–180 秒，默认 90 秒；系统/VPN 配置使用各自处理器的固定事务期限，不承诺接受此参数。WAN DHCP/静态 MTU 576–1500，PPPoE MTU 576–1492。

有变更时的示意响应：

```json
{"ok":true,"data":{"accepted":true,"rollbackSec":90,"taskId":"0123456789abcdef0123456789abcdef","phase":"applying"},"ts":1795168800}
```

1. 保存后不立即报“已应用成功”。若返回 `taskId` 且 `rollbackSec>0`，使用**同一会话令牌**轮询 `GET /system/config-task/{taskId}`，现有页面每秒一次。
2. 等待 `phase:applied`，再允许用户确认。`prepared`、`applying` 不表示服务已经工作。
3. 确认：`POST /system/config-task/confirm`，请求 `{ "taskId": "..." }`。
4. 撤销：`POST /system/config-task/cancel`，同样传 `taskId`。撤销可能先返回 `rolling_back`，继续等待实际结果。
5. 到期由设备处理回滚。断网或一次请求超时不代表已回滚；重连后继续查设备状态。读取任务状态时也会检查过期任务，GET 不能理解为绝无内部状态变化。

任务状态为 `pending / confirmed / rolled_back / failed`；阶段为 `prepared / applying / applied / rolling_back / failed`。`failed` 时保留任务和快照供恢复重试，不应自行当作撤销成功。设备全局只允许一个待确认任务；未结束前新保存可能返回 409。

如果没有实际变更，可能直接返回 `{ "accepted":true,"rollbackSec":0 }`，不带任务号。此时无需轮询。

现有页面应复用 `useApplyConfirm` 和 `ApplyBanner`，避免另写前端倒计时后假定成功。对应源码：[`web/src/composables/useApplyConfirm.ts`](../web/src/composables/useApplyConfirm.ts)。

### 三个容易误用的接口

- DHCP `leasetime` 必须是**字符串**，如 `"7200"`、`"12h"`，不能直接发 JSON 数字。静态租约写入是 `POST /network/dhcp/static`，请求 `{ "bindings":[完整列表] }`，是整表替换。
- `POST /hosts/device-acl` 请求 `{ "mac":"02:00:00:00:00:01","action":"add" }` 或 `remove`，会立即修改持久 ACL 并应用，没有 ApplyBanner 的确认倒计时；撤销需显式调用 `remove`。不能禁止当前管理终端。
- `POST /hosts/disconnect` 请求 `{ "deviceId":"来自终端列表的 id" }`，只断开无线会话，不是持久禁止上网，不能断开有线或当前管理终端。

## 7. 固件上传并校验

```http
POST /system/firmware-package/verify
Authorization: Bearer <token>
Content-Type: application/octet-stream

<test.mp716upd 的原始字节>
```

该入口接收原始二进制，不是 multipart、Base64 JSON 或 ZIP。页面限制参考 `GET /system/firmware` 的 `maxBytes`，当前返回 8,060,928 字节；最终以验证器结果为准。

```javascript
// 登录后使用，file 是浏览器文件选择器获得的 .mp716upd File。
const response = await fetch('/cgi-bin/mp716/system/firmware-package/verify', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/octet-stream',
  },
  body: file,
})
const result = await response.json()
```

成功的 `data` 内应有 `ok:true`、`code:0`、`signature_checked:true`、`flash_write:false`；`accepted:false`、`upgraded:false` 是校验模式的正常结果，不能据此显示“升级成功”。

版本拒绝等错误可能在 HTTP 400 的 `details` 中仍有 `signature_checked:true`，例如数字 `code:14`、`error:"downgrade"`。区分“签名有效”和“整个包通过校验”；不要只显示通用网络失败。

当前 `/system/firmware` 返回 `canUpgrade:false`、`flashUpgradeEnabled:false`、`validationOnly:true`，能力声明 `firmwareUpgrade:false`。本文不提供 Web 刷写接口。前端适配器中存在的 `firmware-v2/*` 方法不在当前公布的 72 条路由中。

## 8. VPN 文件、诊断与系统操作

### OpenVPN 文件

`POST /vpn/openvpn/upload` 使用 JSON：

```json
{"filename":"client.ovpn","kind":"config","contentBase64":"<文件字节的 Base64>"}
```

`kind` 为 `config` 或 `cert`；解码后最多 256 KiB。证书/压缩包还经过服务端文件类型、解压大小和成员检查。上传会写入受管 VPN 配置目录并进入配置事务，不是仅在浏览器预览。不要改成 multipart。

### 网络诊断

- 同步：`POST /tools/diagnostic`，如 `{ "type":"ping","target":"192.168.199.1","count":3 }`。
- 异步：先 `POST /tools/diagnostic/start`，再向 `/poll` 发送 `{ "type":"ping" }`，需要时向 `/stop` 发送同样的类型。
- 类型：`ping / traceroute / dns / dhcp`。非 DHCP 需要目标地址；DHCP 探测使用设备 LAN 接口。
- Ping `count` 1–100；traceroute `maxHops` 1–20、`timeoutSec` 1–10。`source` 只能是设备自己的 IPv4 地址。
- 轮询 `flag` 为 0=无任务、1=运行中、2=有任务但已结束，同时读取 `running` 和 `output`。诊断执行网络探测，不修改网络配置；同步返回 `success:false` 表示探测失败，不必然是 HTTP 接口失败。

### 系统与备份

| 操作 | 行为 |
| --- | --- |
| `POST /system/backup/download {}` | 返回 JSON 信封，`data.contentBase64` 解码后才是备份文件；备份可能含敏感配置 |
| `POST /system/restore {backup:...}` | 传已解析的自研 JSON 备份，进入恢复/回滚流程；原厂 014 的 tar.gz 不适用于此接口 |
| `POST /system/time {config:...}` | 应用时区/NTP 配置，有事务确认流程；时区使用 POSIX TZ，例如 CST-8 |
| `POST /system/time/browser {localTime:...}` | 立即设置设备时钟，格式 YYYY-MM-DD HH:mm:ss，不是确认倒计时任务 |
| `POST /system/sche-reboot {config:...}` | 保存定时重启配置，有事务；mode 0=关闭、1=倒计时、2=指定时间；weeks 使用现有 DTO 位掩码 |
| `POST /system/password {oldPassword,newPassword}` | 修改管理 root 密码；当前服务端要求新密码 5–32 位、不同于原密码，页面可采用更严格校验 |
| `POST /system/reboot {}` | 约 3 秒后发起实际重启，没有配置回滚 |
| `POST /system/factory-reset {confirmToken:"RESET"}` | 清空可写配置后重启，不能作为普通页面联调操作 |

## 9. 常见联调问题

| 现象 | 排查 |
| --- | --- |
| 页面有数据但不像设备实际状态 | 核对是否普通 development/Mock 模式；用本文 openwrt 启动命令，并在 Network 看请求是否到 `/cgi-bin/mp716/` |
| 请求落到 `cgi_huayi.cgi` | 使用了原厂适配器，检查模式、环境变量及重启开发服务 |
| 401 | 看 Authorization 是否存在、令牌是否过期；localhost 与设备页面的 localStorage 分属不同来源，要分别登录 |
| 浏览器 CORS / OPTIONS 报错 | 将 API URL 改成相对路径并走本地 Vite 代理 |
| 409 DEVICE_BUSY | 查看仍在等待确认/回滚的任务；不要并行发送多个保存操作 |
| 页面保存了但尚未生效 | 读任务 phase，等待应用完成，不只看 accepted |
| 改 LAN/Wi-Fi 后请求断开 | 管理地址或链路可能正在变更；按任务实际状态重连和确认，不反复提交 |
| 返回 NOT_IMPLEMENTED | 对照设备能力清单；方法名存在不表示已安装和开放对应服务 |
| 更换文件后仍显示旧验签结果 | 清理当前前端报告状态，重新上传；签名成功与版本检查失败须分别展示 |

在完整固件仓库中可通过 `node scripts/generate-native-api-docs.mjs` 更新生成的接口清单和 OpenAPI。生成器只读取源码并写文档，不连接设备；当前不涉及重新打包或部署固件。
