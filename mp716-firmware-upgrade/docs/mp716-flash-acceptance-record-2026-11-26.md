# MP716 实验室真实刷写验收记录（2026-11-26）

设备：`10.251.0.140`（`upgrade-policy=laboratory`，实验室刷写门可用）  
Web：`0.2.3`（`dist-openwrt` 热更至 `/www/mp716`）  
固件运行版本（刷写前/后 squashfs）：**1.0.11**（本次验收包为 **manifest 1.0.12 + 同 payload**，用于验证链路而非变更系统分区版本号）

## 证据链

| 步骤 | 命令/接口 | 结果 |
|------|-----------|------|
| 部署升级栈 | `scripts/deploy-upgrade-stack.ps1` | `DEPLOY_UPGRADE_STACK_OK` |
| 部署 Web | `scripts/deploy-lab-www-ssh.ps1` / dist 上传 | `LAB_WWW_OK`，`UpgradeNativePage-*.js` 在设备 |
| 策略 | `GET system/firmware` | `policy=laboratory`，`flash=true`，`validationOnly=false` |
| 验签上传 | `POST system/firmware-package/verify`（curl `--data-binary`） | `job_id=430ef10231ad8dc8`，`flash_write=false`，签名校验通过 |
| 确认刷写 | `POST system/firmware-v2/apply` | `flash_write=true`，`upgraded=false`（两阶段语义正确） |
| 脚本 | `run-lab-flash-acceptance-v2.ps1 -Flash` | `LAB_ACCEPTANCE_FLASH_SUBMITTED` |
| 刷写适配器 | `/usr/sbin/mp716-sysupgrade apply …` | 修复 CRLF 后可执行；提交成功 |
| 重启后 | `state=SUCCESS`，`GET system/firmware` | 运行版 **1.0.11**（与 payload 一致）；`/etc/mp716-upgrade/state` 与 pending 摘要一致 |

## 发现与修复（本轮）

1. **UTF-8 BOM**：`deploy-upgrade-stack` 经 PowerShell 管道写入 ucode 导致 CGI 502 → 改为无 BOM 二进制推送。  
2. **ucode 导出分号**：`firmware-job.uc` / `upgrade-policy.uc` 的 `export function` 须以 `};` 结尾。  
3. **多行 import**：设备 ucode 不接受多行 `import { … }` → `httpd.uc` 改为单行。  
4. **`capabilities` 循环依赖**：移除对 `upgrade-policy.uc` 的 import，内联策略判断。  
5. **`mp716-sysupgrade` 缺失/CRLF**：热更路径未带可执行脚本 → `stage.py` 集成 + 部署时 LF 规范化。  
6. **内存门槛**：上传前需 `MemAvailable` ≥ 约 14.8 MiB；验收前 `drop_caches` 或停用非必要服务。  
7. **同版本拒刷**：1.0.11 包在 1.0.11 上验签返回 `downgrade` → 使用 repack **1.0.12** 容器继续验收。

## 生产集成状态（源码）

- `integration/ram-web/stage.py`：`firmware-job.uc`、`upgrade-policy.uc`、`firmware-boot-confirm.uc`、`mp716-sysupgrade`、`96-mp716-upgrade-policy`（默认 **laboratory**）。  
- `config/firmware.version`：**1.0.12**（正式镜像须全量 `build-openwrt-test.sh` 产出新 squashfs）。  
- RELEASE：`scripts/write-release-upgrade-policy-overlay.sh` → `production` + gate（**未**在 140 默认启用）。  
- 前端：`openwrt_system` `RouterAPI.applyFirmwareV2({ jobId, keepSettings })` 与验收脚本 curl 上传对齐。

## 2026-11-26 下午复验（1.0.12 容器 + 内存门槛修正）

- `firmware-job.uc`：上传/验签 **+2MiB**；确认刷写仅 **8MiB staging**（镜像已在 `/tmp`，不再重复计入 file 体积）。
- 包：`Desktop\MP716-1.0.12\test.mp716upd` + 同步 `upgrade.pub`。
- 结果：`OK VERIFIED job_id=c8468a8e0dee4329` → `OK SUBMITTED flash_write=True`。
- 重启后：`state=SUCCESS`；运行 **1.0.11**（与 repack 同 payload 一致，`bytes_programmed=0` 表示未改写分区内容属预期）。

## 未关闭项（须全量构建后复验）

- [ ] 刷写后运行版本与 `config/firmware.version` 同为 **1.0.12**（需 CI/本地完整镜像，不可仅 repack manifest）。  
- [ ] RELEASE 公钥与 `production` 策略下的 Web E2E（无 `allow-flash-upgrade`）。  
- [ ] 串口救砖演练记录（见 `mp716-production-readiness-audit.md`）。