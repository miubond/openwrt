# 原生 VPN 接口与服务

`vpn.uc` 提供 PPTP/L2TP 客户端与服务器、用户、在线会话、OpenVPN 设置和文件上传。设置落入独立 UCI 包 `mp716_vpn`；网络与防火墙仅修改 `mp716_managed=1` 的 `mp716_vpn_*` 节。配置提交仍由统一待确认任务处理，未确认按原字节回滚。

`vpn-runtime.uc` 重新校验保存或导入的模型，并纯生成 PPP、PPTPD、XL2TPD、OpenVPN、StrongSwan 配置；`vpn-render.uc` 先通过 `vpn-services.uc` 统一检查依赖和非托管守护进程冲突，再将配置写入 `/var/run/mp716-vpn`。`mp716-vpn.init` 用独立 procd 实例启动守护进程。默认所有 VPN 关闭时不启动实例、不挂载密钥文件、不重载网络或防火墙。

PPTP/L2TP 客户端使用短 UCI 名 `mp716pptp` / `mp716l2tp`，确保 netifd 加协议前缀后的内核接口名不超过 15 字节。客户端初始 `auto=0`，由托管服务在守护进程、控制 FIFO 和 IPSec 规则就绪后显式启用，避免 network 的早期启动调用无关 XL2TPD 实例。单独启用 PPTP 客户端也会实际重载并启用对应接口。

`vpn-health.uc` 在服务配置提交后最多轮询 15 秒，确认所需 procd 实例真实运行，关闭的实例也必须实际停止；输出只含实例名和状态，不含凭据。这是进程就绪检查，不能代替 VPN 隧道连接验收。OpenVPN 状态在认证后的 `route-up` 记录，通过 `route-pre-down`、`down` 和 `up-restart` 清除重连或断开的陈旧状态。

PPP 认证必须读取其全局 `chap-secrets`：本服务保留原文件，在 RAM 中合并原凭据及自研用户，通过 bind mount 临时覆盖；停用后卸载，原文件不重写。PPP 与 OpenVPN 上下线钩子记录真实 PID、`/proc` 启动时间、接口、用户与地址，过期 PID 不作为在线会话，也不能被断开接口误杀。静态用户路由使用 `ip route add`，不覆盖既有路由。

L2TP/IPSec 先安装 UDP 1701 明文拒绝规则，再允许 `reqid=902` 的真实 XFRM 流量。缺少 `nft_xfrm` 时规则应用失败、保持拒绝，不启动该服务。VPN 区显式排除 `pppoe+` 以及实际 WAN 三层设备，避免通用 PPP 匹配把 PPPoE WAN 当作 VPN 客户端。

## 交付依赖

安装以下文件：

- `/usr/share/mp716/`：`vpn.uc`、`vpn-config.uc`、`vpn-runtime.uc`、`vpn-render.uc`、`vpn-hook.uc`、`vpn-services.uc`、`vpn-health.uc`。
- 同目录可执行脚本：`vpn-ppp-up.sh`、`vpn-ppp-down.sh`、`vpn-openvpn-up.sh`、`vpn-openvpn-down.sh`。
- `/etc/init.d/mp716-vpn`：来自 `mp716-vpn.init`。

软件包：`ppp-mod-pptp`、`pptpd`、`xl2tpd`、`openvpn-mbedtls`、`strongswan-isakmp`、`strongswan-mod-kdf`、`strongswan-mod-sha2`、`kmod-nft-xfrm`。固定 StrongSwan 包自身引入 `kmod-ipsec`、`kmod-ipsec4` 和基础加密依赖；PPP/PPTPD 包引入 `kmod-mppe`。还需要已有的 `jsonfilter`、`nft`、`ip` 及 BusyBox mount/umount/readlink/cp。

首次生成新镜像时应关闭软件包默认的 PPTPD/XL2TPD/OpenVPN/IPSec 自动实例，避免与托管实例冲突。不得在现机自动关闭已有非托管服务。启用接口发现非托管 PPTPD/XL2TPD/StrongSwan 守护进程会拒绝，并通过 `serviceAvailable`、`serviceMessage` 在读取时报告；缺少二进制也同样报告。

## 明确限制

- 原生 PPP 2.5.2 使用有效的 `require-mppe-128`（MPPE=0）及 `nomppe`（MPPE=2）。不支持可选 MPPE=1；启用时明确拒绝。
- OpenVPN 支持 TUN。表单模式生成 UDP 客户端且要求 CA；上传模式支持受限的客户端指令并重验固定证书路径，拒绝自定义脚本、插件、外部 include 和任意凭据路径。含 `auth-user-pass` 的上传配置须提供用户名与密码。
- PPTP/L2TP 服务端地址池使用 /24。L2TP 服务器与客户端不可同时启用；新增启用服务器前检查池与现有接口网段重叠。用户固定地址须在对应池中且不重复。
- 这些服务文件不意味着现机已装包或远端互通已通过。该轮服务编排测试全部使用桩；实际守护进程启动、内核 XFRM/PPP、bind mount 和外部隧道必须在后续独立验收中验证。本轮不安装软件包、不写固件、不重启设备。

纯渲染测试：`tests/vpn-runtime.uc`。本地服务编排桩测试：`tests/integration/test_vpn_service.py`。

## WireGuard（仅客户端）

当前产品范围：路由器作为 **WireGuard 客户端** 接入外部隧道，不提供本机 WireGuard 服务器管理界面或 API。`wireguard.uc` 仍保留服务器侧 UCI 同步代码，用于清理历史配置；`vpn.uc` 对 `wireguard/server*` 请求返回「当前版本仅支持 WireGuard 客户端」。

`wireguard.uc` 持有客户端与共享逻辑（模型、校验、导入、密钥、UCI 生成、状态），不依赖 CGI 请求对象，`vpn.uc` 与 `experiment/rpcd-mp716-wireguard.uc` 复用它。协议由内核 `kmod-wireguard` 与 netifd `proto wireguard` 实现，本模块只写 UCI，不运行 `wg-quick`，也不执行配置中的脚本。

接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `vpn/wireguard/client` | 掩码视图，附 `serviceAvailable`/`serviceMessage` |
| GET | `vpn/wireguard/status` | 客户端接口状态、最近握手、收发字节、对端 Endpoint |
| POST | `vpn/wireguard/client` | 走统一配置任务（锁、确认、超时回滚） |
| POST | `vpn/wireguard/client/import` | 解析 wg-quick 客户端文件（≤8KB），保存为停用状态 |

模型以 JSON 存于 `mp716_vpn.wgclient`（文件 0600）。写入时 `********` 表示保留原值，`generate` 表示在路由器上生成，预共享密钥 `''` 表示清除。查询响应只返回 `hasPrivateKey`，普通 GET **不返回私钥明文**。已保存的私钥不会被自动覆盖；启用时若无私钥会拒绝，须由用户确认后生成。密钥经 0600 临时文件传给 `wg pubkey`，用后删除，不出现在命令行或日志。导入后的私钥仅保存在路由器侧配置中，前端保存或关闭后会清空输入框。

`GET vpn/wireguard/status` 区分：客户端是否已启用、接口是否 up、最近握手（`handshakeState`: none/recent/stale）、收发字节、以及经 `mp716wgc` 的 ICMP 探测（缓存约 20 秒）。**接口 up 不等于连接成功**；**握手超过 180 秒也不把隧道判死**。探测失败单独给出 `probe.state=fail` 与原因。`GET vpn/wireguard/client` 附带 `reservedNets`（LAN/WAN 等）供页面提示路由冲突。

客户端启用时生成：

- network：接口 `mp716wgc`，Peer 节 `mp716_vpn_wgc_peer`。
- firewall：区 `mp716wgc`（input/forward REJECT，masq，可选 lan→wgc 转发）。WireGuard 区与 PPTP/L2TP 的 `mp716_vpn` 区互不包含；停用后删除 `mp716_vpn_wg*` 节与 `mp716wgc`。

路由：分流模式只安装用户填写的 AllowedIPs（可含 IPv6），并拒绝 /0–/7 以及与 LAN、WAN、已启用 PPP 地址池重叠的网段。不要把 `0.0.0.0/0` 写进 AllowedIPs 冒充全局。全局模式必须显式勾选 `allowGlobalRoute`，以 `0.0.0.0/1` + `128.0.0.0/1`（有 IPv6 时再加 `::/1` + `8000::/1`）实现，不删除、不替换 WAN 默认路由，并写入 `lookup main` 的 ip rule 保护 LAN/WAN 直连网段。netifd 自动为 Endpoint 固定经 WAN 的主机路由。从非直连网段做 WAN 侧远程管理时仍应使用分流模式。

导入拒绝 `PreUp/PostUp/PreDown/PostDown`，忽略 `Table`/`FwMark` 并给出警告；IPv6 地址与 AllowedIPs 会保留。含 `0.0.0.0/0` 或 `::/0` 的文件导入为全局模式但保持停用。

提交后 reload 命令为 `ubus call network reload && /etc/init.d/firewall reload && ucode wg-health.uc`；`wg-health.uc` 最多等待 12 秒确认接口 up/down，只输出接口名和状态。

依赖：`kmod-wireguard`、`wireguard-tools`（含 `/usr/bin/wg` 与 `/lib/netifd/proto/wireguard.sh`）。`capabilities.uc` 只有在三者都存在时才报告 `wireguard`；缺少任一项时可以查看和保存停用配置，但启用会被拒绝并列出缺失组件。内核模块必须随设备内核一起编译，不得安装官方源中版本号不匹配的 kmod。

测试：`tests/wireguard.uc`（设备或原生环境运行，含密钥用例需 `/usr/bin/wg`）。
