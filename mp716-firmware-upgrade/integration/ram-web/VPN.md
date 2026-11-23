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
