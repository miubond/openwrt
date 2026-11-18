# MP716 RAM 验签镜像

当前源代码已集成完整 Vue 管理后台和原生网络、无线、终端接口，详见 [1.0.2 后台集成与真机验证报告](../../docs/MP716-1.0.2-FULL-WEB.md)。`stage.py --web-dist` 安装当前构建的页面，同时部署 `admin.uc`、配置回滚模块与 `mp716-admin` 服务。下面保留原始 RAM 验签镜像的说明。

向 Gitea 推送 `codex/mp716-ram-web` 会触发 `MP716 RAM Web Verification`。工作流只生成 `mp716-initramfs-ram-web`，并检查产物的设备树和 initramfs 文件列表。

`web-input.zip` 取自 `mp716-web-verify-local.zip` 的设备版网页、CGI 启动脚本、上传校验脚本和测试公钥，补入新版 Web 工程的 rpcd ACL。`httpd.uc` 保留同一上传验签接口，通过 rpcd 会话验证登录。`mp716-upgraded` 从当前源代码交叉编译。已有 `test.mp716upd` 在浏览器中选择上传。

连接隔离的直连网线，从串口确认 U-Boot 的 RAM 加载和启动选项后启动镜像。在串口中执行 `grep 'yunxm,mp716' /proc/device-tree/compatible` 并确认 `/proc/mtd` 无设备，然后用 `passwd` 设置本次启动的临时密码。浏览器访问 `/mp716/#/advanced/system/upgrade`，使用 `admin` 和该临时密码登录。OpenWrt 默认 LAN 地址为 `192.168.1.1`，网口仍需在 MP716 上验证。校验成功的响应应包含 `signature_checked: true` 和 `flash_write: false`。
