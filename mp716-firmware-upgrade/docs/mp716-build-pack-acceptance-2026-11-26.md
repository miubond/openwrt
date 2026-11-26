# 打包 / 构建验收（2026-11-26）

## 本机已完成（Windows）

| 步骤 | 结果 |
|------|------|
| `openwrt_system` `npm run build:openwrt` | OK |
| `python scripts/build_host.py` | OK → `build/host/` |
| `build-pack-acceptance-windows.ps1`（等价手工） | OK |
| `test.mp716upd` manifest **1.0.12**，`web_ui=0.2.3` | `packer/mp716_fwverify.py` **ok** |
| `check-mp716upd` / `check-production-image-budget` | **硬顶通过**；flash_span 6911494 **WARN** 超 6.5MiB 目标 |
| `pytest` 门禁（17） | **17 passed** |
| 产物目录 | `%USERPROFILE%\Desktop\MP716-1.0.12\`（`test.mp716upd` + `upgrade.pub` + sha256） |

**限制**：当前 payload 自 1.0.11 镜像抽取，**未**经 `build-openwrt-test.sh` 重编 squashfs；设备运行版本号仍为 overlay 中旧值，直到 Linux 全量镜像刷入。

## 须 Linux 构建机（全量集成）

```sh
cd mp716-firmware-upgrade
bash scripts/build-openwrt-test.sh --lan-candidate \
  /path/to/openwrt_system/dist-openwrt \
  /path/to/openwrt-64900e7 \
  config/test-device.profile \
  /path/to/build-output

bash scripts/package-ci-test.sh /path/to/ci-artifacts
```

成功后用产物 `sysupgrade.bin` 内 payload 打包或直接使用 CI 输出的 `test.mp716upd`，再在 **140** 上 `-Flash` + `-PostReboot`。

## 140 实机（当日）

- 新 CI 公钥已写入 `/etc/mp716-upgrade/upgrade.pub`
- 验签因 **MemAvailable < 14977 KiB** 未重测通过；刷写前执行 `sync; echo 3 > /proc/sys/vm/drop_caches`，勿 `wifi down`

## 一键复述（Windows）

```powershell
cd D:\goweb\src\openwrt_system
npm run build:openwrt
cd ..\openwrt\mp716-firmware-upgrade
.\scripts\build-pack-acceptance-windows.ps1
```