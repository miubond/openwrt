# mp716-firmware

面向 MP716（YUNXM / HUAYI，MT7628、64 MiB RAM、8 MiB SPI NOR）的 OpenWrt 固件工程。仓库维护板级配置、镜像配方、Vue 3 固件管理后台、签名验证和 Fake MTD 测试。上游版本固定为 OpenWrt v25.12.6，精确提交见 [config/openwrt.commit](config/openwrt.commit)。

## 构建测试镜像

在有 OpenWrt 构建依赖的 Linux 主机上使用下列命令。Vue 构建按 `web/package-lock.json` 安装依赖，需 Node.js 22.12 或更新的 LTS。

```sh
npm ci --prefix web
npm run --prefix web build
git init build/openwrt-source
git -C build/openwrt-source fetch --depth 1 https://github.com/openwrt/openwrt.git "$(cat config/openwrt.commit)"
git -C build/openwrt-source checkout --detach FETCH_HEAD
bash scripts/build-openwrt-test.sh --lan-candidate web/dist \
    build/openwrt-source config/test-device.profile build/lan-candidate
```

RAM 镜像在另一份干净的同提交 checkout 中用 `--ram-web web/dist` 构建。它禁用 SPI 控制器并保留串口 XMODEM 接收。两种镜像都启用直连测试用的单一 LAN，预期地址为 `192.168.1.1`。连接测试时仅接隔离的电脑网线，物理口及 WAN VLAN 映射待确认。候选镜像不会预装 RAM 测试公钥。

Gitea 在 `codex/mp716-firmware` 上自动运行 RAM 和候选镜像工作流，并上传构建报告、配置、SHA-256 清单和测试产物。验收范围、实机证据和待验证项见 [构建报告与验收](docs/production-acceptance.md)。

两个工作流在同一台自托管 runner 上以文件锁依次使用同一个 OpenWrt checkout。默认缓存位于 runner 系统用户的 `~/.cache/mp716-firmware`，也可用 `MP716_OPENWRT_CACHE_DIR` 指向专用持久磁盘。OpenWrt 提交、主机工具版本或构建脚本变化会使用新的缓存。每次构建清理上一种镜像的目标目录、配置覆盖层和 Web 测试公钥，保留下载、主机工具及 MIPS 交叉工具链。首次或迁移到另一台 runner 时需要预热缓存。

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
