# 原厂功能全盘对齐路线图

对照 [FACTORY-FEATURE-LIST.md](../../openwrt_system/firmware/reports/FACTORY-FEATURE-LIST.md) 与当前原生栈（Vue 0.2.1 + `mp716-native/v1`）。

## 边界（无法 1:1 克隆的部分）

| 类别 | 说明 |
|------|------|
| **HUAYI 协议** | 自研固件不提供 `cgi_huayi.cgi` / HYID 号码；功能以原生 REST 等价实现 |
| **4G / Modem** | `cgi_modem.cgi`、短信、SIM/PIN、APN、信号条 — 需模组驱动与独立服务，当前 `capabilities.wanModes` 仅 `wired` |
| **华翼闭源行为** | 双线路、sysmode、ThinAP、多 SSID、无线定时扫描等黑盒逻辑需逐项用 OpenWrt 重写 |
| **Stream 刷机链** | 原厂 `cgi_stream.cgi` 与 `huayi-reset` 已替换为验签 sysupgrade 门，生产默认 **validationOnly** |

## 分层与状态

### A. 原厂 menulist（≈29 叶 + 登录/向导）

**目标：菜单与读写能力对齐。** 当前：**已基本完成**（网络/无线/终端/VPN/系统/工具均有页与原生 API）。缺口见 [native-page-contract-audit.md](native-page-contract-audit.md)。

### B. Bundle 内无菜单能力（原厂约 108 个读写动作）

| 能力 | 原厂 HYID/动作 | 自研状态 |
|------|----------------|----------|
| IP/端口过滤、端口转发 | 20/51、54/55 | **已实现** `firewall/rules`、`firewall/port-forwards`（OpenWrt UCI） |
| DMZ | 52/53 | **已实现** `firewall/dmz` |
| UPnP | 56/57 | **已实现** `network/upnp`（`upnpd` UCI，无包则只读提示） |
| DDNS | 63/64 | **已实现** `network/ddns`（`ddns` UCI，无包则只读提示） |
| 静态路由 | 12/13 | **已实现** `network/static-routes`（UCI `mp716_rt_*`） |
| QoS | 47/48 | **条件可用** `network/qos/*`（需 `sqm` 包；`99-mp716-sqm-defaults` 种子队列） |
| URL/MAC 全局过滤 | 16–19 | 待评估（与防火墙/ACL 合并） |
| 无线：多 SSID/定时/扫描 | 86–110 | 待做（依赖 mac80211 能力） |
| 远程管理、HWNAT、WAN Ping | 14–59、43–44 | 待做 |

### C. 系统与升级

| 能力 | 状态 |
|------|------|
| 网页在线刷写 | `flashUpgradeEnabled` 时 **验签→刷写闭环** 见 [factory-upgrade-closed-loop.md](./factory-upgrade-closed-loop.md)；生产默认 flash 门关闭 |
| 备份/恢复 | JSON 原生路径，非 stream 2/3 |
| 语言包切换 | 前端 i18n 已支持，无单独 HYID 3/4 页 |

## 建议波次

1. **B1 安全与 NAT 辅助**（进行中）：防火墙、端口转发 → DMZ、UPnP  
2. **B2 网络扩展**：DDNS、静态路由、远程管理只读  
3. **B3 无线扩展**：多 SSID / 定时（按芯片实测裁剪）  
4. **B4 QoS**：若设备 RAM/CPU 允许，接 `sqm` 或 `qos-scripts`  
5. **C1 升级门**：实验室开启 `flashUpgradeEnabled` + [闭环验收](./factory-upgrade-closed-loop.md#验收清单c1参考原厂一次网页升级)  
6. **Modem**（仅当硬件确认有蜂窝）：独立子项目，不复刻 HYID

## 验收口径

- **菜单叶**：每页至少一条 GET + 必要 POST，保存走 config-task 确认/回滚  
- **Bundle 能力**：列入 `native-routes.json` + `capabilities` 声明  
- **不等于**：字节级 HYID 兼容、原厂 React 字段名一致

更新日期：2026-11-23