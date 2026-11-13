# 安全设计

签名使用 RFC 8032 Ed25519。主机端调用 Python `cryptography`。设备端调用 Monocypher 4.0.3 的 `crypto_ed25519_check`，源码在 `device/third_party/monocypher/`，许可证是 BSD-2-Clause 或 CC0。2020 年 Cure53 审计覆盖的是 Monocypher 3.1 系列；4.0.3 是后续版本，不能把那次审计直接说成对 4.0.3 的认证。

Payload 哈希使用 Brad Conte 的公共领域 SHA-256 实现，和 Python `hashlib` 对测试向量 `abc` 一致。它不是本项目新写的算法。

私钥不进 Git。固件里只放原始公钥。`signing_key_id` 绑定公钥，换一把公钥不能沿用旧签名。

其他约束：

- Manifest 被签名覆盖，改一个字段会使签名失败；非规范 JSON 在验签前被拒绝。
- 降级默认拒绝。镜像里的 `allow_downgrade` 还必须加上本次调用的操作者开关。
- CGI 不接收分区号、文件路径或 shell 命令。
- 上传按块写入 `/tmp`，校验按块计算哈希，不把整包分配成一块内存。
- 可用内存不足时拒绝。上传阶段要求可用内存不少于文件大小加 8 MiB；校验阶段要求不少于 2 MiB。内核 3.10 没有 `MemAvailable` 时使用 `MemFree + Buffers/2 + Cached/2`。
- `--allow-flash-upgrade` 在解析参数时直接失败，不会打开后端。
- 测试会话和 `MP716_RUNTIME_ROOT` 只在主机宏下编译进去。

防变砖不包含自动回滚。设备还没有验证过的串口恢复，也没有 A/B 分区。写入前的校验、只允许 firmware 分区、失败后保持 `unrecoverable`，以及操作者显式执行的 `recover`，是目前定义的全部防护。`recover` 写回的是操作者提供的离线副本，不是程序私自保留的上一版。

体积和栈上缓冲的实测见 `reports/host-build-size.txt`。签名缓冲区是 64 + Manifest + 32 字节，Manifest 上限 8 KiB。
