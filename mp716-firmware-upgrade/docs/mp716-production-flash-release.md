# MP716 正式生产 Web 固件升级放行规范

更新：2026-11-26

## 三档策略

| 策略 | 镜像默认 | `flashUpgradeEnabled` | 说明 |
|------|----------|------------------------|------|
| **development** | TEST / 开发 | 仅 `allow-flash-upgrade` | 默认禁止 Web 刷写 |
| **laboratory** | 实验室 | `allow-flash-upgrade` **或** gate+platform | 不改变生产逻辑 |
| **production** | **RELEASE** | **仅** `flash-gate` + `platform` | **不**依赖 `allow-flash-upgrade` |

配置：`/etc/mp716-upgrade/upgrade-policy`  
实现：`integration/ram-web/upgrade-policy.uc`

## RELEASE 镜像写入

构建 overlay 时执行：

```sh
bash scripts/write-release-upgrade-policy-overlay.sh "$STAGING_ROOT"
```

写入：

- `upgrade-policy` = `production`
- `flash-gate` = `serial-recovery-verified`
- `platform` = `confirmed`

**前提**：串口救砖演练已记录；RELEASE 签名公钥已内置；`production-acceptance.md` 刷写项全部为 PASS。

## 在线设备转生产（非 SSH touch）

串口演练后仅执行：

```sh
sh /usr/share/mp716/mp716-open-production-gate.sh
```

效果：打开 gate、写入 `production`、**删除** `allow-flash-upgrade`。

## 用户可见流程（UpgradeNativePage）

1. 选择 `.mp716upd` → **校验固件**（`job_id` + VERIFIED）
2. 启用刷写时 → **开始升级** → 二次确认
3. `POST firmware-v2/apply` 再验签 → `mp716-sysupgrade` 异步刷写
4. 重启等待页 → `boot-verify` → `BOOT_CONFIRMED` → 写 `installed.at`

**禁止**：单 POST `mode=flash` 跳过确认（仍兼容 API，UI 不用）。

## 状态机（对外）

`UPLOADING` → `VERIFIED` → `SUBMITTED` → `APPLYING` → `REBOOTING` → `BOOT_CONFIRMED` | `FAILED` | `UNKNOWN`

- HTTP `flash_write=true` **不等于**成功；`upgraded=false` 直至重启核验。

## 实机验收（§九）——禁止自动执行

必须在**专用测试机**、人工授权后逐项记录于 `docs/production-acceptance.md`。  
**禁止**对本对话中的在线生产设备自动刷写。

## 相关代码

| 模块 | 路径 |
|------|------|
| 策略 | `upgrade-policy.uc` |
| 任务 | `firmware-job.uc` |
| HTTP | `httpd.uc` |
| 前端 | `UpgradeNativePage.vue` + `applyFirmwareV2` |
| 刷写 | `mp716-sysupgrade` |
| 确认 | `firmware-boot-confirm.uc` |