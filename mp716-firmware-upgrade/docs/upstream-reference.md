# 上游参考

第一阶段固定参考 OpenWrt Chaos Calmer `v15.05.1`，仓库是 https://github.com/openwrt/chaos_calmer ，不是 `openwrt/openwrt` 上的同名路径。标签提交 `0c335d6ea00af9b32225f72d491e560c1a7cf4ab`。这是官方历史版本，已经停止安全维护，不能原样放进生产环境。

当前 MP716 运行原厂定制系统：软件 014，自述 OpenWrt 15.05.1，Linux 3.10.108。官方 15.05.1 的内核是 3.18.23。因此这份源码只作为升级程序的参考，不是原厂固件的逐字节来源。

## 第一阶段要对照的文件

| 模块 | 地址 | 在 v15.05.1 中的行为 |
|---|---|---|
| sysupgrade | https://github.com/openwrt/chaos_calmer/blob/v15.05.1/package/base-files/files/sbin/sysupgrade | 默认保留配置。`-n` 关闭保留。`-F` 会在校验失败后继续，本项目不使用 |
| common.sh | https://github.com/openwrt/chaos_calmer/blob/v15.05.1/package/base-files/files/lib/upgrade/common.sh | `default_do_upgrade()` 先 `sync`，再对 `PART_NAME` 执行 `mtd write`。保留配置时附加 `-j` |
| platform.sh | https://github.com/openwrt/chaos_calmer/blob/v15.05.1/target/linux/ramips/base-files/lib/upgrade/platform.sh | `PART_NAME=firmware`。已登记机型只比较前四字节是否为 `27051956`。名单里没有 MP716，未登记机型直接拒绝 |
| 镜像规则 | https://github.com/openwrt/chaos_calmer/blob/v15.05.1/target/linux/ramips/image/Makefile | `ralink_default_fw_size_8M=8060928`，与当前 firmware 分区长度相同。官方 MT7628 profile 却按 4M 生成，产物不能刷入 MP716 |

设备上的 `/sbin/sysupgrade` 和 `/lib/upgrade/` 还没有读回来。官方名单不包含这台机器，所以不能假定原厂程序等于上面这份 `platform.sh`。

原厂升级包 `HUAYI_ZC-AP_MT7628DA_spi_8M64M_None_014_2024-11-13.bin` 仍不在工作区。当前分区副本 `factory-mtd-from-device.bin` 的 SHA-256 是 `56cac090ab7fa2be00a5c5d3970aef484be8303ae76889e16cd297b19436607d`。两份文件还不能比较，因此还不能判断只改官方 sysupgrade 是否够用，还是必须保留原厂私有升级路径。

只检查 `27051956` 不够。分区副本还需要内核 CRC、名称 `ZC-AP`、SquashFS 和签名校验，这些都不是官方 `platform_check_image()` 的内容。

## 后续树，不是当前设备的源码

OpenWrt 25.12.6 仍固定在 https://github.com/openwrt/openwrt 标签 `v25.12.6`，附注标签对象 `22dd0e28678a6cd6fbadea2d5aaded3a805ab8a4`，提交 `64900e756efa667774214f9c6b17c113222e01f7`。它的内核和用户态都不是这台原厂机器的版本。`openwrt-overlay/` 里的草稿只属于这棵后续树，并且 `BROKEN := y`。第一阶段不编译、不安装这份草稿。

下面的路径都相对于这个提交。官方 ramips 树里没有 `mp716` 或 `yunxm` 设备。

## 作为基础的上游文件

这些地址都指向标签 `v25.12.6`。LuCI 使用同一标签 `feeds.conf.default` 里固定的提交，不跟随 LuCI 的 `main`。

| 模块 | 固定地址 | 用途 |
|---|---|---|
| MT7628 SoC | https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ramips/dts/mt7628an.dtsi | CPU、SPI、GPIO、串口。`yunxm_mp716` 只包含这份 SoC 描述 |
| MT7628 EVB | https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ramips/dts/mt7628an_mediatek_mt7628an-eval-board.dts | SPI NOR 分区写法参考。它的 `compatible` 是 `mediatek,mt7628an-eval-board`，镜像不能刷进 MP716 |
| JS76x8 8M | https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ramips/dts/mt7628an_jotale_js76x8-8m.dts | 8 MiB 机型把 `firmware` 标成 `0x50000 0x7b0000` 的参考。它的 `compatible` 是 `jotale,js76x8-8m`，镜像不能刷进 MP716 |
| 镜像构建 | https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ramips/image/mt76x8.mk | 在文件末尾追加 `openwrt-overlay` 里的 `yunxm_mp716`，不改 EVB 和 JS76x8 的 `Device` 定义 |
| sysupgrade | https://github.com/openwrt/openwrt/blob/v25.12.6/package/base-files/files/sbin/sysupgrade | 校验、备份和进入升级。不把这份程序装进原厂 Chaos Calmer 系统来完成升级 |
| mt76x8 升级适配 | https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ramips/mt76x8/base-files/lib/upgrade/platform.sh | 在默认分支前加入 `yunxm,mp716`，仍调用 `default_do_upgrade` |
| 升级公共逻辑 | https://github.com/openwrt/openwrt/blob/v25.12.6/package/base-files/files/lib/upgrade/common.sh | `default_do_upgrade()` 负责 `sync` 和 `mtd write - firmware` |
| LuCI | https://github.com/openwrt/luci/blob/75a306df84a020c57a631ef5b4c02ace56d93387/modules/luci-mod-system/htdocs/luci-static/resources/view/system/flash.js | v25.12.6 的 LuCI feed 提交。升级页面使用这份系统模块，不另写一套刷写流程 |

EVB 和 JS76x8 8M 的固件分区长度都是 `7872k`。这个数字只说明候选的 firmware 分区大小相同，不说明网口、GPIO、无线校准或 Bootloader 相同。

## 参考文件

| 路径 | 许可证 | 参考目的 | 与 MP716 的差异 |
|---|---|---|---|
| `package/base-files/files/sbin/sysupgrade` | GPL-2.0 | 升级前检查、可选保留配置、把执行程序放进 RAM 后再调用升级 | 25.12 通过 `ubus call system sysupgrade` 进入 `/sbin/upgraded`。原厂是 Chaos Calmer 15.05.1 和 HUAYI CGI，没有这条调用。本仓库不执行该命令，也不提供 `--force` 绕过校验 |
| `package/base-files/files/lib/upgrade/fwtool.sh` | GPL-2.0 | 镜像尾部元数据的校验思路 | 我们的元数据在 `.mp716upd` 头部和 Manifest 里，并由 Ed25519 覆盖。不使用 fwtool 尾部格式 |
| `package/system/fwtool` | GPL-2.0 | 独立元数据工具的边界 | 上游源码提交是 `04cd252e4e9394ffacd51f56f1f124abc534f715`（2025-10-03）。本仓库没有引入 fwtool 源码或二进制 |
| `package/system/mtd/src/mtd.c` | GPL-2.0 | 按擦除块擦除、写入、`0xFF` 填充，以及按分区名打开 MTD | `mtd_write()` 接受调用者传入的分区名。本项目拒绝 HTTP 或命令行指定 MTD 名。真实后端默认不参与构建，Fake MTD 只接受长度固定的 `.fakemtd` 文件 |
| `target/linux/ramips/image/mt76x8.mk` | GPL-2.0 | 同系列 SoC 的镜像大小写法 | EVB 与 JS76x8 8M 使用 `IMAGE_SIZE := 7872k`。MP716 单独追加 `Device/yunxm_mp716`，并设置 `BROKEN := y`。不把这两份现成镜像当作 MP716 固件 |
| `target/linux/ramips/mt76x8/base-files/lib/upgrade/platform.sh` | GPL-2.0 | MT7628 子目标把写入目标固定为 `PART_NAME=firmware`，并要求镜像带 metadata | `platform_check_image()` 直接 `return 0`，型号检查交给 fwtool 的 `supported_devices`。本项目在签名之后自己核对产品型号，不调用 `mtd write` |
| `package/base-files/files/lib/upgrade/common.sh` | GPL-2.0 | `default_do_upgrade()` 在写入前 `sync` 并丢掉缓存，再把镜像交给 `mtd` | 它执行 `mtd write - firmware`。本项目的真实 MTD 后端没有链接，Fake MTD 只写 `.fakemtd` 文件 |
| `target/linux/ramips/` | GPL-2.0 | MIPS ramips 的镜像和设备树组织 | 官方树没有 MP716。设备树草稿不能代替串口核对 |
| `package/system/rpcd` | ISC | 服务端会话和权限，而不是信任前端用户名 | 上游源码提交是 `d99f703e4035d03fbcfbada3cb697db346c2b984`（2026-10-04）。原厂管理入口是 lighttpd CGI。会话位置尚未确认，所以 CGI 默认 `auth.mode=deny`。本仓库不引入 rpcd |

这些文件没有被复制进本仓库。Monocypher 和 SHA-256 的许可证见 `device/third_party/NOTICE.md`。

## 从 mt76x8 升级脚本采纳的规则

`target/linux/ramips/mt76x8/base-files/lib/upgrade/platform.sh` 在 v25.12.6 里做了三件和本项目一致的事：

1. 写入目标写死为 `PART_NAME=firmware`，不从用户参数里取分区名。
2. `REQUIRE_IMAGE_METADATA=1`。镜像必须带可识别的元数据，缺了元数据就不能当普通文件刷进去。
3. 真正落盘前由 `default_do_upgrade()` 先 `sync`，再把整份镜像交给一个固定分区。

同一文件里的另外两条路径不能用于 MP716：

- `alfa-network,awusfree1` 会在 `dual_image=1` 时改写 `PART_NAME=backup`，并切换 `bootactive`。MP716 没有这块备份分区，不能照搬。
- `tplink,archer-c20-v5` 等机型使用 `MTD_ARGS="-t romfile"` 保留厂商配置区。MP716 的 Config 和 Factory 禁止写入，所以不使用 `-t`。

`fwtool_check_image()` 还会对照 `supported_devices` 和 `compat_version`。主版本不兼容就拒绝升级；次版本不兼容时要求放弃保留配置。签名缺失时，上游允许 `sysupgrade -F` 继续。本项目没有这个覆盖开关：签名、型号或硬件修订失败就停在写入之前。

## 不采用的上游行为

- 不把 OpenWrt 25.12 的 sysupgrade 镜像上传到原厂升级页。
- 不把 MT7628 EVB 或 Jotale JS76x8 的固件写入 MP716。
- 默认不保留配置。计划命令带 `sysupgrade -n`；只有显式指定时才去掉 `-n`。上游 `SAVE_CONFIG` 默认为 1，本设备不沿用这个默认值。
- 不在校验失败后因 `--force` 继续写入。
- 状态名保持现有实现：`REBOOT_REQUIRED` 和 `BOOT_VERIFYING`。它们对应“等待重启”和“重启后核对”，不是自动回滚。

## 原厂镜像和自研容器

原厂文件是可直接进入 firmware 分区的 BIN。`.mp716upd` 在它外面增加固定头部、规范化 Manifest 和 64 字节签名。没有核对过的原厂 BIN，就不能生成可安装的生产固件。
