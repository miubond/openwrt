# MP716 VPN 互通验收

更新日期：2026-11-20。设备当前运行固件 **1.0.6**。本轮已定位并修复 VPN 配置生成缺陷，OpenVPN 客户端、PPTP 服务端及 L2TP/IPsec 服务端均在下述限定场景完成互通及配置恢复验收。L2TP 当前状态为 **`LIMITED_LAN_L2TP_SERVER_INTEROP_PASS`**，使用四项受控 RAM 临时修复；不代表原 1.0.6 ROM 或尚未构建的新完整固件已通过。不能将配置保存、守护进程启动或离线自测作为 VPN 可用的结论。

本轮不执行固件刷写或重启。测试使用独立临时账号、受限来源规则和配置快照；临时应用后必须恢复原配置、服务、CHAP、路由、DNS 和防火墙，并核对文件类型、权限、属主及内容哈希。本机物理网口已完成[独立逐口实测](mp716-port-mapping.md)，不代替 VPN 互通验收。

## 已确认的产品缺陷

`integration/ram-web/vpn.uc` 的 `sync_network()` 为 VPN 防火墙区生成 `network: []`。只有服务端或 OpenVPN 客户端启用时，区域依靠 `device` 选择器，不需要 `network` 列表。实机 libuci 对空列表的 `set()` 返回 `null`，旧实现因此报“无法写入 VPN 网络配置”，阻断后续配置。

修复将空列表表示为缺失的选项：选项已存在时只删除该选项，不存在时跳过。非空列表沿用原写入路径，保留设备选择器、区域类型和已有管理边界。

在 MP716 的真实 MIPS ucode/libuci 上，使用独立 `/tmp` 配置目录完成以下修复前后对照：

| 隔离场景 | 原 1.0.6 实现 | 修复后实现 |
| --- | --- | --- |
| 仅 PPTP 服务端启用 | 配置生成失败 | 通过，区域不生成空 `network` |
| 仅 L2TP 服务端启用 | 配置生成失败 | 通过，区域不生成空 `network` |
| 仅 OpenVPN 客户端启用 | 配置生成失败 | 通过，区域不生成空 `network` |
| PPTP 客户端使用非空网络列表 | 通过 | 通过，保留 `mp716pptp` 接口及列表 |

以上只调用配置生成函数，使用真实 UCI 的独立目录，不提交生产 UCI、不启动 VPN、不重载网络或防火墙。两组有效对照均确认原 **53 项配置**的类型、权限、属主和内容哈希不变、boot ID 不变，专属临时目录已清理。这些隔离对照证明配置生成缺陷已修复，本身不提供协议认证或隧道数据面证据；实际互通范围由下文各自用例支持。

### PPTP 会话钩子的类型参数

进一步源码核验发现：pptpd 默认会在加载 `pptp.options` 后，向 pppd 命令行追加 `ipparam <外层客户端地址>`，覆盖受管选项中的 `ipparam mp716-pptp`。`vpn-ppp-up.sh` 要求该类型标记，覆盖后即使 PPP 连接成功，也不能生成正确的受管会话记录。

依据是与固定配方 `PKG_HASH` 一致的[官方缓存 pptpd 1.5.0 源码](https://downloads.openwrt.org/sources/pptpd-1.5.0.tar.gz)，归档 SHA256 为 `6a724284b1ce00ea23f7d7608d081843a10c8a8d87d951cb2ea86e70aa1b4e77`。`pptpctrl.c` 的 `launch_pppd()` 先添加 `file`，后按 `noipparam` 条件添加 `ipparam`；`pptpd.c` 支持配置中的 `noipparam`，`defaults.h` 定义默认速率为 `115200`。

最小修复是在生成的 `pptpd.conf` 首行加入 `noipparam`，保留已有强制认证选项及类型钩子。已增加 `pptp_hook_ipparam_not_overridden_by_outer_client_ip` 渲染回归。2026-11-20 的实际拨号已确认真实类型钩子、唯一所属 pppd、强制 MSCHAPv2 服务端策略及双向 MPPE-128；第 13 轮进一步完成 HTTP、ICMP、双向计数和完整恢复，限定范围见下文。

Windows 的原始 LCP 字段必须原样保留；客户端字段为零时不能直接用服务端字段替代。可选的交叉证明须同时确认专属 RAS 配置、明确的原始字段组合、双向 MPPE-128、与已验证模型逐字相同的强制 MSCHAPv2 服务端选项、无额外覆盖的实际 pppd 命令行、进程归属及唯一已认证会话。还须排除隐式选项叠加：全局 `/etc/ppp/options` 必须匹配审定镜像中不含认证或文件导入指令的原像（SHA256 `01f7358a5528be037dde329a2ecfb7a63382aababf21d4f5bc085f5acef95133`），root 用户及实际 pty 对应的额外选项文件须不存在，动态 CHAP 行不得含额外选项。该证明单独标记为“服务端策略与已认证会话证明”，不得把原始客户端字段改为通过。

### L2TP 明文保护规则的语法

`mp716-vpn.init` 的 `prepare_guard()` 先生成拒绝明文 UDP 1701 的保护规则，再提交包含 XFRM `reqid 902` 匹配的规则。原单行模板的 chain 与 table 结束括号之间缺少分隔符，实际 nft 报 `unexpected '}'`，服务应用失败。

修复只在 chain 结束后添加换行。主机 20 项服务回归通过；在 MP716 上提取真实函数，对原模板的 input/output 规则均复现语法失败，修复后的两种拒绝规则及完整规则均通过 `nft --check`。检查前后完整规则图、配置与 boot 不变。

随后一次服务应用出现过超时，原因尚未确定；第 4 轮使用修复版加固定阶段标记的独立 RAM 副本，原生用户与服务端任务均已确认。真实日志覆盖拒绝明文和完整保护规则、CHAP、L2TP/IPsec 实例创建并到达 `start.return`，证明本轮服务应用成功。Windows 对端在实际拨号前的 PSK 检查失败，该轮未完成 IKE、PPP、ESP 或数据面验收。自动采样器还存在使用不受支持的 `string()` 转换函数的问题，已在独立候选中以 `sprintf()` 修复；零条自动采样不能否定独立读取的真实阶段日志。

第 4 轮收尾时，测试控制器将 charon 的正常 socket 策略错误地当作必须包含 `reqid` 的隧道策略。经精确核对所属 PID/start、procd 命令和当前配置后，停止本轮实例，8 条 socket 策略随进程退出自然消失；未删除或清空 XFRM 集合。随后已严格恢复原 53 项配置、CHAP、原 FW4、默认路由、DNS、WAN MTU 与 Wi-Fi 参数，WAN ping、路由器 DNS 和有线 SSH 管理检查通过，临时密钥已撤销，测试专属规则与两个工具目录已清理，boot 不变。电脑私有 PBK 的清理单独留证，不包含在上述路由器恢复结论中。

恢复证据为 `build/hardware-vpn-106/l2tp-20261120-101925-968b940d/recovery-20261120-103735-3bad07/result.json`，继承字段的范围更正见同目录 `report-clarifications.json`。原全局 NFT 快照未持久化；原 FW4 使用持久化的测试前快照核验，其他表以恢复前的新鲜采样核验，不能把两者合并宣称为原全局快照完整对比。

### L2TP 认证选项与 GMP/DH 插件

固定 xl2tpd 1.3.18 的 LNS `require chap = yes` 会向 pppd 追加 `require-chap`。PPP 2.5.2 将其与托管文件中的 `require-mschap-v2` 累加到 want-options；`refuse-chap` 约束的是本机向对端认证的 allow-options，不能据此证明服务端仅允许 MSCHAPv2。修复只移除生成的这一行，保留 `require authentication = yes`、拒绝 PAP、MSCHAPv2、`nomppe` 和类型钩子。原 29 项加 4 项新回归在真 MIPS 上 **33/33 通过**，使用独立 `/tmp` 纯渲染，原完整 53 项配置和 boot 不变，临时目录已清理。源码 SHA256 为 `eeba27e6557755c85d231cf39356de8a9ae424c066d8baa832ba07466b9f4379`，证据为 `build/hardware-vpn-106/uci-repro-20261120-110946-b6b73cb8/result.json`。[xl2tpd 参数生成](https://github.com/xelerance/xl2tpd/blob/v1.3.18/control.c#L956)、[PPP 选项定义](https://github.com/ppp-project/ppp/blob/9f612dc02c34509f062ed63b60bcc7e937e25178/pppd/auth.c#L309)

第 5 轮已在 Windows 私有临时 PBK 中实际完成密钥写入及成功回读，拨号返回 **788**，没有建立 PPP。固定所属 PID 的真机日志明确报告 `gmpdh_plugin_version missing`，接收到包含 AES256/SHA1/MODP2048 的提案，而配置提案缺少所有 DH 组。故障定位到固定 feeds 的 `0904-gmpdh` 补丁仍使用旧 constructor 声明，没有 strongSwan 6.0.7 `PLUGIN_DEFINE(gmpdh)` 所导出的版本字段。修复位于 `scripts/prepare-native-services.py`，只替换这一声明，保持原有组与提案；不是通过降低密码算法要求规避错误。对应 MIPS 插件已完成正式源码重建及离线校验，随后受控 RAM 实验已证明插件加载和 IKE/ESP 建立；后续第 10 轮完成限定 LAN 服务端互通，见下节。[strongSwan 插件接口](https://github.com/strongswan/strongswan/blob/6.0.7/src/libstrongswan/plugins/plugin.h)

离线产物为 `build/hardware-vpn-106/gmpdh-abi-repair/out/libstrongswan-gmpdh.so`，大小 **104,912 字节**，SHA256 为 `0654ef5c0a0602c5ac7a58885e0ed22aed4f92ae45a8ac4a89dfe2e8a82c69df`；构建报告 `abi-report.json` 的 SHA256 为 `fc1f940f0b4e8b86d0650ed85a2c80c6a14bbbd387c31a4641a408b27c3a519b`。使用已核验的 strongSwan 6.0.7、GMP 6.3.0 源码和原补丁，仅将 constructor 改为正式 `PLUGIN_DEFINE(gmpdh)`，由 Zig 0.14.0 编译真正的两份 C 源码并链接静态 PIC GMP；未手工修改 ELF，未使用 shim，离线构建期间未执行目标程序。独立静态校验通过 MIPS32R2/O32/soft-float、版本字段、重定位及 constructor 导出；实际 `NEEDED` 仍为 `libc.so` 与 `libgcc_s.so.1`，15 个强动态未定义符号均与当前固件原库导出逐个匹配，弱未绑定符号为空。实际发布镜像中的 charon 直接依赖这些库及 `libstrongswan.so.0`，全局依赖范围已离线核对，设备端原文件哈希仍须在 RAM 实验前新鲜复核。构建准备脚本的 **12/12** 项回归通过，MODP2048 等原有 DH 组与提案保持不变。

本次仅交付用于受控 RAM 实验的独立插件和后续正常构建所需的补丁准备修复，没有重新构建完整固件；已安装及最新完整候选仍为 **1.0.6**。本项修复不涉及内核、DTS、分区或升级业务逻辑。离线构建完成不能作为真机插件加载、IKE/ESP、PPP 或数据面通过的证据。

第 6 轮通过独立单文件 RAM bind 临时加载上述 proper 插件。固定所属 starter 的真实日志出现 `gmpdh` 已加载，IKE 实际选择 **AES256/SHA1/MODP2048**；IKE_SA 和使用 **ESP AES256/HMAC-SHA1** 的 CHILD_SA 均建立。随后 xl2tpd 报 `Denied connection to unauthorized peer` / `No Authorization`，Windows 返回 **651**，没有启动新的 pppd，不能宣称 PPP 认证或隧道数据面通过。此轮已恢复原完整 53 项配置、完整已保存的全局 NFT 规则、电脑临时连接与网络，WAN 检查通过；插件 bind 随后独立撤销，原插件恢复。实际协议日志见 `build/hardware-vpn-106/l2tp-20261120-121730-498c65ab/readonly-log-20261120-122340/bounded-syslog-private.txt`，其中原始日志须保持私有。

新的拒绝来自固定 xl2tpd 1.3.18 的 LNS 选择：没有匹配的外层 `lac` 来源规则时，`access control = no` 仅回退至 `deflns`。此前生成的是 `[lns mp716]`，不是默认段；`ip range` 是分配给 PPP 客户端的地址池，不能匹配外层来源。最小修复将该段名改成 **`[lns default]`**，没有增加任意来源的 `lac` 规则；原 PPP 身份认证、拒绝弱认证选项、类型钩子、PSK、ESP 选择器和 reqid 902 明文阻断保持不变。[固定 LNS 选择源码](https://github.com/xelerance/xl2tpd/blob/v1.3.18/aaa.c#L285)、[默认段解析](https://github.com/xelerance/xl2tpd/blob/v1.3.18/file.c#L1392)

修复源码 SHA256 为 `2ebcb90d8a9456f22e74ee1b5da323616ca3ed3a19b4f8fa52400efe3ba41872`。原 33 项加 4 项回归在真 MIPS ucode 上 **37/37 通过**：禁用和纯客户端模式不生成接收 LNS；服务端使用唯一默认段且不增加宽泛来源规则；改变 PPP 分配池不改变认证、IPsec、guard 或密钥。测试只在独立 `/tmp` 夹具渲染，原完整 53 项的类型、权限、属主、内容哈希及 boot 不变，未启动服务，专属目录已清理。证据为 `build/hardware-vpn-106/uci-repro-20261120-122746-360c8129/result.json`。这些夹具结果本身只证明配置修复与回归；后续实际互通结论由第 10 轮独立证据支持。

第 5 轮的电脑密钥、私有 PBK 和网络已自动清理。路由器停止服务后，原 CHAP 已显露，但旧测试控制器未接受这一已知状态转换，导致自动恢复暂停。经新鲜完整目录与所有权复核后，已恢复原 53 项、临时密钥为空、VPN 进程与 XFRM 均空、boot 不变，WAN ping、路由器 DNS 和有线管理通过；本轮保存了原完整 NFT 快照，最终完整规则语义与其相等。证据为 `build/hardware-vpn-106/l2tp-20261120-112136-73b8eae4/recovery-20261120-112959-1238a4/result.json`。电脑初次 PSK 回读错误 2 没有被视为“无密钥”；独立实验通过明确写入、成功回读及成功清除/删除验证了该主机的 API 路径。

## 临时修复与已安装固件

现机测试通过单文件 tmpfs bind 临时加载修复后的 `vpn.uc`，不替换 ROM 文件，也不代表 1.0.6 固件已永久修复。

| 对象 | SHA256 |
| --- | --- |
| 原 1.0.6 ROM 中的 `vpn.uc` | `ae3a55611089f121c4fc58c8d677ee64d0fa8b02653a5a260f5e883aac45b152` |
| 本轮批准的 RAM 测试版本 | `ba6f9b3a991f2d6013cee2e5a6d086a81143f1fa78a7b9c78298bd82acad1fe7` |

会话钩子补修位于独立的 `vpn-runtime.uc`：原 ROM 哈希为 `2ed3fabac4884bc7c48baa9287cbf99e71b72d45318081ad6b679d6dbf79b9fd`，补修源码哈希为 `aa14efa6e3e9bbd5e7ea5b5448e87196a036168a288d03f0a7e79327130c2c19`。本轮使用独立单文件 RAM bind 并核对原 ROM；下述 PPTP 成功用例使用此补修，不能视为已经永久升级已安装固件。

各轮测试只允许各明确批准的单文件使用指定 RAM 哈希，其余受检源码与 ROM 版本仍须匹配候选固件。结束时撤销专属 bind；后续应将修复纳入新候选固件，再独立构建、校验和验收。

## 回归与互通状态

| 验证层次 | 当前结论 |
| --- | --- |
| 真实 MIPS ucode/libuci 的四场景配置生成对照 | **通过**，范围见上表 |
| `integration/ram-web/tests/vpn-network.uc` 的 14 项公开回归 | **14/14 通过**，使用真实 MIPS ucode 与假 UCI 对象；原 53 项配置、boot 均不变，临时目录已清理 |
| `integration/ram-web/tests/vpn-runtime.uc` 的运行时渲染及钩子回归 | **37/37 通过**，真实 MIPS ucode 独立夹具测试当前 `2ebcb90d…`；不使用生产 UCI、不启动服务，原 53 项配置与 boot 不变，目录已清理。当前证据 `build/hardware-vpn-106/uci-repro-20261120-122746-360c8129/result.json`；此前 `aa14efa6…` 的 29 项记录保留为历史证据 |
| 临时 PPTP 配置下发、服务进程及受控 CHAP RAM 绑定 | 已观察到成功；不等于拨号或互通成功 |
| PPTP 的真实 PPP 认证、MPPE 与隧道流量 | **限定服务端场景完整通过**：真实认证交叉证明、类型钩子、双向 MPPE-128、两次接口绑定 HTTP、三次 ICMP、同一 PPP 进程双向计数增长及完整恢复均通过 |
| L2TP/IPsec 的 PPP、IKE/ESP 与隧道流量 | **`LIMITED_LAN_L2TP_SERVER_INTEROP_PASS`**：1.0.6 加四项 RAM 修复，Windows 私有临时对端经 LAN 连接服务端；独立 MSCHAPv2 证明、双向加密 ESP、HTTP/ICMP、PPP/ESP 计数及配置与网络完整恢复通过，范围与凭据观察限制见下节 |
| OpenVPN 客户端的真实 TLS 认证及 TUN 数据面 | **限定场景完整通过**：1.0.6 加受控 `vpn.uc` RAM 修复，客户端经 SSH 回环 TCP 连接隔离 Linux 对端；TLS、HTTP、三次 ICMP、双端字节增长和完整恢复均通过，范围见下节 |

离线控制器回归用于检查归属、边界和清理逻辑，不能代替表中未完成的真实协议验收。测试中防火墙重载可能保留无引用的空 VPN 链；只允许在原配置完整恢复、无 VPN 进程且全规则图证明为空、无引用后，删除本轮确切的六条残留链，并再次比对完整规则语义。

### L2TP/IPsec 服务端限定 LAN 场景实测通过

第 10 轮结果为 **`LIMITED_LAN_L2TP_SERVER_INTEROP_PASS`**，控制器结束状态 `L2TP_IPSEC_TEST_FINISHED_BASELINE_AND_NETWORK_RESTORED`。设备仍运行 **1.0.6**，本轮没有刷机、重启或构建新的完整固件。Windows 电脑使用专属、一次性私有 RAS/PBK 和临时账号，通过 MP716 的 LAN 地址连接 L2TP/IPsec 服务端；受限隧道地址为 `192.168.240.1` 与 `.10/.11`，实际客户端获 `.10`。结论仅覆盖该服务端、此电脑和 LAN 路径，不覆盖公网 WAN/NAT-T、多客户端、L2TP 客户端角色、其他对端、吞吐或长期稳定性。

实测使用以下四项独立单文件 RAM 修复，原 ROM 不变。协议及配置测试结束后，已按插件、init、runtime、vpn.uc 的逆序分别撤销全部四项 bind，并清理各自所属 RAM 目录。最后新鲜只读复核确认仍为同一次启动的 1.0.6、原完整 53 项配置精确一致、四项 live 文件哈希均等于各自原 ROM、相关 mount 集合为空，没有待确认任务或 worker，托管 VPN 实例为 0。最终收尾证据为 `build/hardware-vpn-106/fresh-state-20261120-142329/result.json`；该复核不扩展上述互通验收范围。

| 临时覆盖 | 实测 RAM SHA256 |
| --- | --- |
| `vpn.uc`：UCI 空列表修复 | `ba6f9b3a991f2d6013cee2e5a6d086a81143f1fa78a7b9c78298bd82acad1fe7` |
| `vpn-runtime.uc`：类型钩子、MSCHAPv2 排他策略与默认 LNS | `2ebcb90d8a9456f22e74ee1b5da323616ca3ed3a19b4f8fa52400efe3ba41872` |
| `mp716-vpn.init`：明文保护规则分隔符 | `db515ea57f210b2013656afab9c5da3452a87fba252282f7cf9509a3d69a2c79` |
| `libstrongswan-gmpdh.so`：proper 6.0.7 版本导出的真实源码重建 | `0654ef5c0a0602c5ac7a58885e0ed22aed4f92ae45a8ac4a89dfe2e8a82c69df` |

Windows 原始 `mschapv2` **仍为 `false`**：本地认证 protocol/data/EAP 为 `0/0/0`，服务端字段为 `0xC223/0x81/0`，LCP 本地/对端 options 为 `67/64`，全部原样保留。服务端字段没有替代客户端字段；认证结论单列为 `server_attested_client_mschapv2=true`。依据为实际 pppd 的 19 项内核 PPPoL2TP 参数及 socket FD、与审定计划逐字相同的 MSCHAPv2 唯一认证选项、无额外隐式认证选项、原全局 options 哈希与 root `.ppprc` 缺失，以及匹配临时用户、地址、类型、PID/start 的唯一认证后 PPP 钩子。pppd **PID 24308 / start 7943298** 在认证与流量检查前后保持一致。此项为独立服务端证明，不是 Windows 原生字段通过的声明。[Microsoft LCP 字段定义](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/legacy/aa377638%28v%3Dvs.85%29)

实际业务检查包括两次绑定 RAS 接口与隧道源地址的 TCP/HTTP 请求，均返回 **HTTP 200**；`IP_UNICAST_IF` 写入及连接前后读回均为本轮 RAS 接口 **41**，实际端点与隧道地址匹配。三次源地址绑定 ICMP 全部成功（10、1、1 ms）。同一采样窗口内 PPP RX/TX 分别增加 **272 / 245 字节**；双向 ESP 均为 `reqid 902`、transport 模式和非空加密，使用认证阶段已采样的同一组 SPI，两个方向的 ESP 字节计数均增长。UDP 1701 的明文拒绝与 IPsec 保护规则持续核验，未降低密码提案或修改 Windows 全局 IPsec 策略。

凭据观察有明确限制：拨号前请求密码字段得到 `rc=0 / mask=0`，但连接后的同一请求得到 `rc=0 / mask=0x80000000`。本报告不为该未公开观察值命名，也不解释为“受保护句柄”或“无缓存”；未读取不透明内容，保留 `credential_state=unknown-high-bit-mask`、`postdial_no_cached_password_proven=false`。仅在本轮已证明归属的私有临时连接和精确观察条件下继续验证，认证依据仍为上一段独立证明。最后对本轮条目执行 mask **16 和 7** 的凭据清除均返回 0，删除条目返回 0，私有 PBK 枚举返回 0 且数量为 0，专属文件目录删除，电脑原网络、默认 PBK 和其他连接保持或恢复；这些清理结果不反推连接期间不存在缓存。[Microsoft 凭据读取](https://learn.microsoft.com/en-us/windows/win32/api/ras/nf-ras-rasgetcredentialsw)、[凭据清除语义](https://learn.microsoft.com/en-us/windows/win32/api/ras/nf-ras-rassetcredentialsw)

控制器最终严格恢复原 **53 项配置**的类型、权限、属主和内容哈希、原 CHAP、完整保存的全局 NFT/FW4、默认路由与 DNS；XFRM 为空，没有 VPN 守护进程或待确认任务，临时账号及测试密钥撤销，本轮规则与工具目录清理。WAN ping、路由器 DNS 和有线管理检查通过，boot ID 不变。此前第 7 轮已连接但被原始认证字段门阻断、第 8 轮控制器继承调用递归，以及第 9 轮未公开凭据掩码门的失败记录继续保留；这些测试工具或观察边界不应记为新的固件产品回归，也不替代最终实际数据面证据。

最终证据为 `build/hardware-vpn-106/l2tp-20261120-141530-1ccef8f8/result.json`，SHA256 **`955b90c7f8427001e68e27e33eaeb7f8b3453e42fa48fcb81aa39db2df77bed9`**。独立插件及源码修复尚未进入新完整固件，原完整候选仍为 1.0.6；产物 `UNVERIFIED` 和关闭的生产在线升级门保持原状。

### PPTP 服务端限定场景实测通过

第 13 轮设备运行 **1.0.6**，临时加载 `vpn.uc` 的 `ba6f9b3a…` 与 `vpn-runtime.uc` 的 `aa14efa6…`；init 使用原 ROM `c2b90937…`。通过原生接口启用临时测试账号和 PPTP 服务端，测试隧道地址固定为 `192.168.240.1` 与 `192.168.240.10/.11`，实际 Windows 客户端获 `.10`。这只验证该服务端与本机 Windows 对端的 LAN 场景，不覆盖 PPTP 客户端角色、公网路径、吞吐或长期稳定性。

原测试私有 RAS 配置禁止 class-based 路由，导致客户端只有自身 `/32`，缺少通往隧道服务器的路由。后续仅对这个明确启用的临时测试 profile 清除相应禁用标记；先完整排除电脑和路由器全部现有地址、非默认路由与测试 `/24` 的冲突。Windows 实际自动添加 `192.168.240.0/24`，下一跳为隧道 peer `.1`、Protocol 3、Metric 1，且仅位于新建 RAS 接口。该接口另外三条自身、组播与广播路由，以及控制网卡上已单独证明的自动外层 `/32` 均精确核验；没有调用路由写入命令，没有修改原默认路由或 DNS。

Windows 原始客户端 MSCHAPv2 字段仍为 `false`，没有重写为通过；成功依据是上文定义的严格服务端认证交叉证明，加上双向 MPPE-128 和真实已认证类型会话。同一 pppd PID/start 在数据测试前后保持一致。两个 TCP 套接字均绑定测试源地址与 RAS 接口，核对 `IP_UNICAST_IF` 的前后读回值和实际端点；HTTP 返回 **200**。三次源地址绑定 ICMP 均成功（6、11、1 ms）；第二次 HTTP 采样窗口中 PPP RX 增长 **272** 字节、TX 增长 **327** 字节。

最终结果为 `PPTP_TEST_FINISHED_BASELINE_AND_NETWORK_RESTORED`：严格恢复原 **53 项配置**的类型、权限、属主与哈希，原 FW4、默认路由、DNS、Wi-Fi 参数恢复，WAN ping、路由器 DNS 和有线管理检查通过；没有待确认任务或 VPN 进程。电脑临时连接、私有 PBK 和自动路由清理，原网卡、地址、DNS、路由、默认 phonebook、原 profile 与其他连接均恢复。boot ID 未变，没有刷机。证据为 `build/hardware-vpn-106/pptp-20261120-105543-3eb86bf7/result.json`。

### OpenVPN 客户端限定场景实测通过

本次设备运行 **1.0.6**，仅临时覆盖上表的 `vpn.uc`（`ba6f9b3a…`）；`vpn-runtime.uc` 仍使用原 ROM 版本 `2ed3faba…`。通过原生接口上传新的测试证书内嵌配置，应用并确认客户端模式 1。实测链路为 MP716 客户端 → 路由器 SSH 回环转发 → 电脑回环端口 → 隔离 Linux RAM 来宾中的 OpenVPN TCP 服务。该结果验证这一功能链路，不代表固件已永久纳入修复，也不覆盖公网 UDP、TAP、OpenVPN 服务端角色、吞吐或长期稳定性。

客户端的实际 procd PID/start 身份、认证后 route-up 记录和 `tun-mp716` 地址相互对应。Linux 对端完成测试客户端证书验证，协商 **AES-256-GCM**，分配测试 TUN 地址 **10.77.106.6**。HTTP 请求绑定该隧道的源地址并核对实际内核路由，收到精确响应 `MP716_ISOLATED_PEER_HTTP_106`，随后三次隧道接口绑定 ping 全部成功。路由器 RX 从 **0 → 839** 字节、TX 从 **120 → 1068** 字节；来宾 TUN 在独立采样窗口内 RX 增长 **688** 字节、TX 增长 **839** 字节，提供双端数据面交叉证据，采样窗口不作为逐字节相等的断言。

用例收尾已恢复原 **53 项配置**的类型、权限、属主和内容哈希，boot ID 不变；原防火墙规则图、默认路由、DNS 和 Wi-Fi 配置恢复，WAN ping、DNS 及有线后台检查通过。专属 OpenVPN 服务、TUN、待确认任务、SSH 转发及私有 RAM 目录均已清理；只删除本轮新增且空、无引用的六条 VPN 链。原有 VPN 目录缺失状态也已恢复。临时 VM 已按自有进程句柄停止，电脑网络与回环监听清理核验通过，测试客户端配置中的私钥及服务端私钥已逐文件删除；官方缓存、公共证书和脱敏证据保留。受管 RAM 源码覆盖由其所属测试任务另行收尾。

本地证据：`build/hardware-vpn-106/openvpn-20261119-190451-4105ae6a/result.json`，以及 `build/hardware-vpn-106/portable-peer/guest-session-20261119-181658-2e1c5060/openvpn-router-peer-final-cross-check.json`。后者关联路由器结果、来宾原始观察、对应 SHA256 和原测试 profile 哈希；私钥及私有原始日志不作为交付内容。

## 后续角色与场景的通过条件

- **PPTP：** 专属测试账号完成真实 PPP 认证，双向 MPPE-128 生效；流量明确经过本轮 RAS/PPP 接口，TCP、ICMP 及 PPP 双向字节计数提供一致证据。
- **L2TP/IPsec：** 上述限定 LAN 服务端已通过；其他角色和路径仍须明确验证服务端地址匹配、实际 IKE/PPP 成功，UDP 1701 明文保护规则生效，`reqid 902` 的双向 ESP SA 使用相同已观测 SPI 且双向字节增长，随后验证隧道业务流量。
- **OpenVPN：** 专用 Linux 对端完成真实 TLS 身份验证，TUN 接口及隧道路由正确，双向业务流量成功；上述客户端 TUN/TCP 用例已满足这些条件，其余传输、对端与角色须另行验收。只做 TLS 握手或使用空设备不算数据面通过。
- **共同收尾：** 仅停止、删除本轮已证明归属的进程、隧道状态、账号、规则与临时文件；完整恢复原配置，保留管理连接，核验默认路由、DNS、有线管理和 WAN 上网。未知外部变化必须停止并留证，不得清空全局状态。

只有真实协议流量和上述恢复核验均通过，才能将对应 VPN 功能标为实机互通通过。
