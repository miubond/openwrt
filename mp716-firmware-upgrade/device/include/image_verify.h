#ifndef MP716_IMAGE_VERIFY_H
#define MP716_IMAGE_VERIFY_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

#include "system_info.h"

struct mp716_manifest {
	int allow_downgrade;
	char base_firmware[16];
	char build_time[32];
	char custom_firmware[24];
	char firmware_version[24];
	char hardware_revision[40];
	char image_type[32];
	char payload_sha256[65];
	uint32_t payload_size;
	char product[16];
	char signing_key_id[17];
	char upgrade_engine[24];
	char web_ui[24];
};

uint32_t mp716_crc32(const uint8_t *data, size_t len);
uint32_t mp716_crc32_begin(void);
void mp716_crc32_feed(uint32_t *crc, const uint8_t *data, size_t len);
uint32_t mp716_crc32_end(uint32_t crc);

int mp716_manifest_parse(const uint8_t *raw, uint32_t len, struct mp716_manifest *out, char *detail, size_t detail_len);
int mp716_verify_image(const char *image_path, const char *pubkey_path, const struct mp716_profile *profile,
		       const char *meminfo_path, int require_memory, int operator_allow_downgrade,
		       struct mp716_report *report);
int mp716_verify_image_to(const char *image_path, const char *pubkey_path, const struct mp716_profile *profile,
			  const char *meminfo_path, int require_memory, int operator_allow_downgrade,
			  FILE *payload_out, struct mp716_report *report);

#endif
