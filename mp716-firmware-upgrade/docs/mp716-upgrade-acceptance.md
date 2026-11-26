# MP716 固件升级验收矩阵

更新：2026-11-26  
**生产门禁未开**：未 `touch allow-flash-upgrade`；**无自动 sysupgrade/mtd 写入**。

状态机参见 [mp716-firmware-production-safety.md](./mp716-firmware-production-safety.md)。

## legend

- **PASS**：有本次或列出的自动化/实机证据
- **FAIL**：实测失败
- **UNVERIFIED**：无证据，须实验室或 CI 补测

| # | 场景 | 预期 | 结果 | 证据 |
|---|------|------|------|------|
| 1 | 正常升级包 | 验签 0，`job_id`，生产不刷写 | **PASS**（验签+尺寸） | `check-mp716upd` 1.0.11；`test_production_size_budget` |
| 2 | 超容量升级包 | 拒绝；CI 失败 | **PASS**（逻辑） | `build-openwrt-test.sh` >8060928；`check_production` >7012352 宿主单测 |
| 3 | RAM 不足 | LOW_MEMORY，不 apply | **UNVERIFIED** | 代码：`--require-memory`、`sysupgrade` exit 25 |
| 4 | 上传中断 | 删半成品，失败 | **UNVERIFIED** | `firmware-job.uc` 不完整 unlink |
| 5 | 镜像损坏 | check 失败 | **PASS** | `tests/packer/test_container.py`、`test_device_cli.py`（宿主历史） |
| 6 | 签名错误 | check 失败 | **PASS** | 同上 |
| 7 | 重复上传 | 409 DEVICE_BUSY | **UNVERIFIED** | `busy_job_conflict` 代码审查 |
| 8 | 配置备份过大 | apply 前拒绝/失败 | **UNVERIFIED** | overlay 316 KiB 实机；大配置未测 |
| 9 | 保留配置升级 | pending 含 overlay | **UNVERIFIED** | 1.0.10→1.0.11 曾成功（前会话）；本矩阵未重跑 |
| 10 | 不保留配置升级 | 清 overlay；`installed.at` 经 pending | **UNVERIFIED** | `/tmp` staging 代码 |
| 11 | 升级后 Overlay 容量 | rootfs_data ≥ budget | **UNVERIFIED** | 当前 772 KiB 空闲（只读） |
| 12 | WG/VPN 下升级内存 | 停 mp716-vpn 后通过 | **UNVERIFIED** | 停服列表含 VPN |
| 13 | 重启恢复 / 串口救援 | boot-verify；gate 脚本 | **UNVERIFIED** | `mp716-open-production-gate.sh` 文档 |
| 14 | 生产 `flashUpgradeEnabled` | false | **PASS** | 默认无 `allow-flash-upgrade`；v2 `dryRunOnly` |
| 15 | `flash_write` 语义 | 未完成刷不写 SUCCESS | **PASS**（代码+1.0.11 网页） | `upgraded: false` on submit；`boot-confirm` 写时间 |
| 16 | 重启后版本/构建 ID | boot-verify 对 manifest | **UNVERIFIED** | init `mp716-sysupgrade` |
| 17 | sysupgrade -T | apply 子进程 | **UNVERIFIED** | `mp716-sysupgrade` 路径；前会话刷写已观测 |

## 宿主自动化汇总（2026-11-26 本次执行）

```text
pytest tests/integration/test_firmware_capacity_gate.py \
       tests/integration/test_production_size_budget.py \
       tests/packer/test_container.py -q
→ 17 passed
```

## 实机只读探测（2026-11-26）

- SSH `10.251.0.140`：mtd、meminfo、overlay、组件 `du`
- 未 POST 刷写、未改 `allow-flash-upgrade`

## 生产发布前强制项

- [ ] RELEASE 包 `flash_span ≤ 7 012 352`（硬顶）
- [ ] 目标 `≤ 6 815 744`（当前 1.0.11 **WARN**，建议减包后 **strict-target**）
- [ ] `verify-production-closed-loop.ps1` 全绿
- [ ] 串口救援演练 + `flash-gate` 脚本（量产）
- [ ] 实验室 E2E：`run-release-flash-e2e.ps1` **仅人工授权**

## 相关文件

| 文档 | 内容 |
|------|------|
| [mp716-firmware-size-budget.md](./mp716-firmware-size-budget.md) | 分区与 CI 门禁 |
| [mp716-package-size-report.md](./mp716-package-size-report.md) | 组件体积 |
| [mp716-upgrade-memory-report.md](./mp716-upgrade-memory-report.md) | 内存/tmp |

## 代码变更摘要（本轮）

- `packer/size_budget.py`、`check-production-image-budget.py`
- `firmware-job.uc`：`--require-memory`
- `mp716-sysupgrade`：刷写前 MemAvailable/tmp 拒绝
- CI：`build-openwrt-test.sh`、`package-ci-test.sh` 挂载生产预算