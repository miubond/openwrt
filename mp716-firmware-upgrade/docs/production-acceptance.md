# 生产验收

状态为研发测试阶段。此阶段只验收固定源码构建、产物和静态检查。设备启动、物理网络和生产升级另行验收。

实验室 MP716 已运行自研 **1.0.7**（原厂 014 Web/系统已替换，见 [实机运行状态](mp716-device-runtime-state.md)）。下列清单项仍按**发布门**逐项记录，不因单机已迁移而自动标为 RELEASE。

固定源码是 OpenWrt `v25.12.6`，提交 `64900e756efa667774214f9c6b17c113222e01f7`。CI 对独立 checkout 执行固定提交校验，使用该版本的交叉工具链、内核及精简的 ramips/mt76x8 包配置。

在 Linux 上使用上述提交的专用 checkout。以下命令会覆盖该 checkout 的 `.config`，输出 TEST 镜像、构建日志、SHA-256、设备树和构建报告。详细命令见 [项目 README](../README.md#构建测试镜像)。

```sh
bash scripts/build-openwrt-test.sh --lan-candidate web/dist /path/to/openwrt-test config/test-device.profile /path/to/test-output
```

## 容量

mt76x8 子目标带有 `small_flash`，MP716 TEST 配置包含 `kmod-mt7603` 和 `wpad-basic-mbedtls`。固件分区只有 7872 KiB，内存按现有资料是 64 MiB。包含无线驱动后的镜像仍需通过最终大小检查，实际运行内存和生产功能待实机验证。

## 待验证清单

| 项 | 结果 |
|---|---|
| RAM 启动 | 未执行 |
| 网口 | 原厂已只读测量 VLAN 成员及 MAC 来源；1.0.2 候选配置 eth0.1 LAN、eth0.2 WAN（端口 4）。TODO 验证新驱动、每个物理端口、隔离及吞吐 |
| Wi-Fi | 已配置 WMAC 和 MT7603 驱动，nvmem 读取 Factory 偏移 0 的 1024 字节。TODO 实机验证 EEPROM 读取、MAC、校准、AP 认证和连接稳定性 |
| GPIO、按键和指示灯 | TODO 确认引脚与电平 |
| 原厂必要功能 | 已审计当前 DHCP WAN、UPnP 和关闭的可选服务，并生成本地私有迁移计划；候选运行、NAT、DNS、UPnP 和端到端上网未执行 |
| 串口恢复 | TODO 核对 U-Boot 的 RAM 加载地址、内存报告、原厂备份恢复和重启 |
| 固件升级 | 未执行 |
| 断电和异常恢复 | 未执行 |
| 重启后版本核对 | 未执行 |
| 原厂网页首次迁移 | TODO 获取确切的 014 原厂升级文件，核对封装及原厂网页验证规则。原厂 `sysupgrade -T` 通过只验证板卡和镜像头 |

工程已有的历史产物包括 Gitea [RAM 镜像构建 #10333](https://git.cloudlink.hk/cloud/openwrt/actions/runs/10333) 和离线重打包的 LAN 候选镜像。原厂 014 上的签名上传校验和 `sysupgrade -T` 已执行过，尚无自研镜像在 MP716 上启动的记录。本次源码构建的结果以各工作流产物内的 `build-report.json` 为准。

## 发布门

下列任何一项不成立，产物都只能叫 TEST，不能叫 RELEASE：

- 串口恢复已经把原厂固件刷回并启动
- 镜像通过格式、容量、CRC、`yunxm,mp716` 兼容性和签名检查
- 检查没有使用 `sysupgrade -F`
- 镜像不是 EVB BIN，也不是原厂 MTD 备份
- 首次迁移包和后续 sysupgrade 包分别构建
