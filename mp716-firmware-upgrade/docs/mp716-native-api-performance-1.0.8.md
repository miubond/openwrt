# MP716 1.0.8 Native API 性能基线与优化说明

## 1. 范围与方法

| 区域 | 路径 |
|------|------|
| CGI / 路由 | `integration/ram-web/httpd.uc`, `dispatch.uc`, `native-routes.json` |
| 业务聚合 | `integration/ram-web/admin.uc` 及子模块 |
| 状态采集 | `physical-ports.uc`, `system-values.uc`, `network-values.uc` |
| 前端 | `openwrt_system/src/api/adapters/device-adapter.ts`，各 `*Page.vue` |
| 契约 | `openwrt_system/native-web-contract.json` |

**请求模型（静态结论）**：每条 HTTP 请求由 `uhttpd` 拉起 **`ucode httpd.uc` CGI**，非常驻进程；handler 内同步执行 `ubus` + `popen`（shell），无跨请求线程池。

**实测工具**（需设备在线且设置 `ROUTER_ROOT_PASSWORD`）：

```powershell
# 部署含 perf-diag / 缓存优化后的 ram-web
cd D:\goweb\src\openwrt_system
npm run build:openwrt   # 若需刷新前端
.\firmware\scripts\deploy-native-openwrt.ps1

# 开启性能诊断（可关闭：rm /etc/mp716-admin/perf-diag）
plink root@192.168.199.1 "touch /etc/mp716-admin/perf-diag; rm -f /tmp/mp716-perf.log"

# 跑 GET 基准（冷/热混合，默认每路由 8 次）
python D:\goweb\src\openwrt\mp716-firmware-upgrade\scripts\benchmark-native-api.py `
  --host 192.168.199.1 --iterations 12 --out benchmark-before.json

# 读分阶段日志（无 Token/密码）
plink root@192.168.199.1 "tail -50 /tmp/mp716-perf.log"
```

日志字段：`request_id`（token 前 8 位）/ `route` / `total_ms` / `system_command_ms` / `serialization_ms`。

> **说明**：本环境当前未配置 `ROUTER_ROOT_PASSWORD`，下表 P50/P95/P99 为 **代码路径推导的优先级与根因**；部署后请用 `benchmark-native-api.py` 填入「优化后」列并与 `perf` 日志交叉验证。

## 2. 架构与热点（证据）

### 2.1 后端

| 机制 | 位置 | 行为 |
|------|------|------|
| API 文件缓存 | `admin.uc` `read_api_cache` | `/tmp/mp716-api-cache/*.json`，配置写入时 `clear_api_cache()` |
| 定时预热 | `admin-tick.uc` → `warm_api_cache` | 周期性刷新 `hosts`、`physical_ports` |
| `hosts()` | `admin.uc` | `ip neigh` + DHCP 租约 + `hostapd.*.get_clients`（列表路径 **不** `iw dump`） |
| `stations(..., true)` | `wireless/clients` | 每 AP **`iw dev … station dump`**，高成本 |
| `physical_ports` | `port-links.sh` 或 5× `swconfig` | dashboard 与 `home/physical-ports` 共享缓存 |
| `system_info` | `df` + `date` + `ubus system info` | 原 `system/status` 与 dashboard 重复 |
| `sample_cpu` | `system-values.uc` | 500ms 内二次请求读缓存，否则快速 delta |

### 2.2 前端

| 机制 | 位置 | 行为 |
|------|------|------|
| GET 去重 + 串行 | `device-adapter.ts` `deviceGetInflight` + `deviceGetTail` | 同 segment 合并；全局串行减轻 uhttpd 队列 |
| 分 segment TTL | `DEVICE_GET_CACHE_MS_BY_SEGMENT` | dashboard / hosts 12s；配置类 30s |
| 首页轮询 | `DashboardPage.vue` | 可见 20s / 隐藏 30s，仅 `getHomeDashboard()` |

`flashUpgradeEnabled`：**未修改**，`httpd.uc` 仍为 `false`。

## 3. 最慢 10 个接口（预期根因）

| 优先级 | 路由 | 主要根因 | 代码位置 |
|--------|------|----------|----------|
| 1 | `GET home/dashboard` | 聚合 `hosts` + `physical_ports` + 双 `iface_status` + `system_info` + `wifi_status` | `admin.uc` `home_dashboard` |
| 2 | `GET hosts/overview` | 单次响应含 `connected`（同 `hosts` 成本）+ `access_list` | `route_admin` |
| 3 | `GET wireless/clients` | `stations(..., true)` → **`iw station dump`** | `admin.uc` `stations` |
| 4 | `GET hosts/connected` | `ip neigh` + Wi-Fi 客户端枚举 | `hosts` |
| 5 | `GET home/physical-ports` | `swconfig`/脚本读链路 | `physical-ports.uc` |
| 6 | `GET system/status` | 原重复 `system_info`+`hosts`+双接口状态+CPU 采样 | `system_status_payload` |
| 7 | `GET system/info` | `df` + `date` shell | `system_info` |
| 8 | `GET network/wan/config` | 为 `clientMac` 调用 `hosts_cached` | `route_admin` |
| 9 | `GET network/lan/status` | `iface_status` + `hosts_cached` 计数 | `route_admin` |
| 10 | `GET system/logs` | `logread -l 100` 子进程 | `route_admin` |

简单 UCI 只读（如 `wireless/config`、`network/lan/config`）预期落在 **&lt;200ms** 量级（单核 CGI + ubus，无大 shell）。

## 4. 本次已做优化（小步、可回滚）

| 变更 | 目的 |
|------|------|
| `perf-diag.uc` + `httpd.uc` / `command()` 挂接 | 可分阶段耗时；`MP716_PERF_DIAG=1` 或 `touch /etc/mp716-admin/perf-diag` |
| `command()` 默认 **15s timeout** | 满足「命令超时」；已含 `timeout` 前缀的不二次包装 |
| `API_CACHE_TTL` 分键：**3s** `system_info`/`system_status`，**5s** `hosts`/`physical_ports`/`home_dashboard` | 状态短缓存；写配置仍 `clear_api_cache` |
| `system_info_cached` / `system_status_cached` | 减少与 dashboard 并行时的重复 shell |
| `deploy-native-openwrt.ps1` 同步 `httpd.uc`、`admin-state.uc`、`perf-diag.uc` | 热更含诊断与 command 超时 |
| `scripts/benchmark-native-api.py` | 全 GET 路由 P50/P95/P99 JSON 报告 |

**未做**（需 perf 日志证据后再动）：`wireless/clients` 降采样、`network/wan/config` 去掉 `hosts` 依赖、dashboard 与 status 字段级拆分、后端并发 ubus。

## 5. 验收目标对照（需实测填数）

| 类别 | 目标 P95 | 优化前（待测） | 优化后（待测） |
|------|-----------|----------------|----------------|
| 简单配置 GET | &lt;200ms | — | — |
| 普通状态 GET | &lt;500ms | — | — |
| `home/dashboard` | &lt;1000ms | — | — |

在 `benchmark-*.json` 中按路由填写；`slowest_p95` 数组即最慢 10 条。

## 6. 风险与未解决问题

1. **`wireless/clients`**：`iw dump` 在终端多时线性变慢；缓存会陈旧化实时速率（若未来加缓存需与 Wi-Fi 配置 POST 联动失效）。
2. **`command()` 统一 timeout**：极少数 &gt;15s 的诊断命令可能被杀；VPN/固件验签走独立路径。
3. **CGI 串行 + 前端串行**：吞吐受单核限制；并发 benchmark 会排队，应用「单用户浏览」模型测 P95。
4. **预热与 TTL**：`admin-tick` 仍周期性全量 `hosts`；极端 idle 后首击仍冷启动慢。
5. **内存**：文件缓存有界；需长时间打开 Dashboard 观察 `/tmp/mp716-*` 与 `uhttpd` RSS（未在本机实测）。

## 7. 建议复测步骤

1. 部署后 **清空** `rm -rf /tmp/mp716-api-cache`。
2. `benchmark-native-api.py --iterations 12` 各跑两轮：冷启动一轮、间隔 10s 再一轮（观察缓存命中）。
3. 开启 perf-diag，浏览器只开 Dashboard 5 分钟，检查日志是否重复相同 shell 命令。
4. 对照验收表；未达标项只改对应函数，禁止无日志大面积重写。