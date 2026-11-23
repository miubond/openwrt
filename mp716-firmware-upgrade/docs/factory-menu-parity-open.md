# 原厂菜单 vs 自研开放状态（2026-11-23）

对照 [FACTORY-FEATURE-LIST.md](../../openwrt_system/firmware/reports/FACTORY-FEATURE-LIST.md) 顶栏 5 类 + 约 30 条 React 路由。

## 已开放（菜单 + 路由 + 原生 API）

| 原厂区域 | 自研菜单/路由 | 后端 |
|----------|---------------|------|
| 首页 | `/` | `home/dashboard` 等 |
| WAN/LAN/DHCP/状态 | `nav.network` | `network/*` |
| **DNS** | `/network/dns`（原重定向已移除） | `network/dns/config` |
| **DDNS** | `/network/ddns` | `network/ddns` |
| **QoS** | `/network/qos`（原重定向已移除） | `network/qos/capability` + `config`（未启 SQM 时只读/拒写） |
| 无线基础/高级/ACL | `nav.wifi` | `wireless/*` |
| **无线终端** | `/wifi/clients` | `wireless/clients` |
| 终端管理 | `/devices` | `hosts/*` |
| VPN 全套 | `advanced` → VPN | `vpn/*` |
| 防火墙/DMZ/UPnP/转发 | `advanced` → 安全 | `firewall/*`、`network/upnp` |
| 系统管理各叶 | `advanced` → 系统 | `system/*` |
| Ping/Tracert/DHCP 检测 | `advanced` → 工具 | `tools/diagnostic/*` |

## 菜单可见、能力待补

| 功能 | 路由 | 说明 |
|------|------|------|
| 静态路由 | `/network/static-route` | 占位页；HYID 12/13 待 `network/static-routes` API |
| QoS 写入 | 同上 Qos 页 | 设备返回 `supported:false` 直至接 SQM |

## 原厂 Bundle、暂不菜单化（需硬件/大项）

4G/短信/SIM、多 SSID、无线定时/扫描、URL/MAC 全局过滤、双线路、HWNAT、WAN Ping、蜂窝 APN 等 — 见 [factory-full-parity-roadmap.md](factory-full-parity-roadmap.md)。

## 刻意保持

- `flashUpgradeEnabled=false`：升级页可见，仅验签/说明
- 无 HYID / 无 `cgi_huayi.cgi`