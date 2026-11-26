# MP716 组件体积分析报告

更新：2026-11-26  
方法：`scripts/generate-package-size-report.py` + SSH `du`（只读）

## 1. 实机 SquashFS 热点（证据 SSH）

| 路径 | 大小 | 说明 |
|------|------|------|
| `/www/mp716` | **697.5 KiB** | Vue 静态资源 |
| `/usr/share/mp716` | **221 KiB** | ucode 管理栈 |
| `/usr/sbin/mp716-upgraded` | **100.5 KiB** | 验签/状态机 |
| `/usr/sbin/wpad` | **648.5 KiB** | Wi‑Fi（声明功能，禁止未评审删除） |
| `/rom` df | 5120×1 KiB blocks | SquashFS 只读根 |

设备：`10.251.0.140`，固件 **1.0.11**。

## 2. 仓库源树（构建输入，非 ROM 占用）

| 组件 | 字节 | 路径 |
|------|------|------|
| Web dist（目标） | 696 940 | `web/dist-openwrt` |
| Web 页面源码 | 398 400 | `web/src/pages` |
| ram-web ucode | 550 977 | `integration/ram-web` |
| device C 源码 | 93 106 | `device/src` |
| packer | 111 132 | `packer/` |
| openwrt-package | 13 466 | `integration/openwrt-package` |

完整 JSON：`reports/package-size-json-2026-11-26.json`

## 3. 发布物实测（1.0.11）

| 层 | 大小 |
|----|------|
| `.mp716upd` 容器 | 6 947 629 B |
| 内嵌 payload | 6 947 079 B |
| 预计写入跨度 flash_span | 6 911 494 B |

与预算对照见 [mp716-firmware-size-budget.md](./mp716-firmware-size-budget.md)。

## 4. 可优化项（已审查，未自动删包）

| 候选 | 风险 | 建议 |
|------|------|------|
| `integration/ram-web/experiment/` | 低 | 生产 stage 默认 `DEPLOY_INCLUDE_EXPERIMENT=0` |
| Web `node_modules` | 无 | **不**进镜像；仅 dev 树 |
| 双份 `httpd.uc` 备份 | 中 | 仅保留 `integration/ram-web` 单源 |
| lucide 全量图标 | 中 | 已打包侧按需；复查 `dist` 未引全库 |
| VPN/WG 内核模块 | 高 | 功能声明；减包须功能评审 |

## 5. Overlay / rootfs_data

| 项 | 实机 |
|----|------|
| mtd6 总 | 1 088 KiB |
| 已用 | 316 KiB |
| 可用 | **772 KiB** |

保留配置升级时 `sysupgrade -b` 归档约 **数百 KiB 级**（当前 overlay 小）；若 overlay 接近满须先拒绝或清理。**实机大配置刷写：UNVERIFIED**。

## 6. 证据清单

| 动作 | 证据 |
|------|------|
| 生成仓库分解 | `generate-package-size-report.py` 2026-11-26 |
| 实机 du | SSH 输出收录于本文 §1 |
| 包体测量 | `check-mp716upd-artifact-size.py` 对 1.0.11 |

**未执行**：重新打包减体积后的 CI 镜像对比、unsquashfs 全量文件列表 diff。