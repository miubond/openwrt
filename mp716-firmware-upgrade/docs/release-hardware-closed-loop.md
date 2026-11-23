# 硬件 / 整包闭环验收

对应 `production-acceptance.md` 中仍未在单机完成的项。

## 1. 签名 release 刷机 E2E

**前置：** 与设备 `/etc/mp716-upgrade/upgrade.pub` 匹配的 **RELEASE** `.mp716upd`（CI `stage-versioned-release` 或 Linux `build-openwrt-test.sh` 产出）。

```powershell
# 仅验签
powershell -File scripts/run-release-flash-e2e.ps1 -PackagePath D:\path\to\release.mp716upd

# 刷写（设备将重启）
$env:CONFIRM_RELEASE_FLASH='YES'
$env:DEPLOY_ENABLE_FLASH='1'   # 或已执行 mp716-open-production-gate.sh
powershell -File scripts/run-release-flash-e2e.ps1 -PackagePath .\release.mp716upd -Flash

# 重启后
$env:POST_REBOOT_CHECK='1'
powershell -File scripts/run-release-flash-e2e.ps1 -PackagePath .\release.mp716upd
```

记录：刷写前后 `softwareVersion`、Web 可登录、LAN/WAN 上网。

## 2. 串口救砖

1. 按 [recovery-plan.md](./recovery-plan.md) 备份当前 `firmware` 分区或保留原厂 recovery 包路径。  
2. 串口中断 U-Boot，确认 RAM/TFTP 参数（设备实勘记入 `production-acceptance.md`）。  
3. 演练刷回 **已知可启动** 镜像并开机。  
4. 在设备执行：`sh /usr/share/mp716/mp716-open-production-gate.sh`（或拷贝 `scripts/mp716-open-production-gate.sh`）。  
5. 确认 `flash-gate=serial-recovery-verified`、`platform=confirmed`，且无 `allow-flash-upgrade`。

## 3. 断电恢复

在 **实验室单台** 上，于 upgrade 写入过程中（或 config-task 确认窗口）**拉电一次**（须明确为破坏性测试机）：

| 场景 | 预期 |
|------|------|
| 验签上传中断 | 无 MTD 写入；Web 仍可进 |
| sysupgrade 中途断电 | 可能变砖；靠串口救砖闭环 |

结果写入验收表；未测前不得标 RELEASE。

## 4. 多 SSID（软件已闭环）

- API：`GET/POST wireless/secondary`（副 AP `mp716_guest`，同 LAN，客户端隔离默认开）  
- 能力：`capabilities.bundle.multiSsid=true`  
- 前端：无线基础设置页「副 SSID」区块  

实机：创建副 SSID → 手机连接 → 确认隔离与主 SSID 并存。

## 5. 4G / 蜂窝（诚实闭环）

- 本硬件 **无蜂窝模组**；`GET network/cellular` → `supported:false, reason:no_modem`  
- `capabilities.cellular` 说明字段已填充；**不虚构菜单**  
- 若后续硬件确认模组：独立子项目，不复刻 HYID  

更新：2026-11-23