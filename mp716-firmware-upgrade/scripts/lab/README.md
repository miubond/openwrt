# 实验室脚本（非生产运维）

仅研发/专用机使用，**不要**在对客生产路由器默认执行。

| 脚本 | 用途 |
|------|------|
| `run-lab-flash-acceptance-v2.ps1` | 两阶段验签/刷写自动化（须 `CONFIRM_LAB_FLASH=YES`） |
| `build-pack-acceptance-windows.ps1` | 无 Linux 时 repack/门禁 pytest |
| `verify-lab-closed-loop.ps1` | 实验室策略烟测 |

生产部署与正式包上传验收：`scripts/deploy-admin.ps1`、`scripts/verify-production-closed-loop.ps1`。