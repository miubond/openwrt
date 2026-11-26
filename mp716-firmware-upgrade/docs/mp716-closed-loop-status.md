# MP716 闭环状态

更新：2026-11-23

## 已闭环（软件可验收）

| 链路 | 说明 |
|------|------|
| 登录会话 | `auth/prelogin` → `auth/login` → Bearer |
| 能力声明 | `multiSsid:true`；`cellular` 对象 `supported:false, reason:no_modem`；菜单 `bundle.cellular:false` |
| 副 SSID | `GET/POST wireless/secondary` + Wi‑Fi 基础页「访客 Wi‑Fi」 |
| 4G 诚实契约 | `GET network/cellular` → 无模组说明（不虚构蜂窝菜单） |
| 配置保存 | config-task 确认/撤销 |
| 固件验签 | 上传 → verify |
| 固件刷写（实验室） | `DEPLOY_ENABLE_FLASH=1` 热更 → `allow-flash-upgrade`；提交后 `?wait=1` 重启等待闭环 |
| 发布时间 | `installed.at`（上传时刻），含 no-keep 经 pending 包保留 |
| 固件策略（量产热更） | **默认** 删除 `allow-flash-upgrade` → `validationOnly` |
| 首页 WAN 速率 | 缓存命中仍刷新 `wan`；`ratesReady` 前端「统计中」 |
| 契约别名 | `POST system/upgrade` ≡ `firmware-package/verify` |
| 量产刷写门脚本 | `/usr/share/mp716/mp716-open-production-gate.sh`（串口演练后执行） |

### 烟测

```powershell
# 实验室（刷写门开时）
$env:LAB_EXPECT_FLASH='1'
powershell -File scripts/verify-lab-closed-loop.ps1

# 量产策略（仅验签 + 能力）
powershell -File scripts/verify-production-closed-loop.ps1
```

### 热更环境变量（`deploy-native-openwrt.ps1`）

| 变量 | 默认 | 作用 |
|------|------|------|
| `DEPLOY_ENABLE_FLASH` | 关 | `1` = 实验室刷写门 |
| `DEPLOY_PERF_DIAG` | 关 | `1` = 写 `/etc/mp716-admin/perf-diag` |
| `DEPLOY_INCLUDE_EXPERIMENT` | 关 | `1` = 打包 rpcd 实验文件 |

## 未闭环（需硬件 / RELEASE 整包 / 人工）

| 项 | 说明 |
|----|------|
| 正式刷机 E2E | 设备 `upgrade.pub` 匹配的 **RELEASE** 签名包 + `CONFIRM_RELEASE_FLASH=YES` → `run-release-flash-e2e.ps1` |
| 串口救砖 | 按 [release-hardware-closed-loop.md](./release-hardware-closed-loop.md) 演练后跑 gate 脚本 |
| 断电恢复 | `production-acceptance.md` 人工记录 |
| 真 4G | 无硬件，无法实现蜂窝拨号 |

刷机：[factory-upgrade-closed-loop.md](./factory-upgrade-closed-loop.md)