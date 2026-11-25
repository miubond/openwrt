# MP716 实机运行状态与原厂替换边界

**记录日期：** 2026-11-25  
**适用设备：** 实验室 MP716（管理地址 `192.168.199.1`）  
**当前运行：** 自研 OpenWrt **固件 1.0.10**（发布时间 2026-11-25 12:00:40，构建 `1dcaa6de0b`）+ Vue Web **0.2.3**（源码 `fc568398c6`，页面脚本 `index-BJVmYPkS.js`），接口契约 `mp716-native/v1`

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

## 1.0.10 整包与当前页面

固件 **1.0.10** 将以下组件**一起打包**进镜像（完整刷写或保配置 sysupgrade）：

- OpenWrt 系统、内核、驱动与网络服务，含 WireGuard 内核模块与工具
- 构建时嵌入的 Vue 静态资源（主源码 [`openwrt_system`](../../../openwrt_system) 经 `sync-web-reference.py` 进入镜像）
- 原生 ucode 接口（`httpd.uc`、`admin.uc`、`wireguard.uc` 等）、固件验签服务及配套公钥

2026-11-25 这台实验室路由器已用签名包保配置升到 1.0.10。包在 `C:\Users\dev\Desktop\MP716-1.0.10.mp716upd`，6,947,629 字节，SHA-256 `2929e419ca9f201ead86e5884b78cbeebbc2bc54a3bd2bc6e1139e4a4f0f7fc9`。构建记录：<https://github.com/miubond/openwrt/actions/runs/45543123478>。局域网仍是 `192.168.199.1`。产物仍是 **UNVERIFIED**，不是生产发布。

**仅更新 Web 静态资源**时，只替换 `/www/index.html` 与 `/www/mp716/`，不覆盖 `/usr/share/mp716/`。2026-11-25 已把主源码 `fc568398c6` 的 `dist-openwrt` 热更新上去，Web 版本仍是 0.2.3，系统仍是 1.0.10。见主源码 [`NATIVE-WEB.md`](../../../openwrt_system/NATIVE-WEB.md)。

这次保配置升级用的是 **1.0.9** 上临时换过的刷写脚本：网页请求先返回，再在后台解包，并暂时把 `min_free_kbytes` 降到 1024，否则 64MB 内存上 uhttpd 的 60 秒限制会得到 502，或校验器以 `low_memory` 拒绝。**1.0.10 镜像里的 `/usr/sbin/mp716-sysupgrade` 没有这两处改动**（设备上已核对：没有提前返回，也没有改水位）。下一次网页刷写仍可能 502 或内存不足。对应修改还在 `openwrt-wgram` 工作区，未进入已安装镜像。

`/lib/upgrade/keep.d/mp716-admin` 从 1.0.10 起包含 `/etc/mp716/allow-flash-upgrade`。本次升级前运行的 1.0.9 没有这条，门文件被清掉；更新网页时已补回。实验室网页因此仍可提交刷写，生产在线升级门没有打开。

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

设备已运行自研 1.0.10 **不自动**等同于：

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