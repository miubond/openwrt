#ifndef MP716_SYSTEM_INFO_H
#define MP716_SYSTEM_INFO_H

#include <stdio.h>
#include <stdint.h>

struct mp716_profile {
	char product[16];
	char hardware_revision[40];
	char base_firmware[16];
	char vendor_software_version[16];
	char installed_custom_firmware[24];
	char web_ui[24];
	char upgrade_engine[24];
};

struct mp716_report {
	int code;
	char command[24];
	char error[32];
	char detail[180];
	char state[32];
	char product[16];
	char hardware_revision[40];
	char firmware_version[24];
	char base_firmware[16];
	char custom_firmware[24];
	char vendor_software_version[16];
	char web_ui[24];
	char upgrade_engine[24];
	char payload_sha256[65];
	char uimage_name[33];
	uint32_t payload_size;
	uint32_t squashfs_offset;
	uint32_t lzma_dictionary;
	uint32_t bytes_programmed;
	int historical_offset_match;
	int memory_checked;
	int signature_checked;
	int unrecoverable;
	int erased;
	int fake_mtd;
	int upgraded;
	int custom_firmware_installed;
	int memory_available_kib;
	int task_code;
	int accepted;
};

const char *mp716_error_name(int code);
void mp716_report_init(struct mp716_report *report, const char *command);
void mp716_report_fail(struct mp716_report *report, int code, const char *detail);
void mp716_report_write_json(FILE *fp, const struct mp716_report *report);
int mp716_http_status(int code);

int mp716_profile_load(const char *path, struct mp716_profile *profile, char *detail, size_t detail_len);
int mp716_meminfo_available_kib(const char *path, int *out_kib, char *detail, size_t detail_len);
int mp716_memory_allows(int available_kib, uint32_t payload_size, const char *phase);
int mp716_semver_parse(const char *text, int out[3]);

int mp716_runtime_is_ram(const char *path, int host_build, const char *host_root);

#endif
