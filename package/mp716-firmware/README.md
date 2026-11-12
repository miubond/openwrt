# mp716-firmware

MP716（YUNXM / MT7628）固件 **离线校验** 与设备信息；**原厂刷写仅** `cgi_stream.cgi?streamid=4` + 已审计 `firmware_repack.py` 产出。

审计阶段（2026-11-12）：见 `openwrt_system/firmware/reports/firmware-image-validation.md`。

## 设备信息（默认）

| 字段 | 值 |
|------|-----|
| product_name / product_model | MP716 |
| software_version | 014 |
| webui_version | WEB014 |
| maxsize | 8060928 (8M) |

## 设备端

```sh
mp716-fwd device-info          # JSON
mp716-fwd verify /tmp/fw.bin   # 原厂门控未全开时预期失败
mp716-fwd apply /tmp/fw.bin    # 审计期恒拒绝（不用作生产刷写）
```

`/etc/mp716/allow-flash-upgrade` **保持不存在**；自研 `mp716-upload-handler` 不得替代原厂 streamid=4。

## 主机端 mp716-fwpack（EXPERIMENTAL）

默认 **不构建**。仅实验：

```sh
MP716_EXPERIMENTAL_FWPACK=1 make package/mp716-firmware/compile V=s
```

**不得**用 fwpack 尾部包走原厂网页升级。正式路径：`firmware_repack.py` + `repack-web-only.py`。

## 报告

- `vendor-firmware-format.md`
- `vendor-upgrade-chain.md`
- `mp716-fwpack-compatibility.md`
- `firmware-image-validation.md`
