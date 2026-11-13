# 生产验收

状态：未发布。编译没有执行，硬件测试没有执行。编译成功也不等于这台 MP716 可以刷写。

固定源码是 OpenWrt `v25.12.6`，提交 `64900e756efa667774214f9c6b17c113222e01f7`。本机没有 gcc、make，工作区也没有检出这棵源码树，所以 initramfs 和 sysupgrade 测试固件都没有生成。

在 Linux 上使用上述提交的专用 checkout 和一个 MP716 设备配置。配置中的 `installed_custom_firmware` 必须等于计划打包的固件版本。以下命令会覆盖该 checkout 的 `.config`，输出 TEST 镜像、构建日志、SHA-256 和 sysupgrade 元数据。

```sh
bash scripts/build-openwrt-test.sh /path/to/openwrt-test /path/to/device.profile /path/to/test-output
```

## 容量

mt76x8 子目标带有 `small_flash`，默认包包含 `kmod-mt7603` 和 `wpad-basic-mbedtls`。固件分区只有 7872 KiB，内存按现有资料是 64 MiB。这个组合装得下裁剪后的系统，装不下原厂 014 的全部网页、VPN、QoS 和云功能，也装不下完整 LuCI。TEST profile 先去掉未验证的无线包。是否满足生产功能，要等真实镜像体积出来后再判断。

## 未执行的测试

| 项 | 结果 |
|---|---|
| RAM 启动 | 未执行 |
| 网口 | 未执行。DTS 中以太网保持关闭 |
| Wi-Fi | 未执行。DTS 中无线保持关闭，EEPROM 未测量 |
| GPIO、按键和指示灯 | 未执行 |
| 原厂必要功能 | 未执行 |
| 串口恢复 | 未执行 |
| 固件升级 | 未执行 |
| 断电和异常恢复 | 未执行 |
| 重启后版本核对 | 未执行 |

## 发布门

下列任何一项不成立，产物都只能叫 TEST，不能叫 RELEASE：

- 串口恢复已经把原厂固件刷回并启动
- 镜像通过格式、容量、CRC、`yunxm,mp716` 兼容性和签名检查
- 检查没有使用 `sysupgrade -F`
- 镜像不是 EVB BIN，也不是原厂 MTD 备份
- 首次迁移包和后续 sysupgrade 包分别构建
