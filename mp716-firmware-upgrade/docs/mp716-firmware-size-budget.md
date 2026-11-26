# MP716 固件容量预算（8 MiB Flash）

更新：2026-11-26  
实机：OpenWrt 25.12.6，`10.251.0.140`（只读探测，**未刷写**）

## 实机分区（证据）

| 项 | 值 | 证据 |
|----|-----|------|
| Flash 芯片 | 8 388 608 B | `/proc/mtd` 各分区之和 |
| **firmware (mtd3)** | **8 060 928 B**（0x7B0000） | mtd3 |
| 擦除块 | 65 536 B | `erasesize` |
| rootfs_data (mtd6) | 1 114 112 B | mtd6；与 rootfs_data 预算对齐 |
| Overlay 可用 | **772 KiB** | `df /overlay` 2026-11-26 |
| u-boot / config / factory | 未扩大 | mtd0–2 固定 |

原始 JSON：`reports/device-size-probe-2026-11-26.json`

## 生产预算常量（代码）

见 `packer/size_budget.py`：

| 常量 | 字节 | 含义 |
|------|------|------|
| `PRODUCTION_TARGET_BYTES` | 6 815 744 (6.5 MiB) | 历史 JFFS2 起点，**目标**占用上界 |
| `PRODUCTION_MAX_BYTES` | 7 012 352 (6.6875 MiB) | **正式发布硬顶**（kernel+squashfs 跨度） |
| `CONTAINER_MAX_BYTES` | 8 060 928 | mtd firmware / 上传上限 |
| `ROOTFS_DATA_BUDGET_BYTES` | 1 048 576 | overlay 至少保留 1 MiB 规划 |

## 双层校验

| 层级 | 对象 | 门禁脚本 |
|------|------|----------|
| 分区硬顶 | `sysupgrade.bin` 文件 ≤ 8 060 928 | `build-openwrt-test.sh` |
| 生产跨度 | uImage+SquashFS 占用 ≤ 7 012 352 | `check-production-image-budget.py` |
| 上传包 | `.mp716upd` 容器 + payload 分别校验 | `check-mp716upd-artifact-size.py` → `check_mp716upd()` |

**禁止**修改 u-boot/config/factory 分区尺寸（`yunxm_mp716.mk` 仅 `IMAGE_SIZE := 7872k` 映射到 mtd3）。

## 当前 RELEASE 样本（1.0.11）

本机 `Desktop\MP716-1.0.11\test.mp716upd`（**宿主测量，2026-11-26**）：

| 指标 | 值 | 判定 |
|------|-----|------|
| 容器 | 6 947 629 B | PASS（< 8 060 928） |
| payload | 6 947 079 B | PASS |
| **flash_span** | **6 911 494 B** | PASS 硬顶；**WARN** 超过目标 6 815 744 |

```
test.mp716upd: warn: flash span 6911494 exceeds target 6815744
ok: container=6947629 payload=6947079 flash_span=6911494
```

**结论**：1.0.11 **可刷分区**，但距 6.5 MiB **目标仍有 ~96 KiB 优化空间**；未超过 6.6875 MiB 硬顶。

## CI 接入

- `scripts/build-openwrt-test.sh`：分区检查后加入 `check-production-image-budget.py`
- `scripts/package-ci-test.sh`：对 `test.mp716upd` 双脚本
- 可选 `--strict-target`：将超 **目标** 视为失败（发布前收紧）

## 构建体积优化方向（不删已声明功能）

1. **SquashFS**：审查最大占用包（`wpad-basic` ~648 KiB 已装 ROM，见实机 `du`）。
2. **Vue 产物**：仓库 `dist-openwrt` ~697 KiB；确保 tree-shake、勿把 dev map 打进设备。
3. **ucode 栈**：`/usr/share/mp716` 目标 ~221 KiB（实机）；合并重复诊断/实验文件前需评审。
4. **固件封装**：外层 manifest 保持 ≤8 KiB；避免重复嵌入密钥材料。

## 测试证据（宿主）

```text
pytest tests/integration/test_production_size_budget.py tests/integration/test_firmware_capacity_gate.py
→ 5 passed + 3 passed（2026-11-26）
```

## 未验证

- 下一版 squashfs 减包后实机 `sysupgrade -T` 跨度（需新镜像构建）
- `strict-target` 在 CI 全绿（当前 1.0.11 会 WARN 不下线）