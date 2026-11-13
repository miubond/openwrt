# 阶段验收

| 阶段 | 本仓库状态 |
|---|---|
| V0.1 独立仓库与格式审计 | 仓库和容器规范已建立。原厂 BIN 缺失，哈希审计为 BLOCKED |
| V0.2 打包与签名 | `mp716-fwpack` / `mp716-fwverify` 已实现，Python 测试覆盖坏签名、篡改、截断、降级和占位修订 |
| V0.3 C 校验器 | 主机 Clang 构建通过。Python 签名的容器可以被 C 验签；只读命令是 `check` |
| V0.4 Fake MTD 与状态机 | 擦除、按位与、掉电、IO 错误、容量和路径拒绝有测试。掉电后保持 FAILED，操作者用离线副本执行 `recover` 后才回到 IDLE。上传和恢复都不会变成 SUCCESS |
| V0.5 CGI 与 Vue | CGI 契约和适配器已写。原厂会话不能安全复用，默认拒绝。CGI 没有恢复入口。未做浏览器联调 |
| V0.6 原厂集成镜像 | 只提供 rootfs 文件和 OpenWrt 包骨架。没有原厂 BIN，不能生成候选 BIN |
| V0.7 实机只读与恢复演练 | 未做 |
| V1.0 首次安全安装 | 未授权，未做 |
| V1.1 正式升级验收 | 未做。`allow-flash-upgrade` 保持拒绝 |

第一阶段门禁是：独立生成 `.mp716upd`、验证签名、模拟写入、模拟失败后的人工恢复。四项都通过之后，才安排测试机安装。串口恢复和 A/B 分区都还没有验证，所以这一门禁通过也不表示设备会自动回滚。

本地测试日志是 `reports/local-test-log.txt`。重新执行：

```text
python scripts/build_host.py
python tests/run_all.py
```
