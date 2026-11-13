# 固件格式

## 原厂镜像审计

目标文件：`HUAYI_ZC-AP_MT7628DA_spi_8M64M_None_014_2024-11-13.bin`

参考 SHA-256：`28b9a075a5e298159a0a49b5372659d264a8cf686c8171ef2d7dff8320e02733`

本工作区没有这份文件。`packer/audit_vendor_image.py` 因此报告 `BLOCKED`，`hash_match` 为 false，不会把参考哈希写成已核对。

历史记录里的 SquashFS 偏移 `0x12DB89` 只作为对照数字。校验器发现根文件系统后报告 `historical_offset_match`，偏移不同仍然可以通过。测试载荷故意不使用这个偏移。

下列项目要等 BIN 落到 `firmware/input/` 之后重新测量，现在没有测量值：

1. uImage 头是否从偏移 0 开始
2. 内核长度和 `ih_dcrc`
3. LZMA 属性字节与字典大小
4. SquashFS 实际偏移
5. 根文件系统压缩是否确认为 XZ
6. 文件总长
7. 尾部填充或厂商附加块
8. 与分区边界的差额
9. 原厂升级程序实际接受的字段

静态分区数字见 `flash-layout.md`。它和 OpenWrt 树里的 DTS 草稿在偏移和长度上一致，但那份 DTS 自己写明还要串口核对，不能当成实机分区证明。

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

这些门用于我们自己签发的 vendor-compatible 载荷。在原厂 BIN 核对完成之前，不能声称原厂文件已经通过这些门。

原厂网页升级接受的是这份 BIN 本身。`.mp716upd` 是包在它外面的签名容器，不能把 OpenWrt 25.12 的 sysupgrade 镜像塞进原厂升级页。两种格式的差异和上游参考提交见 `upstream-reference.md`。
