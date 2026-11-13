# 从原厂 014 迁到自研 V015

首次迁移包和以后的 sysupgrade 包是两种文件。当前两种都没有生成。

## 首次迁移

原厂 014 的网页升级入口是 `cgi_stream.cgi?streamid=4`，随后执行 `huayi-reset upgrade`。它不接受 OpenWrt 25.12.6 的 sysupgrade 镜像，也不接受把 `factory-mtd-from-device.bin` 重新封起来的文件。

首次安装要单独设计，并且只在这些条件都有记录之后才能做：

- 原厂升级包和分区副本的封装差异已经对照完
- `huayi-reset` 与设备上的 `platform.sh` 已经只读入库
- 串口可以把原厂 014 刷回并启动
- 镜像标记为 TEST，不标记为 RELEASE

这份首次包不写 Bootloader、Config 和 Factory。它也不能由 MT7628 EVB 的 BIN 改名得到。

## V015 之后

设备已经跑在自研系统上之后，后续版本才走官方 `sysupgrade`。命令不带 `-F`。未显式要求保留配置时使用 `-n`。写入目标只限 `firmware`。`rootfs_data` 在这个分区内部，不能把整份旧分区副本当作新镜像。

V015 到 V016 的自动编译、签名和发布流水线现在只允许产出 TEST。生产验收通过之前，流水线不能把同一文件标成 RELEASE。
