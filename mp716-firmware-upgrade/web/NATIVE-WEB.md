# MP716 Web 主源码与独立交付

本仓库 `openwrt_system` 是管理后台的主源码。页面、导航、表单和交互先在这里修复，再导出到固件仓库的 `mp716-firmware-upgrade/web/`。后者只是可核验的生成快照，不再维护第二套页面。

## 两种真实设备接口

原厂 014 使用既有 FactoryCgiAdapter，`npm run build:mp716-test`。原厂登录和 CGI 路径保持独立。

自研 OpenWrt 使用 DeviceRouterAdapter，`npm run build:openwrt`，产物位于 `dist-openwrt/`，管理入口 `/`（页面路由 `/#/`），静态资源保持 `/mp716/`，接口 `/cgi-bin/mp716/`。固件验签走现有原生验证器，页面只能上传并校验，不能通过此入口刷写。

## 1.0.7 整包与仅 Web

固件 **1.0.7** 将 OpenWrt 系统、驱动、Vue 静态资源、原生 ucode 与验签服务**一起打包**。本仓库是 Web **主源码**；构建时经 `mp716-firmware-upgrade/scripts/sync-web-reference.py` 导出快照并嵌入固件。

| 变更类型 | 交付方式 |
| --- | --- |
| 纯前端（页面、适配器、样式） | `npm run build:openwrt` → 实机热更 Web，或打 `package-native-web.py` ZIP；**不**恢复原厂页面 |
| 内核、驱动、`admin.uc` / 路由、验签策略 | 重编固件并 sysupgrade |

实验室设备已由原厂 014 迁至 1.0.7；「保留配置」保留 Wi‑Fi、管理地址与网络 UCI，**不是**保留原厂 OS。详见固件仓库 [mp716-device-runtime-state.md](../openwrt/mp716-firmware-upgrade/docs/mp716-device-runtime-state.md)。

Gitea **deploy-frontend.yml** 部署的是 `VITE_ROUTER_ADAPTER=factory` 的演示站，与嵌入 1.0.7 的 `openwrt` 构建不是同一条链路。

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

## 管理 IP 根入口

原生构建的 `.env.openwrt` 设置 `VITE_ROUTER_BASE=/`，不改变 `/cgi-bin/mp716/` 接口。部署时把构建产物的 `index.html` 同时安装为 `/www/index.html` 和 `/www/mp716/index.html`，资源仍放在 `/www/mp716/`。直接输入管理 IP 即可打开后台，旧 `/mp716/` 书签保持可用。生产原厂构建未设置此变量，继续使用原来的部署路径。

## feature/lp 设计基准（Web 0.2.1）

界面最初以本地 `feature/lp` 提交 `397021b5fdd2277680df1c44df6ace7ebb2d9ca7` 为参考，随后按用户要求合并 `hotfix/lp` 提交 `1441b0896c7624626186e0867cd2193d924cc654`。当前采用该 hotfix 的 62px 顶栏、最大 1400px 内容框架及独立滚动布局，保留标签上置、有边框输入和终端搜索/筛选/详情。合并后的原生后台继续按设备返回值展示网口；未知映射不从数组位置推断。

这是现有原生后台的设计适配，保留翻译、移动端、原生 DeviceRouterAdapter、配置应用确认/回滚、签名校验及管理 IP 根入口。没有回退到旧分支的原厂 CGI、虚构网口映射、限速或未接通的断开指令。网口角色未核验仍显示 P0–P4；速率为零时首页显示 0bps，累计字节不再替代实时速率。

Web 独立包只含页面资源；不会改变当前固件版本、Wi-Fi、WAN 或管理地址。主源码提交后仍须通过 `sync-web-reference.py` 导出固件快照；不能直接编辑生成目录。构建和本机隔离浏览器测试不等于设备端功能验收。

布局回归可在安装 Playwright Chromium 后运行：`npm run build:openwrt`，然后 `npm run test:ui:lp`。测试只绑定 127.0.0.1，浏览器禁止访问其他来源，原生接口由本机只读测试数据提供；测试不连接设备。默认截图与结果在忽略的 `releases/lp-ui-check/`，可通过 `MP716_WEB_CHECK_OUTPUT` 指定输出目录。
