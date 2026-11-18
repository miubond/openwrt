# MP716 Web 主源码与独立交付

本仓库 `openwrt_system` 是管理后台的主源码。页面、导航、表单和交互先在这里修复，再导出到固件仓库的 `mp716-firmware-upgrade/web/`。后者只是可核验的生成快照，不再维护第二套页面。

## 两种真实设备接口

原厂 014 使用既有 FactoryCgiAdapter，`npm run build:mp716-test`。原厂登录和 CGI 路径保持独立。

自研 OpenWrt 使用 DeviceRouterAdapter，`npm run build:openwrt`，产物位于 `dist-openwrt/`，访问路径 `/mp716/`，接口 `/cgi-bin/mp716/`。固件验签走现有原生验证器，页面只能上传并校验，不能通过此入口刷写。

## 仅更新页面

1. 修改本项目并运行 `npm test`、`npm run build:openwrt`。
2. 提交本项目，记录完整提交号。
3. 运行 `python scripts/package-native-web.py --build-commit <本项目提交号>`，输出 `releases/web/mp716-web-<Web版本>-<提交号>.zip` 及 SHA256。
4. 在固件仓库运行 `python scripts/sync-web-reference.py --source D:\goweb\src\openwrt_system`，核对 `frontend-source.json`。
5. GitHub 的 MP716 Web Package 工作流只构建前端并输出独立 ZIP；不会编译内核、调用 SSH、上传路由器或触发刷机。固件工作流忽略仅修改生成 Web 快照的提交，手动编译固件时仍包含该快照。

Web 包内只有静态资源、文件大小、SHA256、源提交和接口契约，固件版本与 Web 版本分别维护。Web 包不是 `.mp716upd`，不能传到固件升级入口。

## 兼容性限制

界面存在不代表设备已安装对应服务。独立包清单列出其要求的真实 API。部署前必须用设备的接口能力响应检查全部必需路由：

```
python scripts/package-native-web.py --verify <Web ZIP> --capabilities <设备能力 JSON>
```

旧设备没有能力响应、API 版本不匹配或缺少路由时，先停止替换后台并补齐设备服务。不能通过移除清单中的路由、伪造连接成功或隐藏整个页面来当作功能已经实现。

2026-11-18：Web 0.2.0 已补齐原生系统、VPN、诊断及真实配置任务阶段的页面契约，并保留 Factory 模式。主前端回归结果以对应提交的 CI 报告为准。对应的完整固件候选版本为 1.0.5；旧 1.0.4 不含这些新服务。接口回归、服务就绪和 VPN 隧道互通是不同验证层级，未验收的硬件/隧道不得标为成功。产物保持 UNVERIFIED；生产更新须先核对设备依赖与接口能力。
