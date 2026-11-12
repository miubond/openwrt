/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * EXPERIMENTAL — 非原厂网页升级格式，不得用于 streamid=4。
 * 正式路径：已审计 firmware_repack.py + repack-web-only.py。
 * 构建：MP716_EXPERIMENTAL_FWPACK=1 make package/mp716-firmware/host/compile
 */
#include "mp716_device.h"
#include "mp716_image.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

static int copy_stream(FILE *in, FILE *out)
{
	char buf[65536];
	size_t n;

	while ((n = fread(buf, 1, sizeof(buf), in)) > 0) {
		if (fwrite(buf, 1, n, out) != n)
			return -1;
	}
	return ferror(in) ? -1 : 0;
}

int main(int argc, char **argv)
{
	const char *in_path, *out_path, *sw, *web;
	FILE *in, *out;
	struct mp716_meta_tail tail;
	struct stat st;

	if (argc < 3) {
		fprintf(stderr,
			"usage: %s <input.bin> <output.bin> [sw_ver] [web_ver]\n", argv[0]);
		return 1;
	}

	in_path = argv[1];
	out_path = argv[2];
	sw = argc >= 4 ? argv[3] : MP716_SOFTWARE_VERSION;
	web = argc >= 5 ? argv[4] : MP716_WEBUI_VERSION;

	if (stat(in_path, &st) != 0) {
		perror(in_path);
		return 1;
	}
	if ((uint64_t)st.st_size + sizeof(tail) > MP716_FW_MAX_BYTES) {
		fprintf(stderr, "output would exceed %u bytes\n", MP716_FW_MAX_BYTES);
		return 1;
	}

	in = fopen(in_path, "rb");
	out = fopen(out_path, "wb");
	if (!in || !out) {
		perror("fopen");
		if (in)
			fclose(in);
		if (out)
			fclose(out);
		return 1;
	}

	if (copy_stream(in, out) != 0) {
		fprintf(stderr, "copy failed\n");
		fclose(in);
		fclose(out);
		return 1;
	}
	fclose(in);

	memset(&tail, 0, sizeof(tail));
	tail.magic = MP716_META_MAGIC;
	tail.meta_len = sizeof(tail);
	snprintf(tail.product_name, sizeof(tail.product_name), "%s", MP716_PRODUCT_NAME);
	snprintf(tail.product_model, sizeof(tail.product_model), "%s", MP716_PRODUCT_MODEL);
	snprintf(tail.software_version, sizeof(tail.software_version), "%s", sw);
	snprintf(tail.webui_version, sizeof(tail.webui_version), "%s", web);
	tail.image_size = (uint32_t)(st.st_size + sizeof(tail));
	tail.image_crc32 = mp716_crc32_file(in_path);

	if (fwrite(&tail, 1, sizeof(tail), out) != sizeof(tail)) {
		fprintf(stderr, "write tail failed\n");
		fclose(out);
		return 1;
	}
	fclose(out);

	printf("packed %s -> %s (sw=%s web=%s size=%u)\n",
	       in_path, out_path, sw, web, tail.image_size);
	return 0;
}
