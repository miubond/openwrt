# 原生后台页面契约核对

参考主源码：`D:\goweb\src\openwrt_system`，核对实际 `src/router/index.ts` 的 31 个页面入口。仅存在源码而被路由重定向的 Firewall、Port Forward、QoS、DMZ、DDNS、UPnP、DNS 独立页不作为已开放菜单功能；不能靠这些页面文件数量宣称已完成全部服务。

| 实际页面 | 原生接口/操作 | 保存与回滚要求 |
| --- | --- | --- |
| 登录 | `auth/prelogin`、`auth/login`、`auth/logout`，Bearer 会话 | 不把原厂 Cookie 当原生会话 |
| 快速向导 | GET/POST `wizard/quick`、POST `wizard/complete` | WAN+Wi-Fi 在同一个配置任务中确认/撤销 |
| 首页 | `system/info`、`network/wan/status`、`wireless/status`、`home/physical-ports`、`hosts/connected` | 首页诊断调用同步 POST `tools/diagnostic` |
| WAN 设置/状态 | GET/POST `network/wan/config`、GET `network/wan/status` | DHCP/Static/PPPoE、DNS、MTU、克隆 MAC、AC/Service；按真实设备能力限制 Mobile/APN |
| LAN 设置/状态 | GET/POST `network/lan/config`、GET `network/lan/status` | 保存、确认、取消、超时回滚；改变管理地址可能暂时断开 |
| DHCP | GET/POST `network/dhcp/config`、POST `network/dhcp/static`、GET `hosts/connected` | 数字租期字符串、地址池与静态租约验证；不以成功上传代替应用成功 |
| 无线基础 | GET/POST `wireless/config` | SSID/密码、信道、带宽、模式、功率、隔离、终端上限；不提供后端会拒绝的模式选项 |
| 无线高级 | GET/POST `wireless/advanced` | 按 `supportsLegacyOptions`、`supportsDtim` 显示字段，真实应用与回滚 |
| 无线 ACL | GET/POST `wireless/acl`、GET `hosts/connected` | 加入/删除、确认、撤销，防止空白名单 |
| 终端管理 | `hosts/connected`、`hosts/device-acl` | 页面只使用 ACL 加入/移除，没有调用 `hosts/disconnect` 按钮 |
| PPTP/L2TP 服务器 | GET/POST `vpn/pptpd`、`vpn/xl2tpd` | 地址池、DNS、MTU/MRU、MPPE/IPSec，不能只保存 JSON 而不启动对应服务 |
| PPTP/L2TP 客户端 | GET/POST `vpn/pptp`、`vpn/xl2tp` | 凭据遮罩保留、路由、真实连接状态；L2TP 客户端/服务器冲突检查 |
| VPN 用户 | GET/POST `vpn/users` | 新增、编辑、删除有设备任务；撤销后重新加载原列表 |
| VPN 状态 | GET `vpn/online`、POST `vpn/online/disconnect` | 仅返回真实活跃 PPP 会话，PID+启动时间校验，不能断开无关进程 |
| OpenVPN | GET/POST `vpn/openvpn`、POST `vpn/openvpn/upload` | 真实文件内容上传；配置/证书各自类型；上传及设置都要确认/回滚 |
| 设备信息 | GET `system/device` | `softwareVersion` 为固件版本；`webuiVersion` 应来自独立 Web 包元数据 |
| 固件管理 | GET `system/firmware`、POST `system/firmware-package/verify` | 本阶段只能上传并校验，沿用原签名格式，不打开刷写门 |
| 恢复出厂/重启 | POST `system/factory-reset`、`system/reboot` | 仅做隔离命令计划测试，保留配置阶段不在现机调用 |
| 系统配置 | POST `system/backup/download`、`system/restore` | 原生 JSON 备份，受限文件和权限、证书备份；恢复可撤销，不接受原厂二进制包冒充原生配置 |
| 定时重启 | GET/POST `system/sche-reboot` | 与页面 10 分钟下限一致；设备时区、周位图、倒计时 boot/uptime，确认前不得触发重启 |
| NTP | GET/POST `system/time`、POST `system/time/browser` | 固定 3 槽位语义、合法 POSIX 时区、实际服务开关；回滚重载旧设置 |
| 系统日志 | GET/POST `system/logs`、POST `system/logs/clear` | 新路由优先于旧 core GET；开关有任务；浏览器下载实际内容 |
| 管理员设置 | POST `system/password` | 验旧密码后改 root；本轮仅测试隔离身份/命令夹具，不改现机密码 |
| Ping/路由跟踪/DHCP 检测 | POST `tools/diagnostic/start`、`poll`、`stop` | 真实有界 worker、输出、停止与会话隔离；不会更改网卡或 DHCP 配置 |

## 本轮诊断修复与测试

- 原生模式仅接受 IPv4/DNS 目标，拒绝协议、端口、路径、命令选项；可空源地址表示自动选择，指定地址必须为本机 IPv4。原厂校验规则独立保留。
- worker 的过程身份同时检查 PID、启动时间、进程组与 session；最多 4 个活跃检测，旧输出与过期目录有界清理。
- DHCP 使用 `mp716-dhcp-discover` 的 DISCOVER/OFFER 模式，不执行 udhcpc、不发送 REQUEST、不申请正式租约、不设置地址/路由。收集多个服务器，直接回复的 MAC 使用报文真实来源；经 relay 的未知服务器 MAC 留空。
- DHCP 报文宿主测试覆盖 18 个有效/异常包，未打开网络 socket。
- DHCP 报文与选项按 [RFC 2131](https://www.rfc-editor.org/rfc/rfc2131) 和 [RFC 2132](https://www.rfc-editor.org/rfc/rfc2132) 编码、检查。
- 页面组件测试覆盖 Ping 开始/停止、空源地址、原厂必填边界；OpenVPN 实际 File 选择、上传、确认、撤销、设置回滚；VPN 用户新增、删除确认、列表回滚与显式确认。

上述组件测试证明页面与接口契约；隔离 ucode 夹具证明配置计划和回滚。它们不等于 VPN 远端互通、无线芯片各模式或固件启动已经实机验收。交换机物理端口映射未确认时，只能显示原始端口编号及未验证状态。
