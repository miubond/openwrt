/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef MP716_IMAGE_H
#define MP716_IMAGE_H

#include <stddef.h>
#include <stdint.h>

struct mp716_meta_tail {
	uint32_t magic;
	uint32_t meta_len;
	char product_name[16];
	char product_model[16];
	char software_version[16];
	char webui_version[16];
	uint32_t image_size;
	uint32_t image_crc32;
};

enum mp716_img_kind {
	MP716_IMG_UNKNOWN = 0,
	MP716_IMG_MP716_META,
	MP716_IMG_SQUASHFS,
	MP716_IMG_TRX,
};

int mp716_image_validate_file(const char *path, char *err, size_t errlen,
			      enum mp716_img_kind *kind_out);

uint32_t mp716_crc32_file(const char *path);

int mp716_meta_read_tail(const char *path, struct mp716_meta_tail *out);

#endif /* MP716_IMAGE_H */
