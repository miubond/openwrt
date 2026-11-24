# MP716 WireGuard 客户端验收报告

- 固件基线：OpenWrt 25.12.6（MT7628，实验设备 192.168.199.1）
- 验收范围：构建依赖、ucode API（**仅 WireGuard 客户端**）、UCI/防火墙/路由生成、前端客户端页面、RAM 实机 API 验收
- 刷写：未刷写任何设备。实机只替换 `/usr/share/mp716` 下的 ucode 模块；`wg` 工具仅以 RAM overlay 临时挂载，测试后已卸载

## 结论

| 项目 | 结果 |
| --- | --- |
| ucode 纯逻辑测试 `tests/wireguard.uc`（设备上） | 50/50 通过（挂载 `wg`）；不挂载 `wg` 时 21/21，密钥用例按设计跳过 |
| RAM 实机 API 验收 A（原始固件状态，无 WireGuard 组件） | 13/13 |
| RAM 实机 API 验收 B（临时挂载 `wg`，无内核模块） | 9/9 |
| 前端 WireGuard 客户端页面/导航/契约测试 | 通过；`vue-tsc` 通过 |
| 前端全量 vitest | 207 通过 / 17 失败；17 项均为改动前已存在的失败，与 WireGuard 无关 |
| rpcd 插件示例 | 设备上编译通过；无效会话返回 UNAUTHORIZED；授权会话返回掩码视图 |
| 隧道握手与转发 | **未验收**：现有固件没有与内核匹配的 `kmod-wireguard`。内存加载工具已就绪，并在实机验证了不匹配时拒绝加载；等待构建机产出模块包 |

## 交付物

### 固件构建依赖

- `scripts/build-openwrt-test.sh`：`CONFIG_PACKAGE_kmod-wireguard=y`、`CONFIG_PACKAGE_wireguard-tools=y`，并纳入 `required_config` 校验；镜像内容检查新增 `usr/bin/wg`、`lib/netifd/proto/wireguard.sh` 与 `wireguard.ko`。
- `openwrt_system/firmware/config/mp716-ram-test.config`：同样两个软件包。
- `stage.py`、`deploy-native-openwrt.ps1`：打包/部署 `wireguard.uc`、`wg-health.uc`（部署脚本同时补齐 `vpn.uc` 等 VPN 模块）。
- `capabilities.uc`：`wireguard` 能力仅在工具、netifd 协议脚本、内核模块三者齐全时为真。
- 构建脚本另外导出 `wireguard-ram-<内核版本>.tgz`：内含 `wireguard.ko`、`curve25519` 等依赖模块、`wg`、`wireguard.sh`，以及 `manifest`（内核版本、`vermagic`、内建内核配置哈希）。
- `scripts/wg-ram-overlay.sh`：实验室内存加载工具，用于没有集成 WireGuard 的现有固件。内核版本或 `vermagic` 与设备不符时拒绝加载。加载时对模块执行 `insmod`，把 `wg` 和协议脚本以 overlay 方式挂到 `/tmp`，然后重启 netifd。全程不写 flash，重启即恢复。`unload` 会先确认客户端已在页面停用，再卸载。

### 数据面验收流程（内存加载，不刷写）

1. 在 Linux 构建机上，用与设备固件相同的固定提交（`64900e7`）和本仓库的 `build-openwrt-test.sh --lan-candidate` 构建，取产物中的 `wireguard-ram-6.12.112.tgz`。新增的软件包只加入 `=m` 模块，内建内核不变。
2. 把包和 `wg-ram-overlay.sh` 传到设备 `/tmp`，执行 `sh /tmp/wg-ram-overlay.sh load /tmp/wireguard-ram-6.12.112.tgz`。确认 `capabilities.wireguard=true`，页面横幅消失。
3. 在隔离网段放置对端（例如 LAN 上的 PC 运行 WireGuard 服务端，监听 51820），导入它生成的客户端配置后启用。
4. 检查：`latestHandshake` 有值、收发字节数增长、分流模式只走 `allowedIps`、全局模式下 WAN 默认路由未被改动、停用后 `mp716wgc` 和防火墙区域消失、未确认的配置任务在 90 秒后自动回滚。
5. 页面停用客户端，执行 `unload`，或直接重启设备。

### 后端（`integration/ram-web`）

- `wireguard.uc`：业务逻辑，无 CGI 依赖。
- `vpn.uc`：7 条路由，接入统一配置任务（锁、待确认、超时回滚）。
- `wg-health.uc`：提交后接口就绪检查。
- `admin-state.uc`：`wireguard` reload 类型。
- `experiment/rpcd-mp716-wireguard.uc`：只读 rpcd 插件，直接复用 `wireguard.uc`，证明业务逻辑可迁移到 rpcd。
- 接口、UCI 节、防火墙与路由规则详见 `integration/ram-web/VPN.md` 的「WireGuard」一节。

### 前端（`openwrt_system`）

- 高级设置 → VPN 仅新增「WireGuard 客户端」，原厂 CGI 模式下自动隐藏；**无服务器页面与 API**。
- 客户端：导入（文件/粘贴）、编辑、私钥保留/填写/路由器生成、预共享密钥、Endpoint/AllowedIPs、分流与全局模式（全局需单独勾选允许）、启停、15 秒状态轮询（握手时间、收发流量）。
- RouterAPI、DeviceAdapter、Mock、Factory 适配器与契约表同步更新；中、繁、英三语。

## 实机验收明细

### A：原始固件状态（无 `wg`/协议脚本/内核模块）

| 用例 | 结果 |
| --- | --- |
| A1 客户端读取报告“未集成 WireGuard”及缺失组件 | 通过 |
| A2 状态接口列出 `wireguard-tools`、`netifd wireguard.sh`、`kmod-wireguard` | 通过 |
| A3 启用请求被拒绝，消息列出缺失组件 | 通过 |
| A4 分流模式拒绝 `0.0.0.0/0` | 通过 |
| A5 AllowedIPs 与 LAN 重叠被拒 | 通过 |
| A6 服务器保留端口（1701）被拒 | 通过 |
| A7 导入拒绝 `PostUp` | 通过 |
| A8 停用配置经配置任务保存 | 通过 |
| A9 撤销后恢复保存前模型 | 通过 |
| A10 确认后保留新模型 | 通过 |
| A11 停用状态下 network/firewall 文件哈希不变 | 通过 |
| A12 保存 PPTP 不影响 WireGuard 模型 | 通过 |
| A13 默认路由保持 `default via 10.251.0.1 dev eth0.2` | 通过 |

此前一次测试遗留的待确认任务在 90 秒后自动回滚，顺带验证了超时回滚。

### B：RAM 挂载 `wg`（v1.0.20260223），无内核模块（客户端相关）

早期验收含服务器 Peer/导出用例（B1–B6）；产品范围现为**仅客户端**，对外 API 已移除 `vpn/wireguard/server*`。客户端侧用例在收窄前已通过，包括：密钥生成与掩码（B7）、缺 kmod 拒绝启用（B8）、导入与警告（B9）、私钥不入日志/查询（B4–B5）。

### 测试后设备状态

- `/usr/bin` overlay 已卸载，`/usr/bin/wg` 不存在。
- `mp716_vpn` 中的 `wgclient`/`wgserver` 测试模型已删除，只剩 `pptp`、`xl2tp`、`users`。
- network/firewall 中没有 WireGuard 节；默认路由不变；没有待确认任务。
- `/overlay` 剩余 468KB。

## 安全要求核对

- 私钥只出现在 `mp716_vpn`（0600）、netifd 生成的 UCI 与显式 Peer 导出响应中。普通查询返回 `********` 和 `hasPrivateKey`。
- `wg pubkey` 经 0600 临时文件输入，用后删除；`wg-health.uc` 只输出接口状态。
- 前端密钥输入框不使用 `type=password`，避免浏览器密码管理器保存；保存或关闭后清空。导出内容只存在于内存 Blob，未写入 localStorage/sessionStorage（有单测覆盖）。导出请求为 POST 且不缓存。
- 默认分流；全局模式需要显式勾选，用 `/1` 路由实现，不修改 WAN 默认路由（A13 实测，单测 `global_mode_never_replaces_default_route`）。
- WireGuard 防火墙区与 PPTP/L2TP 区相互独立；停用只删除 WireGuard 节（单测与 A11/A12 覆盖）。

## 限制与待办

1. **内核模块**：官方源的 `kmod-wireguard` 与设备自定义内核版本不匹配，按要求未加载。需要在 Linux 构建机或 CI 上，用已更新的 `build-openwrt-test.sh` 构建 RAM 测试镜像。之后需要在隔离网络完成：客户端↔服务器握手、分流/全局路由、Peer 停用、二维码导入手机、`wg-health` 接口状态、回滚后接口消失。
2. **全局模式与 WAN 侧管理**：`/1` 路由会让路由器自身发往非直连网段的流量（包括 WAN 侧远程管理会话的回包）进入隧道。LAN 管理不受影响。需要 WAN 侧远程管理时应使用分流模式；如需全局模式只作用于 LAN 客户端，后续可改为策略路由（独立路由表加 `ip rule`），需在有内核模块的镜像上验证。
3. **刷写标记**：设备上原有的 `/etc/mp716/allow-flash-upgrade`（早于本次工作）保持原样，未新增也未删除。部署时检测到本机环境变量 `DEPLOY_ENABLE_FLASH=1`；本次部署强制关闭刷写，建议在开发机上清除该变量。
4. **部署脚本**：`deploy-native-openwrt.ps1` 无 BOM，Windows PowerShell 5 会按 GBK 解析失败（需 PowerShell 7 或带 BOM 的副本）。设备通过 `wget` 从开发机下载包时返回 “Operation not permitted”；本次改为经 SSH 标准输入传输。
5. **既有测试失败**：前端 17 项 vitest 失败在改动前的 HEAD 上同样存在（仪表盘物理端口、Ping、PPTP/L2TP 可用性页、DHCP、Wi‑Fi PHY、系统信息、定时重启）。
6. **其他未结问题**：设备重启时约 106–260 秒的启动停滞根因尚未定位，与本功能无关。
