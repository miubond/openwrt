# MP716 rpcd / ubus 试验路径（Phase 3）

目标：在**不改变 RouterAPI URL** 的前提下，在设备上对比「CGI 每请求 fork」与「rpcd 常驻 + uhttpd-mod-ubus」的单请求延迟。

## 文件

| 文件 | 作用 |
|------|------|
| `rpcd-native-readonly.uc` | `ping`、`native_system_info`、`native_wireless_config` 三个只读方法 |
| `/usr/share/rpcd/acl.d/mp716.json` | 固件镜像内已有；会话须带 `ubus_rpc_session` |

## 安装（RAM / 测试机）

```sh
cp /usr/share/mp716/experiment/rpcd-native-readonly.uc /usr/libexec/rpcd/mp716-native-readonly.uc
# 若使用 rpcd-mod-ucode 插件路径，按目标 OpenWrt 文档 symlink 到 ucode 插件目录
/etc/init.d/rpcd restart
```

## uhttpd 接入

在 `/etc/config/uhttpd` 启用 ubus（勿对外网暴露且无鉴权）：

```sh
uci set uhttpd.main.ubus_prefix='/ubus'
uci set uhttpd.main.ubus_timeout='30'
uci commit uhttpd
/etc/init.d/uhttpd restart
```

调用示例（须有有效会话 id）：

```sh
TOKEN='<32-hex>'
ubus call mp716-native-readonly native_system_info "{\"ubus_rpc_session\":\"$TOKEN\"}"
```

HTTP（uhttpd-mod-ubus）形态因版本而异，一般用：

`POST /ubus/?_=<nonce>` + JSON-RPC；**必须**走与 LuCI 相同的 session cookie / token，禁止匿名调用。

## 性能对比脚本

见 `scripts/benchmark-rpcd-vs-cgi.sh`（SSH 到设备，对 `system/info` 与 `wireless/config` 各打 N 次）。

## 安全

- 试验对象**仅**挂载只读 `route_admin` GET。
- 写操作、VPN 确认/回滚、固件刷写**不得**经试验 ubus 暴露。
- 全量迁移前须扩展 ACL 与 `session access` 审计，不能绕过 mp716 权限对象。