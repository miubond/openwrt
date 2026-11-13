# MP716 固件升级系统

独立仓库，负责 MP716（YUNXM / HUAYI，MT7628，8 MiB SPI NOR，64 MiB RAM）的升级包格式、签名、设备端校验、升级状态机和 Fake MTD。升级逻辑不放进 Vue 管理后台。

当前版本可以在开发机上独立生成 `.mp716upd`、验证签名、模拟写入，并在模拟失败后按操作者给出的离线副本恢复。它不会写真实路由器 Flash，也不会在失败时自动回滚。

防变砖指严格校验、限制写入范围、减少升级风险，以及一条可重复的人工恢复路径。MP716 还没有验证过可靠的串口恢复，也没有 A/B 分区，所以不能把“失败后一定自动恢复”当成已有能力。

## 版本要分开记

| 项目 | 当前值 |
|---|---|
| 产品 | MP716 |
| 原厂软件 | 014 |
| Web UI | 1.0.0 |
| 升级引擎 | 1.0.0 |
| 自研固件 | 空。没有真实启动记录之前不能写成 1.0.0 |

## 本机验证

```text
python -m pip install -r packer/requirements.txt
python scripts/build_host.py
python tests/run_all.py
```

打包和校验：

```text
python packer/mp716_fwpack.py --help
python packer/mp716_fwverify.py --help
```

私钥必须放在仓库外。`scripts/release.sh` 会拒绝仓库内的私钥、占位硬件修订，以及 `--allow-flash-upgrade`。

自研升级选型是 OpenWrt Chaos Calmer 15.05.1 的 sysupgrade 机制，加上 Shell/C 校验。第一阶段参考仓库是 `openwrt/chaos_calmer` 标签 `v15.05.1`。入口在 `integration/openwrt-package`。它不自写 `mtd write`，也不带 Go 或数据库服务。官方 15.05.1 内核是 3.18.23，设备是 3.10.108，所以不能把官方镜像或官方 sysupgrade 装进当前系统。平台文件默认 `unconfirmed`，准入文件默认 `closed`。兼容性结论见 `docs/mp716-hardware-compatibility.md`。

## 还不能做的事

- 原厂升级包 `HUAYI_ZC-AP_MT7628DA_spi_8M64M_None_014_2024-11-13.bin` 不在本工作区，参考 SHA-256 尚未核对。
- 当前路由器 firmware 分区副本已核对：8060928 字节，uImage 名称 `ZC-AP`，SquashFS 在 `0x12DB89`。这不是可写回的升级包。
- 原厂管理员 Cookie 的名字和服务端会话存储没有确认，CGI 默认 `auth.mode=deny`。
- 真实 MTD 后端没有实现，也没有加入构建。测试机安装要等第一阶段的打包、验签、模拟写入和人工恢复全部通过，并且串口与原厂固件恢复演练有记录之后再开始。
