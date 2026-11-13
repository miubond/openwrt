# 架构

升级被拆成四个进程边界，避免网页断开时中断写入，也避免把擦写逻辑放进 Vue。

```text
Vue FirmwareUpgradeAdapter
        |  HTTP，只传文件和操作名
        v
mp716-upgrade.cgi          认证、CSRF、限长、流式落盘
        |  固定路径，不接受分区参数
        v
mp716-upgraded             状态机、二次校验、Fake MTD
        |
        +-- image_verify / Ed25519 / SHA-256
        +-- FakeMTD（普通文件）
```

CGI 的 `start` 在测试构建里拉起独立的 `mp716-upgraded apply` 后立即返回。生产构建的 `start` 直接返回 `flash_disabled`，因为真实 Flash 后端没有链接。

写入前，`apply` 要求运行路径位于 `/tmp/`。主机测试把运行目录当作这块 tmpfs 的替身，并且只在 `-DMP716_HOST` 下生效。生产二进制不读取这个环境变量。

原厂 `cgi_huayi.cgi`、`cgi_stream.cgi`、`huayi_core`、无线驱动和 VPN/QoS 不在本仓库修改。

`recover` 只存在于升级控制程序的命令行。CGI 没有这个操作。失败停在 `FAILED`，不会自动把模拟分区恢复成擦除前的内容。操作者要用单独保存的 firmware 分区副本再次执行恢复。详见 `recovery-plan.md`。
