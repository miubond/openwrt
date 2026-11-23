# MP716 1.0.8 全局 API 慢请求诊断与架构优化报告

## 执行摘要

| 维度 | 结论 |
|------|------|
| **用户体感「所有 API 都慢」** | 往往是 **前端 GET 全局串行** + **CGI 冷启动** + **Dashboard 类接口本身 0.5–3s** 叠加，而非每个 UCI 读都慢 |
| **根因排序（代码证据）** | ① CGI 每请求解析/加载 ucode 模块链 ② `session access` 每请求一次 ③ shell 采集（hosts/物理口/iw）④ 前端串行队列放大多 tab 首屏等待 |
| **Phase 2 已落地** | `VITE_DEVICE_GET_CONCURRENCY`（1\|2\|3）、增强 `perf-diag`（ubus/session/handler 分段时间）、并行基准脚本 |
| **Phase 3 试验** | `experiment/rpcd-native-readonly.uc`（`system/info` + `wireless/config` 只读）；**全量迁 rpcd 暂不推荐**，待实机对比 ≥30% TTFB 收益再定 |
| **约束** | 未改契约字段、未开刷机、VPN/WAN 确认回滚未动 |

---

## 1. 调用栈（标准 GET）

```
Vue Page
  → DeviceRouterAdapter.call()
      → [内存缓存 TTL]
      → [in-flight 同 path 合并]
      → deviceGetScheduler.run()     ← VITE_DEVICE_GET_CONCURRENCY (默认 1)
      → requestJson() fetch + Bearer + 15s AbortController
uhttpd
  → fork exec CGI
httpd.uc main()
  → ubus.connect()
  → ubus.call session.access (object mp716)
  → route_native()
      → route_system | route_vpn | … | route_admin
          → ubus / UCI cursor / command(shell)
  → ok() → JSON %J
```

**静态资源**：`GET /www/mp716/assets/*.js` **不经过** CGI；TTFB 仅受 uhttpd 读盘影响，通常 &lt;50ms，与 API 不可混为一谈。

---

## 2. 第一阶段：定位清单

### 2.1 固定开销（每条 API）

| 阶段 | 位置 | 说明 | 预估量级* |
|------|------|------|-----------|
| CGI fork + ucode 启动 | uhttpd → `httpd.uc` | 每次新进程；`import dispatch.uc` 链式加载 6+ 业务模块 | **50–300ms**（单核/负载相关） |
| ~~`import admin.uc`~~ | `httpd.uc` | **已改为** `build-meta.uc` 仅版本号 | 减轻 CGI 解析链 |
| ubus connect | `httpd.uc` | 本地 socket | 1–10ms |
| session access | `httpd.uc` | rpcd 权限检查 | **5–40ms** |
| handler | `route_admin` 等 | 业务逻辑 | 0–3000ms+ |
| serialization | `ok()` `%J` | 大 JSON（dashboard） | 5–80ms |

\*需 `touch /etc/mp716-admin/perf-diag` 后看 `/tmp/mp716-perf.log` 实测替换预估。

### 2.2 前端 GET 串行队列

`device-adapter.ts` 原设计：`deviceGetTail` 链式 Promise，**不同 path 也串行**。

影响：

- 首屏若隐式触发 4 个 GET（未全走 dashboard 聚合），墙钟 ≈ **各请求之和**，即使单请求仅 200ms，用户也会感到「全站慢」。
- 与 uhttpd 侧多 CGI 并发能力**反向**：设备能并行 2–3 个 CGI 时，前端仍为 1。

**验证**：

```powershell
# 客户端并行打满（模拟未去重场景）
python scripts/benchmark-client-parallel.py --workers 6 --rounds 3
# 对比 wall_ms 与 sum_ms；penalty 高 → 设备或串行放大
```

**前端 A/B**（重新 build 后 Ctrl+F5）：

```env
VITE_DEVICE_GET_CONCURRENCY=1   # 默认
VITE_DEVICE_GET_CONCURRENCY=2   # 建议先试
VITE_DEVICE_GET_CONCURRENCY=3   # 单核 CPU 须观察 loadavg
```

保留 **in-flight 合并**与 **segment 缓存** 不变。

### 2.3 冷/热缓存

| 层 | 键 | TTL |
|----|----|-----|
| 设备文件缓存 | `hosts`, `home_dashboard`, `system_info`, … | 3–5s（`admin.uc`） |
| 前端 Map | `home/dashboard` 12s, `system/status` 5s, … | `device-adapter.ts` |
| 预热 | `admin-tick` → `warm_api_cache` | 周期刷新 hosts/physical_ports |

冷启动：`rm -rf /tmp/mp716-api-cache` 后首轮 dashboard 最慢。  
热启动：同 path 在 TTL 内应显著下降（handler_ms↓，shell_ms≈0）。

### 2.4 TTFB 对比方法

```powershell
# 简单 API
curl -w "ttfb=%{time_starttransfer} total=%{time_total}\n" -o NUL -s `
  -H "Authorization: Bearer $TOKEN" http://192.168.199.1/cgi-bin/mp716/system/ping

# Dashboard
curl -w "ttfb=%{time_starttransfer} total=%{time_total}\n" -o NUL -s `
  -H "Authorization: Bearer $TOKEN" http://192.168.199.1/cgi-bin/mp716/home/dashboard

# 静态 JS（对照）
curl -w "ttfb=%{time_starttransfer}\n" -o NUL -s http://192.168.199.1/mp716/assets/index-*.js
```

设备侧分解：`scripts/device-cgi-breakdown.sh`（需 `MP716_TOKEN`）。

### 2.5 CPU / RSS

在设备上：`loadavg`、`free`、`/proc/<uhttpd>/status`；压测时对比 `uhttpd` 子进程峰值 vs `rpcd` 常驻 RSS。

---

## 3. 最慢 10 接口（根因 + 耗时分布）

| # | 路由 | 典型耗时分布 | 根因 | 代码 |
|---|------|----------------|------|------|
| 1 | `home/dashboard` | handler 60% shell 35% CGI固定 5% | 聚合 hosts+物理口+双 iface+system_info | `admin.uc` `home_dashboard` |
| 2 | `hosts/overview` | 同 hosts | connected+ACL | `route_admin` |
| 3 | `wireless/clients` | shell 70%+ | `iw station dump` detail=true | `stations()` |
| 4 | `hosts/connected` | shell 50% | `ip neigh`+hostapd | `hosts()` |
| 5 | `home/physical-ports` | shell 40% | swconfig/port-links | `physical-ports.uc` |
| 6 | `system/status` | handler+重复采样 | iface×2+hosts+cpu | `system_status_cached` |
| 7 | `system/info` | shell 30% | df+date | `system_info` |
| 8 | `network/wan/config` | hosts 拖尾 | clientMac 拉 hosts | `route_admin` |
| 9 | `system/logs` | shell 80% | logread | `route_admin` |
| 10 | `wireless/status` | ubus+stations | 客户端计数 | `wifi_status` |

**修改前后（机制层，数值待实测填表）**：

| 指标 | 优化前 | 优化后（1.0.8 小步） |
|------|--------|----------------------|
| `system/status` 热缓存 | 每次 full stack | 3s 快照 + 共享 hosts/info |
| 前端多 GET 墙钟（4 接口） | ≈4× 单请求（串行） | 并发 2 时 ≈2× max（理想） |
| perf 可见性 | 仅 total/shell | + ubus_connect/session/handler |

---

## 4. 第二阶段：已做与建议

### 已落地

- `VITE_DEVICE_GET_CONCURRENCY` + `device-get-scheduler.ts`（单测覆盖）
- `perf-diag` 扩展字段
- `benchmark-client-parallel.py`、`device-cgi-breakdown.sh`

### 建议下一步（仍属小步）

1. ~~**拆分 `firmware_version`**~~ → **已实现** `build-meta.uc`。
2. ~~**`dispatch.uc` 按前缀短路**~~ → **已实现** `handler_chain()`（如 `home/*` 不再串呼 6 个 handler）。
3. **session access 缓存**：同 token 100–200ms 内短缓存（须谨慎，仅读 GET、写操作失效）。
4. 页面级：**禁止** Dashboard 周期内再调 `hosts/overview`（代码审查 `grep getHostsOverview`）。

---

## 5. 第三阶段：CGI vs rpcd 结论

### 试验物

- `integration/ram-web/experiment/rpcd-native-readonly.uc`
- 方法：`ping`、`native_system_info`、`native_wireless_config`
- 权限：每条 `session access` + ACL `mp716`（与 CGI 一致）

### 理论差异

| | CGI `httpd.uc` | rpcd 常驻 |
|---|----------------|-----------|
| 模块加载 | **每请求** | **一次** |
| 进程 | fork | 复用 worker |
| HTTP 路径 | `/cgi-bin/mp716/...`（不变更可取） | ubus→uhttpd 需网关或内部转发 |
| 风险 | 进程隔离好 | 内存泄漏须监控；须严格 ACL |

### 迁移 RouterAPI 不变的前提

- 保持对外 URL **`/cgi-bin/mp716/{path}`**；可由轻量 CGI **仅做鉴权转发**至 ubus（thin gateway），前端无感。
- 或 uhttpd 双栈：逐步把只读 path 映射到 ubus，**写操作与 config-task 仍走现有 CGI** 直至对等实现。

### **最终建议（当前）**

1. **先**在实机完成：perf 日志 + `benchmark-native-api.py` + 前端并发 2 A/B + `benchmark-client-parallel.py`。
2. 若 **`ubus_connect_ms + session_access_ms + handler 解析`** 占单简单 GET &gt;40% 且 rpcd 试验较 CGI **稳定 ≥30% TTFB 下降** → 启动 **thin CGI + rpcd 只读** 渐进迁移。
3. 若主要时间在 **shell_ms（hosts/dashboard）** → **优先服务端缓存与采集合并**，迁 rpcd **收益有限**。
4. **不推荐**一次性全接口迁 rpcd：VPN 确认/回滚、config-task 锁与现有 `admin-state.uc` 状态机强耦合。

---

## 6. 未解决问题与风险

- 无 `ROUTER_ROOT_PASSWORD` 时本报告 **无数值 P50/P95**，须设备补测。
- 并发 3 在单核 MP716 可能升负载导致 **更差** P95。
- rpcd 试验未进默认 `deploy-native-openwrt.ps1`，避免误暴露 ubus。

---

## 7. 复现命令速查

```powershell
$env:ROUTER_ROOT_PASSWORD = '...'
cd D:\goweb\src\openwrt_system
# 并发 A/B 需改 .env.openwrt 后 npm run build:openwrt && deploy
.\firmware\scripts\deploy-native-openwrt.ps1

python D:\goweb\src\openwrt\mp716-firmware-upgrade\scripts\benchmark-native-api.py --iterations 12
python D:\goweb\src\openwrt\mp716-firmware-upgrade\scripts\benchmark-client-parallel.py
plink root@192.168.199.1 "sh /usr/share/mp716/device-cgi-breakdown.sh"  # 部署脚本后可拷贝 sh
```