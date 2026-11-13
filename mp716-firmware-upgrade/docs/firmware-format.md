# 固件格式

## 当前设备上的 firmware 分区

已核对文件：`factory-mtd-from-device.bin`。这是当前路由器 firmware 分区的只读副本，不是完整 Flash，也不是下面那个尚未找到的原厂升级包。

| 项 | 实测 |
|---|---|
| SHA-256 | `56cac090ab7fa2be00a5c5d3970aef484be8303ae76889e16cd297b19436607d` |
| 长度 | 8060928，等于 `0x7B0000` |
| uImage | 偏移 0，magic `0x27051956`，头 CRC 和内核 CRC 都正确 |
| 内核 | Linux、MIPS、kernel、LZMA，名称 `ZC-AP`，长度 1235785，字典 8 MiB |
| 加载地址 | `0x80000000` |
| 构建时间 | 2024-11-13T03:17:01Z |
| SquashFS | 紧接内核，偏移 `0x12DB89`，小端 `hsqs`，主版本 4，XZ，块大小 1 MiB，`bytes_used` 5557896 |
| 内核之后 | `0x67B000` 处为 `deadc0de`，`0x680000` 处为 JFFS2 标记 |
| 分区尾部 | 65524 字节 `0xFF`，没有 `.mp716upd` 尾部标记 |

现有结构门能通过这份分区镜像。它仍然只是当前运行内容的格式记录，不能把它写回设备，也不能把它当成 OpenWrt 25.12 的 sysupgrade 镜像。

## 原厂升级包

目标文件：`HUAYI_ZC-AP_MT7628DA_spi_8M64M_None_014_2024-11-13.bin`

参考 SHA-256：`28b9a075a5e298159a0a49b5372659d264a8cf686c8171ef2d7dff8320e02733`

本工作区没有这份升级包。它和上面的分区副本不是同一个文件：分区副本含有首次启动后的 JFFS2 标记和尾部 `0xFF`，哈希因此不同。`packer/audit_vendor_image.py` 对升级包仍然报告 `BLOCKED`。

`0x12DB89` 现在已经在这份分区副本上测到，并且正好等于内核结束位置。校验器仍把该偏移记为 `historical_offset_match`，不把它当成所有镜像的强制偏移。测试载荷继续使用别的偏移。

## 自研容器 `.mp716upd`

小端，长度固定，总长度必须等于各段之和。多一个字节是 `trailing`，少一个字节是 `truncated`。

| 偏移 | 长度 | 内容 |
|---|---|---|
| 0 | 8 | Magic `MP716UPD` |
| 8 | 4 | format_version = 1 |
| 12 | 4 | header_size = 64 |
| 16 | 4 | manifest_size，1..8192 |
| 20 | 4 | payload_size，1..8060928 |
| 24 | 4 | flags，必须为 0 |
| 28 | 36 | 保留，必须为 0 |
| 64 | manifest_size | 规范化 JSON |
| 其后 | payload_size | 原厂兼容镜像 |
| 最后 | 64 | Ed25519 签名 |

签名输入是 64 字节头、Manifest 原文、Payload 的 SHA-256 原始 32 字节。Payload 本身不放进签名缓冲区。

Manifest 必须是无空白、键严格排序的 ASCII JSON。字段以 `shared/firmware_schema.json` 为准。`product` 固定 `MP716`。`base_firmware` 是原厂代际，当前为 `014`。`firmware_version` 与 `custom_firmware` 必须相同，并且不得拿来覆盖原厂版本。`signing_key_id` 是公钥 SHA-256 的前 8 字节，小写十六进制。

`hardware_revision=validated-revision`、空哈希和占位修订会被打包器拒绝。

## Payload 结构门

通过签名之后才检查内部结构：

- uImage magic `0x27051956`，头 CRC 和内核 CRC 使用 zlib CRC32
- OS Linux、架构 MIPS、类型 kernel、压缩 LZMA
- LZMA 属性合法，字典为 4 KiB 到 8 MiB 的 2 的幂
- 内核结束之后扫描 `hsqs`，要求 SquashFS 主版本 4、压缩 XZ、`bytes_used` 落在 Payload 内

这些门用于我们自己签发的 vendor-compatible 载荷。当前 firmware 分区副本已经通过这些门。原厂升级包文件还没有找到，不能把分区副本的哈希写成升级包哈希。

原厂网页升级接受的是这份 BIN 本身。`.mp716upd` 是包在它外面的签名容器，不能把 OpenWrt 25.12 的 sysupgrade 镜像塞进原厂升级页。两种格式的差异和上游参考提交见 `upstream-reference.md`。
