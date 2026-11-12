/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * 设备端固件校验 / 刷写入口（配合 cgi_stream.cgi streamid=4 或自研上传链）
 */
#include "mp716_device.h"
#include "mp716_image.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void read_mac(char *buf, size_t len)
{
	FILE *fp;
	char *nl;

	buf[0] = '\0';
	fp = fopen("/sys/class/net/br-lan/address", "r");
	if (!fp)
		fp = fopen("/sys/class/net/eth0/address", "r");
	if (!fp)
		return;
	if (!fgets(buf, len, fp)) {
		fclose(fp);
		return;
	}
	fclose(fp);
	nl = strchr(buf, '\n');
	if (nl)
		*nl = '\0';
}

static int read_file_line(const char *path, char *buf, size_t len)
{
	FILE *fp;
	char *nl;

	if (!buf || !len)
		return -1;
	buf[0] = '\0';
	fp = fopen(path, "r");
	if (!fp)
		return -1;
	if (!fgets(buf, len, fp)) {
		fclose(fp);
		return -1;
	}
	fclose(fp);
	nl = strchr(buf, '\n');
	if (nl)
		*nl = '\0';
	return 0;
}

static void cmd_device_info(void)
{
	char mac[32];
	char sw[32] = MP716_SOFTWARE_VERSION;
	char web[32] = MP716_WEBUI_VERSION;
	char wan_ip[64] = "";

	read_mac(mac, sizeof(mac));
	read_file_line("/etc/mp716/software_version", sw, sizeof(sw));
	read_file_line("/etc/mp716/webui_version", web, sizeof(web));
	read_file_line("/tmp/mp716-wan-ip", wan_ip, sizeof(wan_ip));

	printf(
		"{\"product_name\":\"%s\",\"product_model\":\"%s\","
		"\"software_version\":\"%s\",\"webui_version\":\"%s\","
		"\"lan_mac\":\"%s\",\"wan_ip\":\"%s\","
		"\"maxsize\":%u,\"maxsize_tip\":\"8M\"}\n",
		MP716_PRODUCT_NAME, MP716_PRODUCT_MODEL,
		sw, web,
		mac[0] ? mac : "00:00:00:00:00:00",
		wan_ip,
		MP716_FW_MAX_BYTES);
}

static int cmd_verify(const char *path)
{
	char err[256];
	enum mp716_img_kind kind;

	if (mp716_image_validate_file(path, err, sizeof(err), &kind)) {
		fprintf(stderr, "verify failed: %s\n", err);
		return 1;
	}
	printf("verify ok kind=%d %s\n", kind, err);
	return 0;
}

static int cmd_apply(const char *path, int force)
{
	(void)force;
	fprintf(stderr,
		"apply blocked: use factory cgi_stream streamid=4 + firmware_repack.py output only\n");
	fprintf(stderr, "mp716-fwd apply is disabled during vendor-format audit\n");
	return 3;
}

int main(int argc, char **argv)
{
	if (argc < 2) {
		fprintf(stderr,
			"usage: %s device-info|verify <bin>|apply <bin> [--force]\n", argv[0]);
		return 1;
	}

	if (!strcmp(argv[1], "device-info")) {
		cmd_device_info();
		return 0;
	}
	if (!strcmp(argv[1], "verify") && argc >= 3)
		return cmd_verify(argv[2]);
	if (!strcmp(argv[1], "apply") && argc >= 3) {
		int force = (argc >= 4 && !strcmp(argv[3], "--force"));
		return cmd_apply(argv[2], force);
	}

	fprintf(stderr, "unknown command\n");
	return 1;
}
