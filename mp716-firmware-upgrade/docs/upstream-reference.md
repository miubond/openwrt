# 上游参考

本项目只把 OpenWrt 25.12.6 当作升级设计参考。不把该版本的二进制换上原厂 MP716，也不把其他型号的分区表抄进来。

## 固定版本

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/openwrt/openwrt |
| 标签 | `v25.12.6` |
| 附注标签对象 | `22dd0e28678a6cd6fbadea2d5aaded3a805ab8a4` |
| 标签指向的提交 | `64900e756efa667774214f9c6b17c113222e01f7` |
| 提交说明 | OpenWrt v25.12.6: adjust config defaults |

下面的路径都相对于这个提交。官方 ramips 树里没有 `mp716` 或 `yunxm` 设备。

## 参考文件

| 路径 | 许可证 | 参考目的 | 与 MP716 的差异 |
|---|---|---|---|
| `package/base-files/files/sbin/sysupgrade` | GPL-2.0 | 升级前检查、可选保留配置、把执行程序放进 RAM 后再调用升级 | 25.12 通过 `ubus call system sysupgrade` 进入 `/sbin/upgraded`。原厂是 Chaos Calmer 15.05.1 和 HUAYI CGI，没有这条调用。本仓库不执行该命令，也不提供 `--force` 绕过校验 |
| `package/base-files/files/lib/upgrade/fwtool.sh` | GPL-2.0 | 镜像尾部元数据的校验思路 | 我们的元数据在 `.mp716upd` 头部和 Manifest 里，并由 Ed25519 覆盖。不使用 fwtool 尾部格式 |
| `package/system/fwtool` | GPL-2.0 | 独立元数据工具的边界 | 上游源码提交是 `04cd252e4e9394ffacd51f56f1f124abc534f715`（2025-10-03）。本仓库没有引入 fwtool 源码或二进制 |
| `package/system/mtd/src/mtd.c` | GPL-2.0 | 按擦除块擦除、写入、`0xFF` 填充，以及按分区名打开 MTD | `mtd_write()` 接受调用者传入的分区名。本项目拒绝 HTTP 或命令行指定 MTD 名。真实后端默认不参与构建，Fake MTD 只接受长度固定的 `.fakemtd` 文件 |
| `target/linux/ramips/image/mt76x8.mk` | GPL-2.0 | 同系列 SoC 的镜像大小写法 | 若干其他板卡使用 `IMAGE_SIZE := 7872k`，字节数等于 `0x7B0000`。这不是 MP716 的分区证明，不复制这些 `DEVICE_*` 定义 |
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
- 不默认保留配置。上游 `SAVE_CONFIG` 默认为 1，并会打包 `/etc` 备份。MP716 的可写 overlay 位于即将被覆盖的 firmware 分区内，Config 分区又禁止写入。配置保留选项在指令后半被截断，当前程序不提供该开关。
- 不在校验失败后因 `--force` 继续写入。
- 状态名保持现有实现：`REBOOT_REQUIRED` 和 `BOOT_VERIFYING`。它们对应“等待重启”和“重启后核对”，不是自动回滚。

## 原厂镜像和自研容器

原厂文件是可直接进入 firmware 分区的 BIN。`.mp716upd` 在它外面增加固定头部、规范化 Manifest 和 64 字节签名。没有核对过的原厂 BIN，就不能生成可安装的生产固件。
