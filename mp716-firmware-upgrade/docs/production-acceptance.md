# MP716 生产验收

更新：2026-11-26  
实验室单机已运行 **1.0.11**；本表仍是**发布门**记录，不因单机已迁移而自动标 RELEASE。

## 发布门（任一不成立 = TEST）

- 串口恢复可把原厂/自研镜像刷回并启动
- 镜像格式、容量、`yunxm,mp716`、**RELEASE 签名**、生产预算（≤ 7 012 352 flash_span）
- 未使用 `sysupgrade -F`；平台脚本不写 u-boot/config/factory
- **`upgrade-policy=production` 的 RELEASE 整包**（见 `write-release-upgrade-policy-overlay.sh`）
- Web 升级在专用测试机完成下列 §固件升级 实机矩阵

## 固件升级 — 实机矩阵（须专用机 + 人工）

**禁止**在未经同意的在线生产设备上自动刷写。每项须附证据（日志、截图、时间、版本号）。

| 项 | 结果 | 证据 |
|---|---|---|
| 正式签名包真实刷写 | 未执行 | |
| 保留配置升级 | 未执行 | |
| 不保留配置升级 | 未执行 | |
| 连续版本升级 | 未执行 | |
| 超容量镜像拒绝 | 未执行 | 宿主：`check-production-image-budget.py` on 1.0.11 WARN 超目标 |
| 错误型号拒绝 | 未执行 | 宿主：`tests/packer/test_container.py` |
| 签名错误拒绝 | 未执行 | 宿主：`test_device_cli.py` |
| 上传中断恢复 | 未执行 | |
| RAM 不足拒绝 | 未执行 | 代码：`mp716-sysupgrade` exit 25/26 |
| 配置恢复 | 未执行 | |
| LAN/WAN/Wi-Fi 恢复 | 未执行 | |
| WireGuard/OpenVPN 恢复 | 未执行 | |
| 升级后 Overlay 容量 | 未执行 | 实机只读 772 KiB free（2026-11-26） |
| 救砖/串口演练 | 未执行 | 未跑 gate 脚本于量产机 |

## 容量 / RAM（实机只读 2026-11-26）

| 项 | 值 |
|---|---|
| firmware | 8 060 928 B |
| rootfs_data | 1 088 KiB（余 772 KiB） |
| MemAvailable | 17 620 KiB |
| tmpfs | 28.5 MiB |

详见 `mp716-firmware-size-budget.md`、`mp716-upgrade-memory-report.md`。

## 构建

OpenWrt **25.12.6**，pin `64900e756efa667774214f9c6b17c113222e01f7`。

```sh
bash scripts/build-openwrt-test.sh --lan-candidate web/dist /path/to/openwrt-test config/test-device.profile /path/to/test-output
```

RELEASE overlay：

```sh
bash scripts/write-release-upgrade-policy-overlay.sh "$STAGING_ROOT"
```

## 其他清单（节选）

| 项 | 结果 |
|---|---|
| RAM 启动 | 实机 1.0.11 在线 |
| 网口/Wi-Fi | 部分历史记录，见 hardware 文档 |
| 固件升级 Web 闭环 | **代码就绪**；实机 RELEASE 验收未闭环 |
| 断电恢复 | 未执行 |

## 放行 Web 升级的判定

同时满足才可标 **RELEASE** 并对出厂设备开放 `flashUpgradeEnabled`：

1. 上表 §固件升级 全项 **PASS**（附证据）
2. CI：`build-openwrt-test.sh` + `check-production-image-budget.py` 绿
3. 镜像内含 RELEASE `upgrade.pub`（非 ci-test）
4. `write-release-upgrade-policy-overlay.sh` 已打入 squashfs

未满足前：镜像保持 `development` 或 gate 关闭，UI 仅校验或按钮灰化。