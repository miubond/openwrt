# MP716 生产机在网配置标准

对「已在产线/在网服务」的路由器，管理面升级应按下列对齐（与 `upgrade-policy.uc` 一致）。

## 必须项

| 文件 | 生产值 |
|------|--------|
| `/etc/mp716-upgrade/upgrade-policy` | `production` |
| `/etc/mp716-upgrade/flash-gate` | `serial-recovery-verified` |
| `/etc/mp716-upgrade/platform` | `confirmed` |
| `/etc/mp716/allow-flash-upgrade` | **不得存在** |
| `/etc/mp716-upgrade/upgrade.pub` | **RELEASE** 公钥（32 字节，与正式包成套） |

Web：`校验固件` + `开始升级`（两阶段）；无「实验室 / allow-flash」依赖。

## 部署

```powershell
npm run build:openwrt   # openwrt_system
$env:ROUTER_HOST = '<管理IP>'
.\scripts\deploy-admin.ps1 -ReleasePubPath 'path\to\release\upgrade.pub'
.\scripts\verify-production-runtime.ps1
```

RELEASE 整包出厂：`write-release-upgrade-policy-overlay.sh` 在镜像树写入上表三项策略文件；另有 RELEASE `upgrade.pub`。

## 升级后保留

`/lib/upgrade/keep.d/mp716-admin` 须含 `flash-gate`、`platform`、`upgrade-policy`（`sysupgrade -l` 可核对），否则「保留配置」升级后刷写门回到镜像默认 `closed`。

`deploy-admin.ps1` 推到 overlay 的 ucode / Web 不属于配置，任何刷写后都会回到新镜像自带版本；修复必须进全量镜像。

刷写在 CGI 返回「已提交」后由后台完成；失败原因写入 `/tmp/mp716-upgrade/apply-result.json`，经 `system/firmware-v2/status` 显示为 `FAILED`。

## 与 TEST 镜像默认差异

`integration/openwrt-package/files` 中 `flash-gate=closed` 用于 **未验收的 TEST 构建**；**生产在网或 RELEASE 镜像** 须为 gate 已打开 + `production`（见 overlay 脚本）。

## 验收脚本

| 场景 | 脚本 |
|------|------|
| 生产已开通刷写 | `verify-production-runtime.ps1` |
| 出厂前仅验签、无刷写 | `verify-production-closed-loop.ps1` |