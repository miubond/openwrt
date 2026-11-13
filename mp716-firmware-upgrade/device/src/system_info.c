#define _CRT_SECURE_NO_WARNINGS

#include "system_info.h"

#include "error_codes.h"
#include "mp716_format.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const char *mp716_error_name(int code)
{
	switch (code) {
	case MP716_OK: return "ok";
	case MP716_ERR_USAGE: return "usage";
	case MP716_ERR_IO: return "io";
	case MP716_ERR_FORMAT: return "format";
	case MP716_ERR_MAGIC: return "magic";
	case MP716_ERR_VERSION: return "version";
	case MP716_ERR_SIZE: return "size";
	case MP716_ERR_OVERFLOW: return "overflow";
	case MP716_ERR_MANIFEST: return "manifest";
	case MP716_ERR_HASH: return "hash";
	case MP716_ERR_SIGNATURE: return "signature";
	case MP716_ERR_PRODUCT: return "product";
	case MP716_ERR_HW_REVISION: return "hw_revision";
	case MP716_ERR_BASE_FIRMWARE: return "base_firmware";
	case MP716_ERR_DOWNGRADE: return "downgrade";
	case MP716_ERR_UIMAGE: return "uimage";
	case MP716_ERR_ROOTFS: return "rootfs";
	case MP716_ERR_NO_SPACE: return "no_space";
	case MP716_ERR_LOW_MEMORY: return "low_memory";
	case MP716_ERR_STATE: return "state";
	case MP716_ERR_BUSY: return "busy";
	case MP716_ERR_AUTH: return "auth";
	case MP716_ERR_CSRF: return "csrf";
	case MP716_ERR_PATH: return "path";
	case MP716_ERR_FLASH_DISABLED: return "flash_disabled";
	case MP716_ERR_INTERRUPTED: return "interrupted";
	case MP716_ERR_POWER_LOSS: return "power_loss";
	case MP716_ERR_TRUNCATED: return "truncated";
	case MP716_ERR_TRAILING: return "trailing";
	case MP716_ERR_NOT_CANONICAL: return "not_canonical";
	case MP716_ERR_NOT_IN_RAM: return "not_in_ram";
	case MP716_ERR_AUTH_UNAVAILABLE: return "auth_unavailable";
	case MP716_ERR_FORBIDDEN: return "forbidden";
	default: return "unknown";
	}
}

void mp716_report_init(struct mp716_report *report, const char *command)
{
	memset(report, 0, sizeof(*report));
	snprintf(report->command, sizeof(report->command), "%s", command ? command : "");
	snprintf(report->error, sizeof(report->error), "format");
	snprintf(report->state, sizeof(report->state), "IDLE");
	report->code = MP716_ERR_FORMAT;
}

void mp716_report_fail(struct mp716_report *report, int code, const char *detail)
{
	report->code = code;
	report->upgraded = 0;
	snprintf(report->error, sizeof(report->error), "%s", mp716_error_name(code));
	snprintf(report->detail, sizeof(report->detail), "%s", detail ? detail : "");
}

static void json_string(FILE *fp, const char *text)
{
	const unsigned char *p = (const unsigned char *)(text ? text : "");

	fputc('"', fp);
	for (; *p; p++) {
		if (*p == '"' || *p == '\\') {
			fputc('\\', fp);
			fputc(*p, fp);
		} else if (*p == '\n') {
			fputs("\\n", fp);
		} else if (*p < 0x20) {
			fprintf(fp, "\\u%04x", *p);
		} else {
			fputc(*p, fp);
		}
	}
	fputc('"', fp);
}

void mp716_report_write_json(FILE *fp, const struct mp716_report *report)
{
	fprintf(fp, "{\"accepted\":%s", report->accepted ? "true" : "false");
	fprintf(fp, ",\"base_firmware\":");
	json_string(fp, report->base_firmware);
	fprintf(fp, ",\"bytes_programmed\":%u", report->bytes_programmed);
	fprintf(fp, ",\"code\":%d", report->code);
	fprintf(fp, ",\"command\":");
	json_string(fp, report->command);
	fprintf(fp, ",\"custom_firmware\":");
	json_string(fp, report->custom_firmware);
	fprintf(fp, ",\"custom_firmware_installed\":%s", report->custom_firmware_installed ? "true" : "false");
	fprintf(fp, ",\"detail\":");
	json_string(fp, report->detail);
	fprintf(fp, ",\"erased\":%s", report->erased ? "true" : "false");
	fprintf(fp, ",\"error\":");
	json_string(fp, report->error[0] ? report->error : mp716_error_name(report->code));
	fprintf(fp, ",\"fake_mtd\":%s", report->fake_mtd ? "true" : "false");
	fprintf(fp, ",\"firmware_version\":");
	json_string(fp, report->firmware_version);
	fprintf(fp, ",\"flash_write\":false");
	fprintf(fp, ",\"hardware_revision\":");
	json_string(fp, report->hardware_revision);
	fprintf(fp, ",\"historical_offset_match\":%s", report->historical_offset_match ? "true" : "false");
	fprintf(fp, ",\"lzma_dictionary\":%u", report->lzma_dictionary);
	fprintf(fp, ",\"memory_available_kib\":%d", report->memory_available_kib);
	fprintf(fp, ",\"memory_checked\":%s", report->memory_checked ? "true" : "false");
	fprintf(fp, ",\"ok\":%s", report->code == MP716_OK ? "true" : "false");
	fprintf(fp, ",\"payload_sha256\":");
	json_string(fp, report->payload_sha256);
	fprintf(fp, ",\"payload_size\":%u", report->payload_size);
	fprintf(fp, ",\"product\":");
	json_string(fp, report->product);
	fprintf(fp, ",\"signature_checked\":%s", report->signature_checked ? "true" : "false");
	fprintf(fp, ",\"squashfs_offset\":%u", report->squashfs_offset);
	fprintf(fp, ",\"state\":");
	json_string(fp, report->state);
	fprintf(fp, ",\"task_code\":%d", report->task_code);
	fprintf(fp, ",\"uimage_name\":");
	json_string(fp, report->uimage_name);
	fprintf(fp, ",\"unrecoverable\":%s", report->unrecoverable ? "true" : "false");
	fprintf(fp, ",\"upgrade_engine\":");
	json_string(fp, report->upgrade_engine);
	fprintf(fp, ",\"upgraded\":%s", report->upgraded ? "true" : "false");
	fprintf(fp, ",\"vendor_software_version\":");
	json_string(fp, report->vendor_software_version);
	fprintf(fp, ",\"web_ui\":");
	json_string(fp, report->web_ui);
	fprintf(fp, "}\n");
}

int mp716_http_status(int code)
{
	switch (code) {
	case MP716_OK:
		return 200;
	case MP716_ERR_AUTH:
	case MP716_ERR_AUTH_UNAVAILABLE:
	case MP716_ERR_FORBIDDEN:
	case MP716_ERR_CSRF:
		return 403;
	case MP716_ERR_BUSY:
	case MP716_ERR_STATE:
		return 409;
	case MP716_ERR_SIZE:
	case MP716_ERR_LOW_MEMORY:
		return 413;
	default:
		return 400;
	}
}

static int copy_field(char *dst, size_t dst_len, const char *src)
{
	if (strlen(src) >= dst_len)
		return -1;
	memcpy(dst, src, strlen(src) + 1);
	return 0;
}

int mp716_profile_load(const char *path, struct mp716_profile *profile, char *detail, size_t detail_len)
{
	FILE *fp;
	char line[256];

	memset(profile, 0, sizeof(*profile));
	fp = fopen(path, "rb");
	if (!fp) {
		snprintf(detail, detail_len, "device profile is missing");
		return MP716_ERR_IO;
	}
	while (fgets(line, sizeof(line), fp)) {
		char *eq;
		size_t n = strlen(line);
		while (n && (line[n - 1] == '\n' || line[n - 1] == '\r'))
			line[--n] = 0;
		if (line[0] == 0 || line[0] == '#')
			continue;
		eq = strchr(line, '=');
		if (!eq)
			continue;
		*eq = 0;
		if (strcmp(line, "product") == 0)
			copy_field(profile->product, sizeof(profile->product), eq + 1);
		else if (strcmp(line, "hardware_revision") == 0)
			copy_field(profile->hardware_revision, sizeof(profile->hardware_revision), eq + 1);
		else if (strcmp(line, "base_firmware") == 0)
			copy_field(profile->base_firmware, sizeof(profile->base_firmware), eq + 1);
		else if (strcmp(line, "vendor_software_version") == 0)
			copy_field(profile->vendor_software_version, sizeof(profile->vendor_software_version), eq + 1);
		else if (strcmp(line, "installed_custom_firmware") == 0)
			copy_field(profile->installed_custom_firmware, sizeof(profile->installed_custom_firmware), eq + 1);
		else if (strcmp(line, "web_ui") == 0)
			copy_field(profile->web_ui, sizeof(profile->web_ui), eq + 1);
		else if (strcmp(line, "upgrade_engine") == 0)
			copy_field(profile->upgrade_engine, sizeof(profile->upgrade_engine), eq + 1);
	}
	fclose(fp);
	if (strcmp(profile->product, "MP716") != 0) {
		snprintf(detail, detail_len, "profile product is not MP716");
		return MP716_ERR_PRODUCT;
	}
	return MP716_OK;
}

int mp716_meminfo_available_kib(const char *path, int *out_kib, char *detail, size_t detail_len)
{
	FILE *fp;
	char line[128];
	int mem_free = -1, buffers = 0, cached = 0, available = -1;

	fp = fopen(path, "rb");
	if (!fp) {
		snprintf(detail, detail_len, "meminfo is missing");
		return MP716_ERR_LOW_MEMORY;
	}
	while (fgets(line, sizeof(line), fp)) {
		int value = 0;
		if (sscanf(line, "MemAvailable: %d", &value) == 1)
			available = value;
		else if (sscanf(line, "MemFree: %d", &value) == 1)
			mem_free = value;
		else if (sscanf(line, "Buffers: %d", &value) == 1)
			buffers = value;
		else if (sscanf(line, "Cached: %d", &value) == 1)
			cached = value;
	}
	fclose(fp);
	if (available >= 0)
		*out_kib = available;
	else if (mem_free >= 0)
		*out_kib = mem_free + buffers / 2 + cached / 2;
	else {
		snprintf(detail, detail_len, "meminfo has no MemFree");
		return MP716_ERR_LOW_MEMORY;
	}
	return MP716_OK;
}

int mp716_memory_allows(int available_kib, uint32_t payload_size, const char *phase)
{
	uint64_t available;

	if (available_kib < 0)
		return 0;
	available = (uint64_t)available_kib * 1024ull;
	if (strcmp(phase, "upload") == 0)
		return available >= (uint64_t)payload_size + MP716_UPLOAD_RESERVE_BYTES;
	if (strcmp(phase, "verify") == 0)
		return available >= MP716_VERIFY_RESERVE_BYTES;
	return 0;
}

int mp716_semver_parse(const char *text, int out[3])
{
	int a, b, c;
	int n = -1;
	const char *p;

	if (!text || sscanf(text, "%d.%d.%d%n", &a, &b, &c, &n) != 3 || n < 0)
		return -1;
	if (text[n] != 0 || a < 0 || b < 0 || c < 0 || a > 99999 || b > 99999 || c > 99999)
		return -1;
	p = text;
	if (*p == '0' && p[1] != '.')
		return -1;
	p = strchr(text, '.') + 1;
	if (*p == '0' && p[1] != '.')
		return -1;
	p = strchr(p, '.') + 1;
	if (*p == '0' && p[1] != 0)
		return -1;
	out[0] = a;
	out[1] = b;
	out[2] = c;
	return 0;
}

int mp716_runtime_is_ram(const char *path, int host_build, const char *host_root)
{
	size_t root_len;

	if (!path || !path[0] || strstr(path, ".."))
		return 0;
	if (!host_build)
		return strncmp(path, "/tmp/", 5) == 0;
	if (!host_root || !host_root[0])
		return 0;
	root_len = strlen(host_root);
	if (strncmp(path, host_root, root_len) != 0)
		return 0;
	if (path[root_len] != '/' && path[root_len] != '\\')
		return 0;
	return 1;
}
