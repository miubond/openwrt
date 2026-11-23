# MP716 实机运行状态与原厂替换边界

**记录日期：** 2026-11-23  
**适用设备：** 实验室 MP716（管理地址 `192.168.199.1`）  
**当前运行：** 自研 OpenWrt **固件 1.0.7** + Vue Web **0.2.1**，接口契约 `mp716-native/v1`

本文说明「已从原厂 014 迁到自研」之后，Flash 与软件栈上**什么被替换、什么被保留**。与 [迁移说明](migration-014-to-v015.md)、[1.0.2 实机记录](mp716-1.0.2-device-test.md)、[1.0.5 实机记录](mp716-1.0.5-device-test.md) 及 [原生 Web 接口](mp716-native-web-api.md) 一致，供后续文档与热更新流程引用。

## 已覆盖替换（不与原厂并存）

下列项在成功刷写自研镜像后**不再作为运行栈保留**，也**不与自研后台同时在线**：

| 类别 | 原厂 014 | 当前自研 |
| --- | --- | --- |
| 系统分区 | `firmware` 内 Linux 3.10.108、原厂服务程序 | OpenWrt 自研 `firmware` 镜像（如内核 6.12、`yunxm,mp716`） |
| 管理 Web | 原厂 React SPA、`/static/js/main.*` 等 | 嵌入固件的 Vue 后台（`dist-openwrt`，根入口 `/` 与 `/mp716/`） |
| 管理 API | `/cgi-bin/cgi_huayi.cgi`、`cgi_stream.cgi` 等 HYID 协议 | `/cgi-bin/mp716/...` 原生 ucode 网关 |
| 升级入口 | 原厂网页 stream / `huayi-reset` 链 | 自研验签与 sysupgrade 门（生产在线升级仍受 [生产验收](production-acceptance.md) 约束） |

实机 HTTP 探针可用来复核：原生 `auth/prelogin` 可用、原厂华翼/Stream CGI 返回 404、根路径加载 Vue 资源，即表示**不是**「原厂系统仍在、仅叠加新页面」。

## 1.0.7 整包内容

固件 **1.0.7** 将以下组件**一起打包**进镜像（完整刷写或保配置 sysupgrade）：

- OpenWrt 系统、内核、驱动与网络服务
- Vue 前端页面与静态资源（主源码 [`openwrt_system`](../../../openwrt_system) 构建后经 `sync-web-reference.py` 嵌入本仓库 `web/`）
- 原生 ucode 接口（`httpd.uc`、`admin.uc` 等）、固件验签服务及配套公钥

**仅更新 Web 静态资源**（不重刷整包）时，仍运行在**同一套自研 1.0.7 系统**之上，不会恢复原厂页面或程序。见主源码 [`NATIVE-WEB.md`](../../../openwrt_system/NATIVE-WEB.md) 中「仅更新页面」流程。

涉及驱动、内核、系统包、`/usr/share/mp716/` 路由或验签策略的修改，须**重新构建并刷写固件**。

## 刻意保留项

### 配置与身份（「保留配置」）

经授权 `sysupgrade` 保配置升级时，可保留例如：

- 原 Wi‑Fi SSID/密钥与相关无线设置
- 管理地址（如 `192.168.199.1/24`）
- 管理员账号与 shadow 哈希（以实机迁移归档为准）
- LAN/WAN/DHCP/NAT/UPnP 等网络 UCI

**「保留配置」不等于保留原厂操作系统或原厂 Web。** 只是将**可迁移的配置**写入新的自研 rootfs，运行栈已全部替换为上表「自研」列。

### Flash 只读区

刷写时**不写入**（与刷前保护分区读回一致）：

- Bootloader
- Config
- Factory（含校准/EEPROM 等只读用途）

因此整片 Flash 上仍有能力通过串口/U-Boot 及离线原厂镜像做救砖；具体步骤以实机验收记录为准，不表示已标为 RELEASE。

### 离线备份

保存到**电脑本地**的原厂整片 Flash 或分区副本**不受设备上后续刷写影响**，仍可作为对照与恢复原料；此类备份不进 Git。

## 验收与发布门（不变）

设备已运行自研 1.0.7 **不自动**等同于：

- 产物标记 **RELEASE**
- 生产在线升级门打开
- 串口恢复、长期稳定性、全部功能页已浏览器逐项验收

上述仍以 [硬件兼容性报告](mp716-hardware-compatibility.md)、[生产验收](production-acceptance.md) 及对应版本实机记录为准。

## 相关文档

| 文档 | 用途 |
| --- | --- |
| [mp716-native-web-api.md](mp716-native-web-api.md) | 原生 API 与原厂路径对照、本地联调 |
| [migration-014-to-v015.md](migration-014-to-v015.md) | 首次迁移包与后续 sysupgrade 边界 |
| [mp716-web-hotfix-lp-integration.md](mp716-web-hotfix-lp-integration.md) | 在自研固件上单独更新 Web 的历史记录 |