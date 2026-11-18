# MP716 OpenWrt v25.12.6 硬件兼容性报告

**验收状态 `UNVERIFIED`**。本报告区分原厂 014 的只读记录、候选镜像的静态检查和待做的真机验收。RAM 启动、物理网络、Wi-Fi 和恢复尚待实机确认。生产在线升级保持关闭。

## 源码和独立机型

- 上游为 OpenWrt 官方 `v25.12.6`，固定提交 `64900e756efa667774214f9c6b17c113222e01f7`。目标为 `ramips/mt76x8`，Linux 内核和 SoC 定义取自该提交。[官方标签](https://github.com/openwrt/openwrt/tree/v25.12.6)
- MT7628AN EVB 提供同 SoC 下的 UART、SPI NOR 和镜像布局参考。EVB 的板级 GPIO 复用、物理端口顺序和 Factory EEPROM 配置须有 MP716 自身证据才能采用。[官方 EVB DTS](https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ramips/dts/mt7628an_mediatek_mt7628an-eval-board.dts)
- MP716 使用独立的 `yunxm_mp716` 镜像配置，DTS 和 sysupgrade 元数据使用 `yunxm,mp716`。镜像配置继续使用 `BROKEN := y` 和 `DEFAULT := n` 标记未验收机型。候选镜像仅供实验室校验。

## 板级检查

| 项 | 已知资料和当前实现 | 待实机确认 |
|---|---|---|
| SoC 和 RAM | 原厂报告 MT7628、MIPS 24KEc。设备规格为 64 MiB RAM。候选镜像沿用上游内存探测。 | 捕获 U-Boot DRAM 输出和 OpenWrt `/proc/meminfo`，验证解压及运行空间。 |
| SPI NOR | 原厂 `/proc/mtd` 报告整片 8 MiB、擦除块 64 KiB。候选 DTS 保护 Bootloader、Config、Factory，固件上限为 7,872 KiB。RAM Web 镜像开放 SPI 读取校准数据，四个分区均标记只读。 | 核对冷启动的 SPI JEDEC ID、实际分区和 MTD 只读标志。当前阶段仅做只读检查。 |
| Bootloader 与 UART | 项目资料记录 Ralink U-Boot 1.1.3 系列。DTS 继承 MT7628 的 UART0 和 `ttyS0,57600` Linux 控制台设置。 | 核对串口引脚、电平、实际波特率、U-Boot RAM 加载地址及菜单选项，用串口日志确认 RAM 启动。 |
| 以太网 | 原厂只读审计确认 LAN `eth0.1` / VLAN 1，成员 0、1、2、3、5、CPU 6；WAN `eth0.2` / VLAN 2，成员 4、CPU 6，CPU 带标签。1.0.2 候选按此生成 swconfig，LAN/WAN MAC 为 Factory 偏移 4 的基础 MAC 加 2/3。 | 验证新内核驱动、VLAN 隔离、DHCP WAN、实际吞吐；逐口对应外壳 LAN1–LAN4 标签。原厂已测记录不等于候选驱动验证。 |
| 2.4 GHz Wi-Fi | 原厂接口为 `ra0`。候选 DTS 启用 WMAC，使用 Factory 偏移 0 的 1024 字节 EEPROM，并包含 `kmod-mt7603` 和 `wpad-basic-mbedtls`。 | 验证驱动探测、MAC、射频校准、AP 启动、密码认证和管理页访问。驱动支持已配置，AP 仍需设备自己的 SSID、密钥和区域设置。 |
| GPIO | 候选 DTS 禁用 GPIO，无板级按键或 LED 复用配置。 | 实测 GPIO 编号、极性、复用，以及按钮和指示灯行为。 |
| Vue 管理后台 | 镜像包含 Vue 管理页面、HTTP 服务和签名校验模块。RAM Web 镜像只用于实验室验证。LAN 候选不内置 RAM 测试公钥。 | 在 MP716 上 RAM 启动后确认管理页可达，用独立测试包验证上传、签名检查和错误处理。 |
| 升级和重启 | 构建阶段校验原生 sysupgrade 元数据、SHA-256 和测试容器签名，使用主机模拟验证暂存及重启核验。设备配置默认 `platform=unconfirmed`、`flash-gate=closed`。 | 从 RAM 启动后运行 `sysupgrade -T`。真机写入、恢复、重启和在线升级另行验收。 |

## Flash 边界

| 区域 | 开始偏移 | 结束偏移（不含） | 候选 DTS |
|---|---:|---:|---|
| Bootloader | `0x000000` | `0x030000` | `u-boot`，只读 |
| Config | `0x030000` | `0x040000` | `config`，只读 |
| Factory | `0x040000` | `0x050000` | `factory`，只读 |
| firmware | `0x050000` | `0x800000` | `firmware`，uImage 分区，最大 8,060,928 字节 |

原厂 014 使用厂商维护的 Linux `3.10.108`。早期原厂适配以 OpenWrt Chaos Calmer `v15.05.1` 的升级机制为参考。原厂 014 的 firmware 分区副本大小为 8,060,928 字节，SHA-256 为 `56cac090ab7fa2be00a5c5d3970aef484be8303ae76889e16cd297b19436607d`。其 uImage 名为 `ZC-AP`，后跟 SquashFS。

历史候选曾通过原厂 014 上的 `sysupgrade -T`。原厂升级文件和网页封装规则仍待核实，当前候选不用于原厂网页首次迁移。源码中的 `docs/flash-layout.md` 和 `docs/firmware-format.md` 记录分区和格式细节。

## 交付与验收

- `initramfs-kernel.bin` 用于 RAM 启动和网络、Web 的只读测试。
- `squashfs-sysupgrade.bin` 用于兼容性校验。ZIP 内的 `test.mp716upd` 使用一次性 CI 测试签名，用于验签测试。
- CI 的 `release-manifest.json` 记录固件版本、OpenWrt 版本、构建提交、设备型号、镜像大小、SHA-256 及 `UNVERIFIED` 状态。`reports/` 记录静态检查和设备兼容性。`sha256sums` 覆盖交付文件。

源码中的 `docs/production-acceptance.md` 记录真机验收项和生产升级门。

## 无线校准来源

本地 MP716 的 Factory 分区备份与整片 Flash 的 `0x40000–0x50000` 区间一致。Factory 偏移 0 的小端标识是 `0x7628`，与固定 mt76 版本接受的标识一致。采用上游 MT7628AN EVB 的 1024 字节 nvmem EEPROM 描述。原厂配置备份另带的 512 字节 `mt7628.eeprom.bin` 标识为 `0x7620`，与 Factory 内容不同，当前设备树从 Factory 读取。[上游设备树](https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/ramips/dts/mt7628an_mediatek_mt7628an-eval-board.dts) [固定 mt76 EEPROM 实现](https://github.com/openwrt/mt76/blob/39c960c3ada558b4c2e7915772483d3731573d09/mt7603/eeprom.c)

这是用于后续实机验证的配置依据。无线功率、校准效果及持续连接尚待测量。设备自己的 EEPROM、SSID 和密码由本地备份保管。

## 原厂在用功能迁移（1.0.2 候选）

2026-11-18 通过 SSH 只读查询原厂 014：有线 WAN DHCP 已连接，MTU 1499；LAN 桥为 `br-lan`，UPnP/NAT-PMP 开启，VPN、QoS、DDNS 开关关闭，未发现外接 USB 蜂窝设备。固件加入 `firewall4` 与固定 packages feed 的 `miniupnpd-nftables`，保留上游默认 LAN→WAN 转发、IPv4 NAT 与 WAN 入站限制。后台增加受登录保护的只读网络状态接口。

`scripts/plan-stock-migration.py` 离线读取配置备份，按白名单生成私有 UCI 计划与配置迁移归档，保留 WAN DHCP/MTU/MAC、LAN 地址、DHCP 租约、Wi-Fi 名称/密钥、root 密码哈希、主机名、NTP 和 UPnP。DHCP 池自动排除路由器自身地址，原厂静态租约的 `0` 转为 `infinite`；无线测试使用 HT20。检测到启用的 VPN/QoS/DDNS、非有线路由模式或未适配的防火墙策略时拒绝生成，不能把缺失功能默认为可用。

私有计划按原厂显式开关保留 WAN IPv4 TCP/80 管理例外；公共镜像不开放此例外。该归档包含密钥和密码哈希，只在本地保管，不进入 Git 或公共 CI。它不是原厂后台可上传的固件，也未在设备应用。详见 [迁移说明](stock-014-network-migration.md)。
