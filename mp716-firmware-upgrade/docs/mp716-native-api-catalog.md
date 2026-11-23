# MP716 原生接口完整清单

由 `scripts/generate-native-api-docs.mjs` 生成。共 72 条声明路由；请求和响应均指 JSON 信封内的 `data`，二进制上传除外。详细鉴权、限制、参数 Schema 与本地代理方式见 [联调文档](mp716-native-web-api.md) 和 [OpenAPI](mp716-native-openapi.json)。

| 方法 | 完整路径 | 说明 | 请求体 | 成功 data |
| --- | --- | --- | --- | --- |
| GET | `/cgi-bin/mp716/auth/prelogin` | 登录前状态 | — | PreLoginConfig |
| GET | `/cgi-bin/mp716/home/physical-ports` | 物理网口状态与核验标记 | — | PhysicalPortStatus[] |
| GET | `/cgi-bin/mp716/hosts/connected` | 终端列表 | — | ConnectedDevice[] |
| GET | `/cgi-bin/mp716/hosts/device-acl` | 终端禁止上网列表 | — | DeviceAclEntry[] |
| GET | `/cgi-bin/mp716/network/dhcp/config` | DHCP 配置与静态租约 | — | DhcpConfig |
| GET | `/cgi-bin/mp716/network/dns/config` | DNS 配置 | — | DnsConfig |
| GET | `/cgi-bin/mp716/network/lan/config` | LAN 配置 | — | LanConfig |
| GET | `/cgi-bin/mp716/network/lan/status` | LAN 状态 | — | LanStatus |
| GET | `/cgi-bin/mp716/network/wan/config` | WAN 配置 | — | WanConfig |
| GET | `/cgi-bin/mp716/network/wan/status` | WAN 状态与流量采样 | — | WanStatus |
| GET | `/cgi-bin/mp716/system/capabilities` | 设备接口和服务能力 | — | NativeCapabilities |
| GET | `/cgi-bin/mp716/system/config-task/{id}` | 配置任务状态 | — | ConfigTaskStatus |
| GET | `/cgi-bin/mp716/system/device` | 设备资料 | — | DeviceInfo |
| GET | `/cgi-bin/mp716/system/firmware` | 固件版本与仅校验能力 | — | FirmwareInfo |
| GET | `/cgi-bin/mp716/system/info` | 系统信息 | — | SystemInfo |
| GET | `/cgi-bin/mp716/system/logs` | 日志开关和最近 200 行日志 | — | SystemLogState |
| GET | `/cgi-bin/mp716/system/ping` | 检查会话及 API 存活；不探测外网 | — | object |
| GET | `/cgi-bin/mp716/system/sche-reboot` | 定时重启配置 | — | ScheRebootConfig |
| GET | `/cgi-bin/mp716/system/status` | 运行状态 | — | SystemStatus |
| GET | `/cgi-bin/mp716/system/time` | 时区与 NTP 配置 | — | SystemTimeConfig |
| GET | `/cgi-bin/mp716/vpn/online` | VPN 在线会话 | — | VpnOnlineUser[] |
| GET | `/cgi-bin/mp716/vpn/openvpn` | OpenVPN 客户端配置 | — | OpenVpnConfig |
| GET | `/cgi-bin/mp716/vpn/pptp` | PPTP 客户端配置 | — | PptpClientConfig |
| GET | `/cgi-bin/mp716/vpn/pptpd` | PPTP 服务器配置 | — | VpnServerConfig |
| GET | `/cgi-bin/mp716/vpn/users` | VPN 用户及地址池 | — | VpnUserConfig |
| GET | `/cgi-bin/mp716/vpn/xl2tp` | L2TP 客户端配置 | — | L2tpClientConfig |
| GET | `/cgi-bin/mp716/vpn/xl2tpd` | L2TP 服务器配置 | — | VpnServerConfig |
| GET | `/cgi-bin/mp716/wireless/acl` | 无线 MAC 访问控制 | — | WirelessAclConfig |
| GET | `/cgi-bin/mp716/wireless/advanced` | 无线高级配置 | — | WifiAdvancedConfig |
| GET | `/cgi-bin/mp716/wireless/clients` | 无线关联终端 | — | WirelessClient[] |
| GET | `/cgi-bin/mp716/wireless/config` | 无线基础配置 | — | WifiConfig |
| GET | `/cgi-bin/mp716/wireless/status` | 无线运行状态 | — | WifiStatus |
| GET | `/cgi-bin/mp716/wizard/quick` | 快速设置向导状态 | — | QuickSettingState |
| POST | `/cgi-bin/mp716/auth/login` | 登录并创建 rpcd 会话 | 见 OpenAPI Schema | LoginResult |
| POST | `/cgi-bin/mp716/auth/logout` | 退出当前会话 | {} | null |
| POST | `/cgi-bin/mp716/hosts/device-acl` | 立即加入/解除终端禁止上网列表；无配置任务倒计时 | mac, action | null |
| POST | `/cgi-bin/mp716/hosts/disconnect` | 断开当前无线会话；不能断开当前管理终端或有线终端 | deviceId | null |
| POST | `/cgi-bin/mp716/network/dhcp/config` | 保存DHCP 配置与静态租约，进入应用/回滚流程 | { config: DhcpConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/network/dhcp/static` | 整表替换静态租约，非单条追加；可回滚 | 见 OpenAPI Schema | ConfigApplyResult |
| POST | `/cgi-bin/mp716/network/dns/config` | 保存DNS 配置，进入应用/回滚流程 | { config: DnsConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/network/lan/config` | 保存LAN 配置，进入应用/回滚流程 | { config: LanConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/network/wan/config` | 保存WAN 配置，进入应用/回滚流程 | { config: WanConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/system/backup/download` | 导出配置；返回 JSON 信封中的 Base64 内容，不是直接文件流 | {} | BackupDownload |
| POST | `/cgi-bin/mp716/system/config-task/cancel` | 请求撤销并等待设备完成回滚 | taskId | ConfigTaskStatus |
| POST | `/cgi-bin/mp716/system/config-task/confirm` | 仅在 phase=applied 时确认当前会话拥有的任务 | taskId | ConfigTaskStatus |
| POST | `/cgi-bin/mp716/system/factory-reset` | 清空可写配置并重启；危险操作，无应用倒计时回滚 | confirmToken | ConfigApplyResult |
| POST | `/cgi-bin/mp716/system/firmware-package/verify` | 上传原始 .mp716upd 字节并验签；不刷写固件 | 原始二进制 .mp716upd | FirmwareVerificationReport |
| POST | `/cgi-bin/mp716/system/logs` | 保存日志开关并应用，可回滚 | enabled | ConfigApplyResult |
| POST | `/cgi-bin/mp716/system/logs/clear` | 清空日志缓冲区 | {} | null |
| POST | `/cgi-bin/mp716/system/password` | 修改 root 管理密码；不是配置倒计时任务 | 见 OpenAPI Schema | null |
| POST | `/cgi-bin/mp716/system/reboot` | 接受后约 3 秒发起重启 | {} | ConfigApplyResult |
| POST | `/cgi-bin/mp716/system/restore` | 恢复自研 JSON 配置备份并进入应用/回滚流程 | backup | ConfigApplyResult |
| POST | `/cgi-bin/mp716/system/sche-reboot` | 保存定时重启配置，进入应用/回滚流程 | { config: ScheRebootConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/system/time` | 保存时区与 NTP 配置，进入应用/回滚流程 | { config: SystemTimeConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/system/time/browser` | 立即设置设备本地时钟；不是配置倒计时任务 | localTime | null |
| POST | `/cgi-bin/mp716/tools/diagnostic` | 同步网络检测，最多等待约 10 秒；success 描述探测结果 | 见 OpenAPI Schema | DiagnosticResult |
| POST | `/cgi-bin/mp716/tools/diagnostic/poll` | 读取当前会话检测进度；该 POST 不修改持久配置 | 见 OpenAPI Schema | DiagnosticPoll |
| POST | `/cgi-bin/mp716/tools/diagnostic/start` | 启动当前会话的异步检测 | 见 OpenAPI Schema | null |
| POST | `/cgi-bin/mp716/tools/diagnostic/stop` | 停止当前会话的检测进程 | 见 OpenAPI Schema | null |
| POST | `/cgi-bin/mp716/vpn/online/disconnect` | 断开指定受管 PPP VPN 会话 | pid | null |
| POST | `/cgi-bin/mp716/vpn/openvpn` | 保存OpenVPN 客户端配置，进入应用/回滚流程 | { config: OpenVpnConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/vpn/openvpn/upload` | Base64 JSON 上传并持久保存 VPN 配置/证书，可回滚；单文件解码后最多 256 KiB | filename, kind, contentBase64 | ConfigApplyResult |
| POST | `/cgi-bin/mp716/vpn/pptp` | 保存PPTP 客户端配置，进入应用/回滚流程 | { config: PptpClientConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/vpn/pptpd` | 保存PPTP 服务器配置，进入应用/回滚流程 | { config: VpnServerConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/vpn/users` | 保存VPN 用户及地址池，进入应用/回滚流程 | { config: VpnUserConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/vpn/xl2tp` | 保存L2TP 客户端配置，进入应用/回滚流程 | { config: L2tpClientConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/vpn/xl2tpd` | 保存L2TP 服务器配置，进入应用/回滚流程 | { config: VpnServerConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/wireless/acl` | 保存无线 MAC 访问控制，进入应用/回滚流程 | { config: WirelessAclConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/wireless/advanced` | 保存无线高级配置，进入应用/回滚流程 | { config: WifiAdvancedConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/wireless/config` | 保存无线基础配置，进入应用/回滚流程 | { config: WifiConfig } | ConfigApplyResult |
| POST | `/cgi-bin/mp716/wizard/complete` | 完成快速设置并持久保存标记 | {} | null |
| POST | `/cgi-bin/mp716/wizard/quick` | 同时应用有线 WAN 与 2.4GHz Wi-Fi，可能断开当前管理连接 | 见 OpenAPI Schema | QuickSettingApplyResult |

共享 DTO 中的原厂兼容字段不表示当前固件支持对应能力。未列入本清单的 V2 刷写、QoS、防火墙和端口转发方法不能仅因前端存在方法名而调用。
