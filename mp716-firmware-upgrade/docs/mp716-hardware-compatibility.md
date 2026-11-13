# MP716 设备兼容性

结论：第一阶段保留原厂操作系统，参考 `openwrt/chaos_calmer` 的 `v15.05.1` 来适配升级流程。当前 firmware 分区格式已经按只读副本核对，但原厂升级包还没和它对上，Bootloader 与救砖也没有确认。现在仍然不能刷写。

第一阶段参考仓库是 https://github.com/openwrt/chaos_calmer ，标签 `v15.05.1`，提交 `0c335d6ea00af9b32225f72d491e560c1a7cf4ab`。官方内核是 3.18.23，设备内核是 3.10.108。

## 设备资料

这些数值里，firmware 分区来自已核对的只读副本。本次没有再读设备，也没有写入。

| 项 | 资料 | 状态 |
|---|---|---|
| 系统板卡 | `MT7628` | 只表示芯片，不能当作产品型号 |
| 系统型号 | `mtk-apsoc-demo` | 通用开发板名，V015 拒绝把它当作硬件修订 |
| Web 身份 | ZC-AP / MP716 / 014 | 升级包使用的产品身份 |
| SoC | MT7628，MIPS32r2 | 与 `mt76x8` 子目标同一系列 |
| 系统 | 原厂 Chaos Calmer 15.05.1，Linux 3.10.108 | 官方 15.05.1 内核是 3.18.23，不是同一份源码 |
| Flash | 8 MiB SPI NOR | 对应官方 NOR 路径，不是 NAND，也不是 eMMC |
| Web | lighttpd 与原厂 HUAYI CGI | 现有页面不是 LuCI |
| 版本 | 原厂软件 014 | Web 显示 014，是 V015 的升级起点 |
| Bootloader | 分区位于 0x000000，长度 0x030000 | 类型和串口菜单未确认 |
| 原厂升级包 | `HUAYI_..._014_2024-11-13.bin` | 文件不在，参考 SHA-256 未核对 |
| 当前 firmware 分区 | `factory-mtd-from-device.bin` | 8060928 字节已核对，SHA-256 `56cac090ab7fa2be00a5c5d3970aef484be8303ae76889e16cd297b19436607d` |

分区候选仍是 Bootloader、Config、Factory 不写。firmware 分区长度已由这份副本证明为 `0x7B0000`。副本从分区内部的偏移 0 开始，不包含 Bootloader 前面的 `0x050000`，所以整片 Flash 的起点还要串口核对。镜像是 uImage `ZC-AP` 加紧随其后的 SquashFS，细节见 `firmware-format.md`。

## 技术选型

第一阶段保留 MP716 原厂操作系统。升级参考固定为 Chaos Calmer `v15.05.1` 的 `sysupgrade`、`common.sh`、ramips `platform.sh` 和 `target/linux/ramips/image/Makefile`。官方 `platform.sh` 的机型名单没有 MP716；已登记机型只检查 uImage magic `27051956`。设备镜像的 magic 相同，但名单外的机器会被官方脚本拒绝。本项目的校验还要核对内核 CRC、SquashFS、型号、硬件版本和数字签名，不采用只看 magic 的做法，也不传递 `-F`。

官方 MT7628 构建产物按 4M 生成。8M 常量 `8060928` 与当前分区长度相同，只说明尺寸常量可用，不说明那份官方镜像可以刷入。

原厂升级包还没有文件，不能和 `factory-mtd-from-device.bin` 比较。比较完成之前，不判断“修改官方 sysupgrade 就够了”。

`openwrt-overlay/` 属于后续的 OpenWrt 25.12.6 草稿，`BROKEN := y`。它不是第一阶段要装进原厂系统的代码。第一阶段在原厂系统上的分工是：

1. 写入仍走原厂已经验证过的 Flash 路径，本模块不重写 `mtd write`。设备上的 `/sbin/sysupgrade` 还没有读回，所以先不调用它。
2. Shell 适配器只做格式分流和准入判断。
3. C 校验器负责完整性、型号、硬件版本和数字签名。
4. Web 升级页做在原厂管理界面一侧。不把 25.12 的 LuCI 装进当前系统。

官方 15.05.1 的 `platform.sh` 不能直接换上这台机器。把 v25.12.6 的 sysupgrade 装进原厂系统也不能证明刷写范围是对的。

在设备上确认之前必须保持关闭的两项：

| 文件 | 出厂内容 | 打开条件 |
|---|---|---|
| `/etc/mp716-upgrade/platform` | `unconfirmed` | 分区、Bootloader 和原厂镜像格式已经核对 |
| `/etc/mp716-upgrade/flash-gate` | `closed` | 串口或其他救砖手段已经把原厂固件刷回并启动 |

两项都未确认时，适配器不执行 `sysupgrade`。

## 和官方升级机制的关系

MT7628 在 v25.12.6 的 `target/linux/ramips/mt76x8/base-files/lib/upgrade/platform.sh` 中把目标写死为 `PART_NAME=firmware`，实际写入由 `default_do_upgrade()` 调用 `mtd write - firmware`。这是应该复用的官方 NOR 路径，本模块不再自己实现擦写。

不能复用的部分：

- `alfa-network,awusfree1` 的双镜像和 `fw_setenv`。MP716 没有备份分区，也不能改 Bootloader 环境。
- TP-Link 的 `mtd -t romfile`。那会碰到配置区。
- `nand_do_upgrade` 和 `emmc_do_upgrade`。介质不符。
- `sysupgrade -F`。校验失败后不允许强制继续。
- 把 25.12 的 sysupgrade 镜像交给原厂升级页。

原厂固件和自研容器分开处理。uImage 开头的原厂 BIN 在哈希核对之前一律拒绝。`.mp716upd` 先做签名和兼容性校验，通过之后才允许讨论是否交给 `sysupgrade`。未知格式拒绝。

## 集成方式

模块放在独立的 OpenWrt 包里，不改官方 `sysupgrade`、`mtd`、`rpcd` 源码。

- `mp716-sysupgrade` 包同时编译并安装 C 校验器。保留仓库目录结构时可直接引用包目录。单独复制包目录时，通过 `MP716_SOURCE_DIR` 指向包含 `device/` 和 `shared/` 的项目根目录。
- `verify` 使用 `/etc/mp716-upgrade/device.profile` 和 `/etc/mp716-upgrade/upgrade.pub` 校验签名及设备兼容性。构建目标镜像时用 `MP716_IMAGE_PROFILE` 提供镜像自己的设备配置，并将其中的 `installed_custom_firmware` 设为与签名 Manifest 一致的版本。目标镜像须包含 `mp716-sysupgrade` 包。
- `apply` 通过准入检查后重新验签，把通过签名校验的原始载荷交给 OpenWrt。载荷须为本机型的 OpenWrt sysupgrade 镜像，并包含上游所需的尾部元数据。`sysupgrade -T` 通过后才会提交升级。
- 平台文件默认是 `unconfirmed`，准入文件默认是 `closed`。任一未确认都不执行 `sysupgrade`。
- 适配器通过 OpenWrt 的备份归档传递待核验版本。启动脚本从 `/rom/etc/mp716-upgrade/device.profile` 读取镜像内置版本，核对通过后记录 `SUCCESS`。
- rpcd 的 ACL 只预留只读项，没有写入方法。
- LuCI 页面只说明刷写关闭。原厂 lighttpd 页面仍走现有 CGI，不另做云端后台。
- 不使用 Go、Gin 或 MySQL。

配置保留是显式选项。默认的 `-f` 归档只携带待核验记录。指定 `--keep-config` 时，归档同时包含 OpenWrt 生成的配置备份。

## 结论

| 能力 | 现在 |
|---|---|
| 识别原厂 uImage、自研容器和未知文件 | 可以 |
| 在已确认平台的自研固件里调用官方 `sysupgrade` | 代码路径已留出，默认不执行 |
| 把官方 sysupgrade 装进当前原厂系统并完成升级 | 不可以 |
| 上传后真正刷写、保留配置并重启验证 | 不可以 |

生产刷写要等三件事都有记录：分区和原厂镜像格式已在设备上核对、串口或其他救砖手段已经把原厂固件刷回并启动、操作者把准入从 `closed` 改为经过确认的记录。在此之前模块必须拒绝执行。
