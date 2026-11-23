# MP716 闭环状态（实验室）

更新：2026-11-23

## 已闭环

| 链路 | 说明 |
|------|------|
| 登录会话 | `auth/login` → Bearer → `session access` |
| 配置保存 | config-task 确认/撤销（各设置页） |
| 固件验签 | 上传 → `mp716-package-verify` → 报告 |
| 固件刷写（实验室门开） | 验签 → `mp716-sysupgrade apply` → 重启意图 |
| 首页 WAN 速率 | 二次采样 + 缓存命中仍刷新 `wan`；前端 `ratesReady=false` 显示「统计中」 |

烟测：`powershell -File scripts/verify-lab-closed-loop.ps1`

## 未闭环（发布前）

| 项 | 阻塞 |
|----|------|
| 量产刷机 | `flash-gate` + 正式签名包 + C1 E2E |
| RELEASE 验收 | `production-acceptance.md` 硬件/断电/串口恢复 |
| Bundle 能力 | 多 SSID、4G、部分 HYID 等价项 |

详细刷机口径：[factory-upgrade-closed-loop.md](./factory-upgrade-closed-loop.md)