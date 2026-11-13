# 原厂 014 的升级入口

本地只读样本是 `openwrt_system/firmware/staging/factory-www-reference/cgi-bin/` 里的两份 CGI。设备上的 `/sbin/sysupgrade`、`/lib/upgrade/common.sh`、`/lib/upgrade/platform.sh` 和 `upgrade_sys.sh` 还没有复制到工程里。下面关于板卡名的结论来自实机观察，脚本正文还没有在本机复核。

## 身份不能混用

| 来源 | 值 | 用途 |
|---|---|---|
| Web | 产品 ZC-AP，型号 MP716，版本 014 | 对用户和管理包使用的身份 |
| uImage | 名称 `ZC-AP` | 当前 firmware 分区内核名 |
| 系统板卡 | `MT7628` | 芯片级板卡名 |
| 系统型号 | `mtk-apsoc-demo` | 通用开发板名，不能当作 MP716 |

V015 的包身份只接受产品 `MP716`。硬件修订写成 `MT7628` 或 `mtk-apsoc-demo` 会被打包器和设备校验器拒绝。只因为 magic 是 `27051956`、板卡名是 `MT7628`，不能判为兼容镜像。

## Web 怎样进入升级

`cgi_huayi.cgi` 的 SHA-256 是 `aa495f2ec2a247ae5d25fde20e84212e7999e6c135db46d0689c6ce1cc5f9e2a`，146151 字节。它提供 `MP716`、`pro_model`、`fw_version`、`webui_version`、`maxsize`，并调用 `upgrade_sys.sh check`、`upgrade_sys.sh cpe`、`upgrade_sys.sh modem`。字符串里没有 `huayi-reset upgrade`。

`cgi_stream.cgi` 的 SHA-256 是 `8102f1721c5c2993dcaf5f39db5e6bfa19b8f647d84ed7c3d9899ce8201e0322`，29943 字节。固件上传是 `streamid=4`：

- `keep_setting=1` 时执行 `huayi_cmd set system upgrade_keep_setting 1`
- `keep_setting=0` 时执行 `huayi_cmd set system upgrade_keep_setting 0`
- 型号相关字符串是 `uci -q -c %s get system.upgrade.check_model`、`product_model`、`upgrade_no_check`
- 备份命令是 `sysupgrade --create-backup /tmp/backup`
- 上传文件落到 `/tmp/firmware.img`
- 刷写命令是 `huayi-reset upgrade`

CGI 明文里没有 `sysupgrade` 直接写 Flash，也没有 uImage magic。真正的长度、CRC 和型号算法还在 `huayi-reset`、`upgrade_sys.sh` 或相关库里。这三份程序尚未入库，所以还不能定 V015 的生产封包。

`streamid=4` 不能拿来试传镜像。

## 分区副本不能整块当成新固件

当前分区副本长 `0x7B0000`。uImage 头 64 字节加内核 1235785 字节等于 `0x12DB89`，SquashFS 从这里开始。`0x7B0000 - 0x682477` 也等于 `0x12DB89`。`0x680000` 处是 JFFS2 标记，属于 firmware 分区内部的 `rootfs_data`。

新镜像只能包含新的内核和只读根文件系统。把这份分区副本整块复制后覆盖，会把当前可写配置一起写进去。
