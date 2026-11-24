# Wi‑Fi MAC 过滤把自己锁在外面 — 恢复步骤

## 原因

**Wi‑Fi → 黑白名单** 选 **允许（白名单）** 且名单里**没有当前手机/电脑的无线网卡 MAC**，或确认应用后把本机 MAC 删掉，hostapd 会拒绝关联，管理页和 Wi‑Fi 都会断。

有线 LAN（`br-lan`）通常仍可访问 `192.168.199.1` 和 SSH（除非还改了「在线终端 → 访问控制」禁止本机 MAC）。

## 最快恢复（有网线）

1. 电脑 **网线插路由器 LAN**，网卡设为 DHCP，确认能 ping `192.168.199.1`。
2. SSH（PuTTY / `plink`）登录 **root**：

```sh
# 查主 AP 接口名（不是 mp716_guest）
uci show wireless | grep -E 'wifi-iface|macfilter|maclist'

# 常见为 default_radio0 或 ra0，下面用变量：
IF=$(uci show wireless | grep "=wifi-iface" | grep -v mp716_guest | head -1 | cut -d. -f2 | cut -d= -f1)

# 勿 set macfilter=disable（OpenWrt wifi-scripts 会拒绝，导致整机无 Wi‑Fi 信号）
uci -q delete wireless."$IF".macfilter
uci -q delete wireless."$IF".maclist
uci commit wireless
wifi reload
```

3. 浏览器打开 `http://192.168.199.1`，在 **Wi‑Fi → 黑白名单** 改回 **关闭** 或把自己 MAC 加进白名单。

## 若还禁了「终端访问控制」（nft）

```sh
echo '[]' > /tmp/mp716-admin/access.json
/usr/sbin/nft delete table inet mp716_access 2>/dev/null || true
```

## 仍无法进设备

- **定时回滚**：若改 ACL 后 **90 秒内未点确认** 且仍在倒计时，可等自动回滚（需当时仍有一条管理连接维持会话，不总是可行）。
- **恢复出厂**（会清配置）：长按 Reset 或串口，按量产文档操作。

## 预防（1.0.7+ 热更后）

保存白名单时，后端会自动把**当前管理会话终端 MAC** 加入名单（若尚未包含），避免再次把自己挡在网外。