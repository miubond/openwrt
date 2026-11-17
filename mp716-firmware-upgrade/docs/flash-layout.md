# Flash 布局

MP716 的原厂分区记录和候选 DTS 使用以下偏移及长度。候选镜像中的前三个分区带有 `read-only`，实机启动后的 MTD 探测结果待核对。

| 用户名称 | DTS 标签 | 偏移 | 长度 |
|---|---|---|---|
| Bootloader | u-boot | 0x000000 | 0x030000 |
| Config | config | 0x030000 | 0x010000 |
| Factory | factory | 0x040000 | 0x010000 |
| firmware | firmware | 0x050000 | 0x7B0000 |

`firmware` 最大 8,060,928 字节。Bootloader、Config、Factory 不在可写范围。

真实写入被禁止按 MTD 编号进行。本轮的 Fake MTD 只接受已经存在、长度正好是 8,060,928 字节、并且以 `.fakemtd` 结尾的普通文件。路径里出现 `/dev/mtd` 或 `mtdblock` 会被拒绝。

SPI NOR 的模拟语义是：擦除变成 `0xFF`，编程是按位与。擦除一旦完成，报告 `unrecoverable=true`，直到读回哈希匹配才清除。失败不会自动写回旧内容。操作者可以在开发机上用单独的离线副本执行 `recover`；这仍然只作用于 `.fakemtd` 文件。代码不声称有 A/B 分区可以自动恢复。

`device/src/mtd_backend_real.c` 只返回 `flash_disabled`。它不在 `device/Makefile` 和 `scripts/build_host.py` 的源文件列表里，里面没有擦除或写入调用。
