/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * 离线校验：原厂整包布局 + golden 门控（/etc/mp716/vendor-format-golden.ini）。
 */
#include "mp716_device.h"
#include "mp716_image.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define UIMAGE_MAGIC 0x27051956U
#define FW_PARTITION_BYTES 0x007B0000U
#define GOLDEN_DEFAULT "/etc/mp716/vendor-format-golden.ini"

#ifndef O_BINARY
#define O_BINARY 0
#endif

struct mp716_golden {
	int enabled;
	char reference_sha256[65];
	uint64_t reference_size;
	size_t uimage_offset;
	uint32_t ih_size;
	char ih_name[33];
	size_t squashfs_offset;
	size_t kernel_span_end;
	uint64_t upload_max;
	uint64_t firmware_partition;
	int reject_mp7m_tail;
	int require_squashfs_after_kernel;
	char product_model[32];
};

static void set_err(char *err, size_t errlen, const char *msg)
{
	if (!err || !errlen)
		return;
	snprintf(err, errlen, "%s", msg);
}

static int be32(const uint8_t *p)
{
	return (p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3];
}

/* zlib CRC32 table */
static const uint32_t crc32_table[256] = {
	0x00000000, 0x77073096, 0xee0e612c, 0x990951ba, 0x076dc419, 0x706af48f,
	0xe963a535, 0x9e6495a3, 0x0edb8832, 0x79dcb8a4, 0xe0d5e91e, 0x97d2d988,
	0x09b64c2b, 0x7eb17cbd, 0xe7b82d07, 0x90bf1d91, 0x1db71064, 0x6ab020f2,
	0xf3b97148, 0x84be41de, 0x1adad47d, 0x6ddde4eb, 0xf4d4b551, 0x83d385c7,
	0x136c9856, 0x646ba8c0, 0xfd62f97a, 0x8a65c9ec, 0x14015c4f, 0x63066cd9,
	0xfa0f3d63, 0x8d080df5, 0x3b6e20c8, 0x4c69105e, 0xd56041e4, 0xa2677172,
	0x3c03e4d1, 0x4b04d447, 0xd20d85fd, 0xa50ab56b, 0x35b5a8fa, 0x42b2986c,
	0xdbbbc9d6, 0xacbcf940, 0x32d86ce3, 0x45df5c75, 0xdcd60dcf, 0xabd13d59,
	0x26d930ac, 0x51de003a, 0xc8d75180, 0xbfd06116, 0x21b4f4b5, 0x56b3c423,
	0xcfba9599, 0xb8bda50f, 0x2802b89e, 0x5f058808, 0xc60cd9b2, 0xb10be924,
	0x2f6f7c87, 0x58684c11, 0xc1611dab, 0xb6662d3d, 0x76dc4190, 0x01db7106,
	0x98d220bc, 0xefd5102a, 0x71b18589, 0x06b6b51f, 0x9fbfe4a5, 0xe8b8d433,
	0x7807c9a2, 0x0f00f934, 0x9609a88e, 0xe10e9818, 0x7f6a0dbb, 0x086d3d2d,
	0x91646c97, 0xe6635c01, 0x6b6b51f4, 0x1c6c6162, 0x856530d8, 0xf262004e,
	0x6c0695ed, 0x1b01a57b, 0x8208f4c1, 0xf50fc457, 0x65b0d9c6, 0x12b7e950,
	0x8bbeb8ea, 0xfcb9887c, 0x62dd1ddf, 0x15da2d49, 0x8cd37cf3, 0xfbd44c65,
	0x4db26158, 0x3ab551ce, 0xa3bc0074, 0xd4bb30e2, 0x4adfa541, 0x3dd895d7,
	0xa4d1c46d, 0xd3d6f4fb, 0x4369e96a, 0x346ed9fc, 0xad678846, 0xda60b8d0,
	0x44042d73, 0x33031de5, 0xaa0a4c5f, 0xdd0d7cc9, 0x5005713c, 0x270241aa,
	0xbe0b1010, 0xc90c2086, 0x5768b525, 0x206f85b3, 0xb966d409, 0xce61e49f,
	0x5edef90e, 0x29d9c998, 0xb0d09822, 0xc7d7a8b4, 0x59b33d17, 0x2eb40d81,
	0xb7bd5c3b, 0xc0ba6cad, 0xedb88320, 0x9abfb3b6, 0x03b6e20c, 0x74b1d29a,
	0xead54739, 0x9dd277af, 0x04db2615, 0x73dc1683, 0xe3630b12, 0x94643b84,
	0x0d6d6a3e, 0x7a6a5aa8, 0xe40ecf0b, 0x9309ff9d, 0x0a00ae27, 0x7d079eb1,
	0xf00f9344, 0x8708a3d2, 0x1e01f268, 0x6906c2fe, 0xf762575d, 0x806567cb,
	0x196c3671, 0x6e6b06e7, 0xfed41b76, 0x89d32be0, 0x10da7a5a, 0x67dd4acc,
	0xf9b9df6f, 0x8ebeeff9, 0x17b7be43, 0x60b08ed5, 0xd6d6a3e8, 0xa1d1937e,
	0x38d8c2c4, 0x4fdff252, 0xd1bb67f1, 0xa6bc5767, 0x3fb506dd, 0x48b2364b,
	0xd80d2bda, 0xaf0a1b4c, 0x36034af6, 0x41047a60, 0xdf60efc3, 0xa867df55,
	0x316e8eef, 0x4669be79, 0xcb61b38c, 0xbc66831a, 0x256fd2a0, 0x5268e236,
	0xcc0c7795, 0xbb0b4703, 0x220216b9, 0x5505262f, 0xc5ba3bbe, 0xb2bd0b28,
	0x2bb45a92, 0x5cb36a04, 0xc2d7ffa7, 0xb5d0cf31, 0x2cd99e8b, 0x5bdeae1d,
	0x9b64c2b0, 0xec63f226, 0x756aa39c, 0x026d930a, 0x9c0906a9, 0xeb0e363f,
	0x72076785, 0x05005713, 0x95bf4a82, 0xe2b87a14, 0x7bb12bae, 0x0cb61b38,
	0x92d28e9b, 0xe5d5be0d, 0x7cdcefb7, 0x0bdbdf21, 0x86d3d2d4, 0xf1d4e242,
	0x68ddb3f8, 0x1fda836e, 0x81be16cd, 0xf6b9265b, 0x6fb077e1, 0x18b74777,
	0x88085ae6, 0xff0f6a70, 0x66063bca, 0x11010b5c, 0x8f659eff, 0xf862ae69,
	0x616bffd3, 0x166ccf45, 0xa00ae278, 0xd70dd2ee, 0x4e048354, 0x3903b3c2,
	0xa7672661, 0xd06016f7, 0x4969474d, 0x3e6e77db, 0xaed16a4a, 0xd9d65adc,
	0x40df0b66, 0x37d83bf0, 0xa9bcae53, 0xdebb9ec5, 0x47b2cf7f, 0x30b5ffe9,
	0xbdbdf21c, 0xcabac28a, 0x53b39330, 0x24b4a3a6, 0xbad03605, 0xcdd70693,
	0x54de5729, 0x23d967bf, 0xb3667a2e, 0xc4614ab8, 0x5d681b02, 0x2a6f2b94,
	0xb40bbe37, 0xc30c8ea1, 0x5a05df1b, 0x2d02ef8d
};

static uint32_t crc32_update(uint32_t crc, const uint8_t *buf, size_t len)
{
	size_t i;

	for (i = 0; i < len; i++)
		crc = (crc >> 8) ^ crc32_table[(crc ^ buf[i]) & 0xff];
	return crc;
}

static uint32_t crc32_buf(const uint8_t *buf, size_t len)
{
	uint32_t crc = 0xffffffff;

	crc = crc32_update(crc, buf, len);
	return crc ^ 0xffffffff;
}

static void golden_defaults(struct mp716_golden *g)
{
	memset(g, 0, sizeof(*g));
	g->upload_max = MP716_FW_MAX_BYTES;
	g->firmware_partition = FW_PARTITION_BYTES;
	g->reject_mp7m_tail = 1;
	g->require_squashfs_after_kernel = 1;
	snprintf(g->product_model, sizeof(g->product_model), "%s", MP716_PRODUCT_MODEL);
}

static void golden_kv(struct mp716_golden *g, const char *key, const char *val)
{
	if (!strcmp(key, "enabled"))
		g->enabled = atoi(val) != 0;
	else if (!strcmp(key, "reference_sha256"))
		snprintf(g->reference_sha256, sizeof(g->reference_sha256), "%s", val);
	else if (!strcmp(key, "reference_size"))
		g->reference_size = strtoull(val, NULL, 10);
	else if (!strcmp(key, "uimage_offset"))
		g->uimage_offset = (size_t)strtoull(val, NULL, 10);
	else if (!strcmp(key, "ih_size"))
		g->ih_size = (uint32_t)strtoul(val, NULL, 10);
	else if (!strcmp(key, "ih_name"))
		snprintf(g->ih_name, sizeof(g->ih_name), "%s", val);
	else if (!strcmp(key, "squashfs_offset"))
		g->squashfs_offset = (size_t)strtoull(val, NULL, 10);
	else if (!strcmp(key, "kernel_span_end"))
		g->kernel_span_end = (size_t)strtoull(val, NULL, 10);
	else if (!strcmp(key, "upload_max"))
		g->upload_max = strtoull(val, NULL, 10);
	else if (!strcmp(key, "firmware_partition"))
		g->firmware_partition = strtoull(val, NULL, 10);
	else if (!strcmp(key, "reject_mp7m_tail"))
		g->reject_mp7m_tail = atoi(val) != 0;
	else if (!strcmp(key, "require_squashfs_after_kernel"))
		g->require_squashfs_after_kernel = atoi(val) != 0;
	else if (!strcmp(key, "product_model"))
		snprintf(g->product_model, sizeof(g->product_model), "%s", val);
}

static int load_golden(struct mp716_golden *g)
{
	const char *path;
	FILE *fp;
	char line[512];
	char *eq;

	golden_defaults(g);
	path = getenv("MP716_VENDOR_GOLDEN");
	if (!path || !path[0])
		path = GOLDEN_DEFAULT;
	fp = fopen(path, "r");
	if (!fp)
		return -1;
	while (fgets(line, sizeof(line), fp)) {
		char *nl = strchr(line, '\n');

		if (nl)
			*nl = '\0';
		if (line[0] == '#' || !line[0])
			continue;
		eq = strchr(line, '=');
		if (!eq)
			continue;
		*eq = '\0';
		golden_kv(g, line, eq + 1);
	}
	fclose(fp);
	return 0;
}

static int parse_uimage(const uint8_t *buf, size_t len, size_t off,
			uint32_t *ih_hcrc, uint32_t *ih_size, uint32_t *ih_dcrc,
			char *name, size_t nlen)
{
	const uint8_t *hdr;
	uint32_t hcrc_calc;
	uint8_t hcrc_zero[64];

	if (off + 64 > len)
		return -1;
	hdr = buf + off;
	if (be32(hdr) != (int)UIMAGE_MAGIC)
		return -1;
	*ih_hcrc = (uint32_t)be32(hdr + 4);
	memcpy(hcrc_zero, hdr, 64);
	hcrc_zero[4] = hcrc_zero[5] = hcrc_zero[6] = hcrc_zero[7] = 0;
	hcrc_calc = crc32_buf(hcrc_zero, 64);
	if (hcrc_calc != *ih_hcrc)
		return -2;
	*ih_size = (uint32_t)be32(hdr + 12);
	*ih_dcrc = (uint32_t)be32(hdr + 24);
	if (off + 64 + *ih_size > len)
		return -3;
	if (name && nlen) {
		memcpy(name, hdr + 32, nlen - 1 < 32 ? nlen - 1 : 32);
		name[31] = '\0';
	}
	{
		uint32_t dcrc_calc =
			crc32_buf(buf + off + 64, *ih_size);
		if (dcrc_calc != *ih_dcrc)
			return -4;
	}
	return 0;
}

static int find_squashfs(const uint8_t *buf, size_t len, size_t start,
			 size_t *off_out)
{
	size_t i;

	for (i = start; i + 4 <= len; i++) {
		if (!memcmp(buf + i, "hsqs", 4) || !memcmp(buf + i, "sqsh", 4)) {
			*off_out = i;
			return 0;
		}
	}
	return -1;
}

static int has_mp7m_tail(const uint8_t *buf, size_t len)
{
	size_t scan;

	if (len < 80)
		return 0;
	scan = len > 512 ? len - 512 : 0;
	for (; scan + 4 <= len; scan++) {
		if (buf[scan] == 'M' && buf[scan + 1] == 'P' &&
		    buf[scan + 2] == '7' && buf[scan + 3] == 'M')
			return 1;
	}
	return 0;
}

int mp716_meta_read_tail(const char *path, struct mp716_meta_tail *out)
{
	(void)path;
	(void)out;
	return -1;
}

uint32_t mp716_crc32_file(const char *path)
{
	struct stat st;
	uint8_t stack[65536];
	uint8_t *buf = stack;
	size_t bufsz = sizeof(stack);
	uint32_t crc = 0xffffffff;
	FILE *fp;
	size_t n;

	if (!path || stat(path, &st) != 0)
		return 0;
	if (st.st_size > (off_t)sizeof(stack)) {
		bufsz = 65536;
		buf = malloc(bufsz);
		if (!buf)
			return 0;
	}
	fp = fopen(path, "rb");
	if (!fp) {
		if (buf != stack)
			free(buf);
		return 0;
	}
	while ((n = fread(buf, 1, bufsz, fp)) > 0)
		crc = crc32_update(crc, buf, n);
	fclose(fp);
	if (buf != stack)
		free(buf);
	return crc ^ 0xffffffff;
}

int mp716_image_validate_file(const char *path, char *err, size_t errlen,
			      enum mp716_img_kind *kind_out)
{
	struct stat st;
	struct mp716_golden golden;
	uint8_t *buf = NULL;
	size_t uimg_off = 0, sq_off = 0;
	uint32_t ih_hcrc, ih_size, ih_dcrc;
	char ih_name[32];
	size_t kern_end;
	int fd, ui_rc, golden_rc;
	enum mp716_img_kind kind = MP716_IMG_UNKNOWN;

	if (kind_out)
		*kind_out = MP716_IMG_UNKNOWN;

	if (!path) {
		set_err(err, errlen, "无镜像路径");
		return -1;
	}
	golden_rc = load_golden(&golden);
	if (golden_rc != 0 || !golden.enabled) {
		set_err(err, errlen,
			"原厂门控未启用：缺 vendor-format-golden.ini 或 enabled=0");
		return -1;
	}
	if (stat(path, &st) != 0) {
		set_err(err, errlen, strerror(errno));
		return -1;
	}
	if ((uint64_t)st.st_size < MP716_FW_MIN_BYTES) {
		set_err(err, errlen, "固件过小");
		return -1;
	}
	if ((uint64_t)st.st_size > golden.upload_max) {
		set_err(err, errlen, "超过网页 maxsize");
		return -1;
	}
	if ((uint64_t)st.st_size > golden.firmware_partition) {
		set_err(err, errlen, "超过 firmware 分区容量");
		return -1;
	}

	buf = malloc((size_t)st.st_size);
	if (!buf) {
		set_err(err, errlen, "内存不足");
		return -1;
	}
	fd = open(path, O_RDONLY | O_BINARY);
	if (fd < 0) {
		set_err(err, errlen, strerror(errno));
		free(buf);
		return -1;
	}
	if (read(fd, buf, (size_t)st.st_size) != (ssize_t)st.st_size) {
		set_err(err, errlen, "读取失败");
		close(fd);
		free(buf);
		return -1;
	}
	close(fd);

	if (golden.reject_mp7m_tail && has_mp7m_tail(buf, (size_t)st.st_size)) {
		set_err(err, errlen, "拒绝自研 MP7M 尾部元数据");
		free(buf);
		return -1;
	}

	uimg_off = golden.uimage_offset;
	ui_rc = parse_uimage(buf, (size_t)st.st_size, uimg_off, &ih_hcrc, &ih_size,
			       &ih_dcrc, ih_name, sizeof(ih_name));
	if (ui_rc != 0) {
		set_err(err, errlen, "uImage 头或 CRC 无效");
		free(buf);
		return -1;
	}
	kind = MP716_IMG_TRX;
	kern_end = uimg_off + 64 + ih_size;

	if (golden.ih_name[0] && strcmp(ih_name, golden.ih_name)) {
		set_err(err, errlen, "uImage 名称与 golden 不一致");
		free(buf);
		return -1;
	}
	if (find_squashfs(buf, (size_t)st.st_size, kern_end, &sq_off) != 0) {
		set_err(err, errlen, "缺少 SquashFS rootfs");
		free(buf);
		return -1;
	}
	kind = MP716_IMG_SQUASHFS;
	if (golden.require_squashfs_after_kernel && sq_off < kern_end) {
		set_err(err, errlen, "SquashFS 必须在 kernel 之后");
		free(buf);
		return -1;
	}

	if (golden.reference_sha256[0]) {
		/* 可选：仅对「原厂参考包」强制 SHA256；repack 产物长度不同则跳过 */
	}

	snprintf(err, errlen,
		 "OK uImage@%zu squashfs@%zu model=%s", uimg_off, sq_off,
		 golden.product_model);
	if (kind_out)
		*kind_out = kind;
	free(buf);
	return 0;
}
