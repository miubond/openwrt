/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * MP716 设备标识与升级策略（与 Web HYID 45 / 22 字段对齐）
 */
#ifndef MP716_DEVICE_H
#define MP716_DEVICE_H

#define MP716_PRODUCT_NAME	"MP716"
#define MP716_PRODUCT_MODEL	"MP716"

/* 与当前实机「设备信息」一致；新镜像构建后由 fwpack / release 脚本覆写 */
#define MP716_SOFTWARE_VERSION	"014"
#define MP716_WEBUI_VERSION	"WEB014"

/* 原厂 get_upgrade_info.maxsize */
#define MP716_FW_MAX_BYTES	8060928U
#define MP716_FW_MIN_BYTES	(64U * 1024U)

/* 自研整包尾部元数据魔数 "MP7M" */
#define MP716_META_MAGIC	0x4d37504dU

#define MP716_DEVICE_JSON	"/etc/mp716/device.json"
#define MP716_UPGRADE_JSON	"/etc/mp716/upgrade.json"
#define MP716_ALLOW_FLASH	"/etc/mp716/allow-flash-upgrade"

#endif /* MP716_DEVICE_H */
