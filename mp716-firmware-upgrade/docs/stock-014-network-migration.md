# 原厂 014 网络迁移计划

1.0.1 只配置直接连接的 LAN，不能据此宣布具备完整路由功能。1.0.2 候选增加原厂实测的 VLAN、DHCP WAN、firewall4 和 nftables 版 UPnP。此文和构建成功均不代表新镜像已在设备启动。

## 原厂只读证据

2026-11-18 读取 `switch vlan dump`、交换机寄存器、接口状态和配置备份，无 Flash 写入：

| 项 | 测量值 |
|---|---|
| VLAN 1 | `1111-11`，端口 0、1、2、3、5、6 |
| VLAN 2 | `----1-1`，端口 4、6 |
| PVID 寄存器 0x40 / 0x44 / 0x48 | `0x1001` / `0x1001` / `0x1002` |
| 出站去标签寄存器 0x98 | `0x7f3f`，外部端口 0–5 去标签，CPU 6 保留标签 |
| 原厂 LAN / WAN | `br-lan`、`eth0.1` / DHCP `eth0.2`，WAN MTU 1499 |
| MAC | 原厂配置和运行接口与该设备 EEPROM 基础 MAC +2 / +3 一致 |

端口 5 按原厂保留 LAN 成员，但其物理用途未确认。LAN1–LAN4 标签与芯片端口的逐口对应仍为 TODO。端口角色依据本机测量，未直接套用 EVB 端口编号。

## 离线准备私有配置

在项目目录运行，输出目录必须尚不存在：

```sh
python3 scripts/plan-stock-migration.py /private/backup-current.tar.gz --output build/private-migration
```

工具不连接设备，不应用配置，不运行升级命令。输出：

- `migration.uci`：只转换支持的字段，保留设备自己的 MAC、管理地址、Wi-Fi、DHCP、WAN、NTP、UPnP。
- `root-password.hash`：设备 root 哈希，后续首次启动时合并到新系统 shadow，保留其他系统账户。
- `mp716-stock-014-migration.tar.gz`：供经核验的 OpenWrt 配置恢复流程使用，内含受板型与设备配置检查保护的首次启动脚本；不是镜像或原厂上传文件。
- `migration-report.json`：不含密码，记录来源 SHA256、迁移范围、归档 SHA256 以及尚未应用的状态。

仅有这个配置归档不会修改通用 sysupgrade 镜像。通用下载包不含设备的 SSID、密码和 IP。不能把原厂完整备份覆盖到新系统；原厂 VLAN 写法、无线驱动、厂商 CGI、VPN 和业务二进制都与新系统不同。

目前只转换实测的有线路由 + DHCP WAN 模式。检测到已启用的 VPN、QoS、DDNS、DMZ、端口转发、ACL 或不同 WAN 模式时拒绝生成，需补充适配。关闭的可选功能保留在原始备份，未宣称可用。原厂 WAN HTTP 管理若已开启，私有计划会保留 IPv4 TCP/80 例外；公共镜像保留上游 WAN 默认拒绝。

DNS/DHCP 服务参数采用白名单转换，旧系统的解析文件路径不直接沿用。原厂关闭 WAN ping 时，私有计划会关闭固定 firewall4 默认的 `Allow-Ping` 规则；首次启动脚本先核对规则名称，避免规则顺序改变时误改其他策略。

## 构建与验证

OpenWrt 使用固定提交的 `feeds.conf.default`，packages 固定为 `093d551675b1119a06ef224d419905e8d6b2af1a`。CI 显式校验 feed 提交与 `firewall4`、`miniupnpd-nftables`、`swconfig`、`dnsmasq` 配置及实际镜像内文件。[官方固定 feeds](https://github.com/openwrt/openwrt/blob/v25.12.6/feeds.conf.default)；[上游板级网络辅助函数](https://github.com/openwrt/openwrt/blob/v25.12.6/package/base-files/files/lib/functions/uci-defaults.sh)。

候选验收仍需新系统的接口、WAN DHCP、DNS、NAT 转发、VLAN 隔离、无线认证、UPnP 映射与关闭后的清理测试。后台“网络状态”仅显示运行状态，不把原厂状态当成新固件的实机结果。当前保持 `UNVERIFIED`，不执行刷写。

2026-11-18 隔离验证：在原厂路由器唯一的 `/tmp/mp716-plan-check.*` 目录运行固定上游的 board 配置辅助函数与 `config_generate`，所有 UCI 调用通过 `-c` / `-P` 指向该临时目录。原厂旧版 jshn 不支持 `-o`，测试副本仅将 JSON 输出改为等效的文件重定向。生成的 LAN VLAN 为 `0 1 2 3 5 6t`，WAN 为 `4 6t`；迁移 UCI 解析成功。前后 `/etc/config/*` 与 Bootloader/Config/Factory SHA256、boot_id 一致，临时目录已删除。本机备份与私有测试结果未上传到公共 CI。这不是候选内核、NAT 转发或 Wi-Fi 射频实测。
