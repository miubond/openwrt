# MP716 OpenWrt v25.12.6 硬件兼容性报告

**验收状态 `UNVERIFIED`**。本报告区分原厂 014 的只读记录、候选镜像的静态检查和真机测试。单机基础启动与网络结果见下方更新；RAM 启动、恢复和长期稳定性尚待实机确认。2026-11-19 已完成本机逐口映射，见[逐口实测](mp716-port-mapping.md)。生产在线升级保持关闭。

2026-11-18 更新：经设备所有者明确授权，GitHub #44236439754 的 1.0.2 sysupgrade 镜像已在这一台 MP716 上写入并重启，确认 Linux 6.12.112、`yunxm,mp716` 和版本配置 1.0.2。原 Wi-Fi 名称/密码、管理地址 192.168.199.1 和管理员密码已迁移。有线、Wi-Fi 的后台、DNS、经 WAN/NAT 的公网访问实测通过，Bootloader/Config/Factory 读回与刷前逐字节一致。该记录是单机基础启动与网络测试，不改变全部镜像的 UNVERIFIED 或生产在线升级关闭状态；RAM 启动、恢复、GPIO、逐口编号和长期稳定性仍待验收。详见 [单机测试记录](mp716-1.0.2-device-test.md)。

## 1.0.5 软件候选与验证边界

2026-11-19 后续更新：经设备所有者明确授权，GitHub #44443686119 / `80f7b4a967300e0968ea50581daec6ffd353f78a` 的 1.0.5 已在同一台 MP716 上完成一次标准保配置升级。原 Wi-Fi 凭据、管理地址和 17 个原有配置/身份文件保持一致；保护分区读回未变。实际完整 Vue 资源、原管理员登录、32 个静态 GET 接口及有线/无线各自的 DHCP、DNS 和 WAN/NAT 数据面检查通过。电脑原 WLAN 已恢复，临时测试 profile 已删除。浏览器自动操作被用户停止，因此逐页浏览器点击验收未完成。此次单机基础结果不改变产物的 `UNVERIFIED` 或关闭的生产在线升级门，详见 [1.0.5 实机记录](mp716-1.0.5-device-test.md)。

1.0.5 集成以 `D:\goweb\src\openwrt_system` 为主源码的 Web 0.2.0，增加原生系统、VPN、诊断服务及异步配置应用/确认/回滚。升级前的原生夹具验证在运行 1.0.3 的设备 `/tmp` 独立配置内执行；该阶段未对生产环境执行网络重载、无线重载、VPN 守护进程、时钟设置、重启和恢复出厂命令。旧主机缺少 BusyBox timeout 时，真实 worker 测试使用只允许私有假服务的临时兼容脚本；该脚本不进入固件，不能用其结果宣称候选镜像的 timeout 已完成实机验收。

固件包含 PPTP/L2TP、OpenVPN TUN 与 L2TP/IPSec 的依赖和默认关闭的托管服务；还须分别验证真实 PPP、XFRM、证书、远端认证及隧道互通。未检测到可验证的蜂窝调制解调器，因此不声明支持 4G/APN。新配置的 11B、原厂私有无线参数、可选 MPPE 和 OpenVPN TAP 不作为已实现功能。本机交换机外壳映射现已逐口确认，记录见[网口实测报告](mp716-port-mapping.md)，不推广为未测硬件版本的默认结论。

2026-11-20 补充：当前完整固件仍为 **1.0.6**，没有为本轮修复重新构建或刷写完整固件。加受控 RAM 修复后，OpenVPN 客户端在隔离 Linux TUN/TCP、SSH 回环场景通过；PPTP 服务端及 L2TP/IPsec 服务端在单机 Windows 对端的限定 LAN 场景通过。L2TP 状态为 **`LIMITED_LAN_L2TP_SERVER_INTEROP_PASS`**：使用 `vpn.uc`、`vpn-runtime.uc`、init 和 proper GMPDH 插件四项临时修复，独立 MSCHAPv2 服务端证明、HTTP/ICMP、双向 PPP/ESP 计数及原 53 项配置、完整全局 NFT、电脑网络恢复通过。Windows 原始 MSCHAPv2 字段仍为 false；拨号后 `0x80000000` 凭据观察仅记为未知，未宣称无缓存，专属凭据与 PBK 已强清理。四项源码/插件 bind 已全部逆序撤销，各自 RAM 目录清理；最终新鲜只读复核确认原 53 项配置精确一致、四项 live 哈希均回到原 ROM、相关 mount 为空，无待确认任务、worker 或托管 VPN 实例，仍为同次启动的 1.0.6，证据为 `build/hardware-vpn-106/fresh-state-20261120-142329/result.json`。本结论不覆盖公网 WAN/NAT-T、L2TP 客户端或其他对端、性能和长期稳定性，不改变 `UNVERIFIED`、原 ROM 或关闭的生产在线升级门。详见 [VPN 互通报告](mp716-vpn-interoperability.md#l2tpipsec-服务端限定-lan-场景实测通过)，最终证据 `l2tp-20261120-141530-1ccef8f8/result.json`（SHA256 `955b90c7f8427001e68e27e33eaeb7f8b3453e42fa48fcb81aa39db2df77bed9`）。

同次 CI 的 LAN 与 RAM 候选均内置该次一次性测试签名的公钥，用于离线包验证；私钥不交付。保留原签名格式，`platform=unconfirmed`、`flash-gate=closed`，网页只开放上传并校验。编译通过、接口夹具通过与固件启动/网络/恢复验收分别记录，不能互相替代。

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
| Vue 管理后台 | 镜像包含完整 Vue 管理页面、HTTP 服务和签名校验模块。同次 CI 的 LAN/RAM 镜像使用相同的一次性测试公钥。 | 分别验证新镜像启动、页面可达、原生接口、上传签名和错误处理；已有版本的结果不能代替新镜像验收。 |
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
