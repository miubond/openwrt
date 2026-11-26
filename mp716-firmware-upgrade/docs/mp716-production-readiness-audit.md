# MP716 生产 Web 刷写放行审计（签核用）

**审计日**：2026-11-26  
**结论**：**现阶段不得默认放开生产刷写**（upgrade-policy=production 进 RELEASE）。  
目标流程「登录 → 上传 → 确认 → 刷写 → 重启」在 **代码层已打通大部分环节**，但缺 **专用机全矩阵实机证据** 与 **救援验收记录**。

---

## A. 目标流程与代码覆盖

| 步骤 | 要求 | 源码实现 | 审查 |
|------|------|----------|------|
| 1 | 登录后台 | Bearer + rpcd session | **OK** `httpd.uc` login |
| 2 | 裸流上传 /tmp | 64KiB 流式，无整包进 ucode | **OK** `firmware-job.uc` |
| 3 | 签名校验等 | `mp716-upgraded check` | **OK** |
| 4 | 返回 job_id | verify 响应 `job_id` | **OK**（**设备未热更则旧 httpd 无 job**） |
| 5 | 二次确认 | `UpgradeNativePage` 两按钮 | **OK**（**Web 未重新 build 部署则仍为单 POST**） |
| 6 | apply 再验签 | `reverify_job_image` | **OK** 仓库代码 |
| 7 | 异步 sysupgrade | `mp716-sysupgrade` setsid | **OK** |
| 8 | 重启等待 | `?wait=1` + prelogin 探测 | **OK** 前端仓库 |
| 9 | 成功才写安装时间 | `firmware-boot-confirm.uc` | **OK**（**设备 init 未验证已挂**） |
| 10 | 生产不靠 allow-flash | `upgrade-policy.uc` production 分支 | **OK** 仓库（**140 无此文件**） |

---

## B. 源码审查要点（非重新开发，是完善既有栈）

### B.1 后端

- **`upgrade-policy.uc`**：development / laboratory / production；production 仅 gate+platform。
- **`firmware-job.uc`**：容量、单任务、状态机大写、VERIFIED 后 apply。
- **`httpd.uc`**：v2 路由、policy 注入 `GET system/firmware`、apply 403 当未放行。
- **`mp716-sysupgrade`**：拒绝 `-F`；刷写前 mem/tmp 预检；子进程刷写非 CGI 内完成。
- **默认 TEST 包**：`upgrade-policy=development`，gate=closed（`openwrt-package/files`）。

### B.2 前端

- **`UpgradeNativePage.vue`**：先 verify 后 `applyFirmwareV2`；刷写后跳重启等待。
- **`device-adapter.ts`**：`jobId` 解析、`apply` 180s 超时、中断时「可能正在刷写」兜底。

### B.3 缺口（审查发现）

| # | 缺口 | 风险 |
|---|------|------|
| G1 | **实验室 140 未部署** `upgrade-policy.uc` / `firmware-job.uc` / 新 `httpd.uc` | 仍靠旧逻辑 + `allow-flash-upgrade` |
| G2 | **Vue 生产包未 rebuild/deploy** | UI 可能仍为单步刷写 |
| G3 | **RELEASE overlay 脚本未进 CI 默认路径** | 出厂镜像是 development |
| G4 | **1.0.11 flash_span 超 6.5MiB 目标**（6911494 > 6815744） | 余量偏紧，非硬顶失败 |
| G5 | **boot-confirm + 状态机**未在刷写专机回归 | 安装时间/成功语义未签核 |
| G6 | **量产 RELEASE 公钥**与线上 `upgrade.pub` 成套文档未闭环 | 误刷测试包风险 |

---

## C. 真实刷写与测试记录（实事求是）

### C.1 有证据

| 事件 | 结果 | 证据 |
|------|------|------|
| 网页刷写 1.0.10→1.0.11 | **成功** | 对话历史：140 WAN，`/etc/mp716-build.version=1.0.11`，uptime 重启 |
| 两阶段 sysupgrade 热修 | **成功** | `submitted`、约 2min 中断后恢复 |
| 宿主 pytest 容器/容量 | **17 passed** | `test_container` + capacity + production budget |
| 1.0.11 包生产硬顶 | **PASS** | container ≤8060928，span ≤7012352 |
| 1.0.11 包生产目标 | **WARN** | span > 6.5MiB 目标 |

### C.2 无证据（不能当作生产放行依据）

- 专用测试机 **保留配置 / 不保留配置 / 连续升级** 全矩阵  
- **超容量 / 错型号 / 坏签名 / 上传中断 / RAM 不足** 在 64MB 实机注入  
- **升级后** LAN/WAN/Wi-Fi/VPN/Overlay 自动化核对  
- **HTTP 断开后** 状态轮询与 `firmware-v2/status` 全路径  
- **生产策略**（无 allow-flash）仅用 gate 的 E2E  

### C.3 不得宣称

- ❌「BUILD OK = 可放开生产刷写」  
- ❌「实验室 140 可刷 = 出厂即可刷」  
- ❌「验签通过 = 升级验收通过」  

---

## D. 救援 / 串口验收

| 项 | 状态 |
|----|------|
| U-Boot + 原厂/RAM 救砖路径 | 文档存在，`release-hardware-closed-loop.md` |
| `mp716-open-production-gate.sh` 在**量产策略机**执行记录 | **无** |
| 刷写失败断电 / 半成品 flash 恢复演练 | **无** |
| `production-acceptance.md` 救砖行 | **未执行** |

**无救援验收记录前，不得写入 RELEASE 的 `production` policy + 打开 gate。**

---

## E. 实验室 140 当前状态（只读 2026-11-26）

```
upgrade-policy: 缺失（旧镜像）
flash-gate: closed
platform: unconfirmed
allow-flash-upgrade: 存在
firmware-job.uc / upgrade-policy.uc: 未部署
```

→ 140 属于 **实验室开关刷写**，**不是**生产放行形态。

---

## F. 放开生产刷写的签核条件（全部满足才可）

1. **专用测试机**完成 `production-acceptance.md` §固件升级 全表 **PASS**（附日志/版本/截图）。  
2. **串口救砖演练**记录 + 执行 gate 脚本（`upgrade-policy=production`，无 allow-flash）。  
3. **RELEASE** 镜像：`write-release-upgrade-policy-overlay.sh` + **RELEASE** `upgrade.pub`。  
4. **Web 包**部署两阶段 UI + 后端热更/进镜像。  
5. 至少一版 **flash_span ≤ 6.5MiB 目标**（或书面接受 WARN 风险）。  
6. 产品/质量 **书面批准** 打开生产刷写。

---

## G. 与「无需 SSH」目标的关系

- **用户使用**：满足 §F 后，**仅需 Web**（生产不依赖 SSH touch allow-flash）。  
- **出厂/维保**：仍建议保留 gate 脚本用于**首次**转 production 或返修，不等于每次升级要 SSH。  
- **当前**：因 G1/G2，即使 Web 能刷，仍依赖 **140 上 laboratory 式 allow-flash**，**不符合**你对生产形态的定义。

---

## H. 建议执行顺序（仍不自动刷在线生产设备）

1. 热更 + Web build 到 **专用测试机**（非在线量产线）。  
2. 按 §F 跑矩阵，回填 `production-acceptance.md`。  
3. 通过后再打 RELEASE 并只对**新出厂/已签核设备**写 production overlay。

**审计人**：本轮开发与审查会话（自动化+代码走读）；**非**第三方独立审计。

**签核**：□ 硬件  □ 固件  □ 测试  □ 产品 — 空白表示**未签**。