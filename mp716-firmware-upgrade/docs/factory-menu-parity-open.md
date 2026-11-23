# 原厂菜单 vs 自研开放状态（对齐后 2026-11-23）

侧栏已与原厂 **29 菜单叶** 1:1，详见 [current-menu-factory-parity.md](../../openwrt_system/docs/current-menu-factory-parity.md)。

## 菜单内（29 叶 + 顶栏 5 类）

首页、网络×5、无线×3、终端×1、高级 VPN×7、系统×9、工具×3 — 均有 Vue 路由与 `mp716-native/v1` 接口。

## 已移出侧栏

DNS / DDNS / 无线终端独立页、QoS、静态路由、安全设置（防火墙/转发/DMZ/UPnP）— 路由重定向到 WAN、终端或 VPN 默认页。

## 刻意保持

- `flashUpgradeEnabled=false`：升级页仅验签  
- `wanModes: ['wired']`：蜂窝未接 modem 栈  
- 无 HYID / 无 `cgi_huayi.cgi`

## Bundle 未菜单化

4G/短信、多 SSID、URL 过滤等 — [factory-full-parity-roadmap.md](./factory-full-parity-roadmap.md)