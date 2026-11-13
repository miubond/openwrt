# 升级 API

CGI 文件是 `/www/cgi-bin/mp716-upgrade.cgi`。Chaos Calmer 的 lighttpd 1.4 可以给 CGI 脚本提供 `PATH_INFO`。正式路径因此写成：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/cgi-bin/mp716-upgrade.cgi/info` | 读取原厂版本和自研版本 |
| POST | `/cgi-bin/mp716-upgrade.cgi/upload` | 流式保存容器 |
| POST | `/cgi-bin/mp716-upgrade.cgi/verify` | 二次校验 |
| POST | `/cgi-bin/mp716-upgrade.cgi/start` | 请求执行 |
| GET | `/cgi-bin/mp716-upgrade.cgi/status` | 任务状态 |
| GET | `/cgi-bin/mp716-upgrade.cgi/history` | 记录 |

`QUERY_STRING` 只允许一个 `op`。出现 `mtd`、`path`、`partition` 或其他键时返回 `path`，CGI 不使用这些值。

上传的 `Content-Type` 必须是 `application/octet-stream`。文件名不参与存储，落点固定为 `/tmp/mp716-upgrade/incoming.mp716upd`。容器上限是头、8 KiB Manifest、8,060,928 字节 Payload 和 64 字节签名。

POST 还要带 `X-MP716-Upgrade: 1`。没有这个头的浏览器表单提交会被 CSRF 检查拒绝。

## 认证兼容性

原厂登录是 `cgi_huayi.cgi` HYID 5。成功只靠 Set-Cookie，响应里没有 token。静态资料没有确认 Cookie 名，也没有确认服务端会话存在哪里。

因此本 CGI 不能把“带了某个 Cookie”或“前端传来了用户名”当成管理员。默认 `auth.mode` 是 `deny`，所有接口返回 `auth_unavailable`。生产二进制即使把模式改成 `test` 也不会打开测试会话；`test` 只存在于 `-DMP716_HOST`。

在确认原厂会话的服务端校验方法之前，不使用固定口令，也不做无认证 CGI。

## 地址

`REMOTE_ADDR` 必须是环回、10/8、172.16/12 或 192.168/16。公网地址返回 `forbidden`。这不能代替认证。

## 状态

上传成功的状态是 `UPLOADING`，`upgraded` 为 false。校验成功是 `READY`。`start` 被接受时 `accepted` 为 true，仍然不是成功。只有重启后的 `boot-verify` 发现运行中的 `installed_custom_firmware` 与待升级版本一致，状态才是 `SUCCESS`。

`info` 里的 `custom_firmware_installed` 只反映配置文件。Fake MTD 写完不会改这份配置。

没有恢复接口。人工恢复是升级程序的 `recover` 命令，只接受 Fake MTD 和一份分区大小的离线副本。把它放进 HTTP 会让浏览器成为擦写入口，因此 CGI 不提供这个操作。

Vue 侧适配器在 `integration/web-api/firmwareUpgradeAdapter.js`。它只发请求和解释状态，不包含打包、验签或擦写。
