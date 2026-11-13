#define _CRT_SECURE_NO_WARNINGS

#include "mtd_backend.h"

#include "error_codes.h"
#include "mp716_format.h"
#include "mp716_port.h"
#include "sha256.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int path_allowed(const char *path)
{
	size_t n;
	if (!path || strstr(path, "..") || strstr(path, "/dev/mtd") || strstr(path, "\\dev\\mtd") ||
	    strstr(path, "mtdblock") || strstr(path, "allow-flash-upgrade"))
		return 0;
	n = strlen(path);
	return n >= 8 && strcmp(path + n - 8, ".fakemtd") == 0;
}

static int open_fake(const char *path, FILE **out, char *detail, size_t detail_len)
{
	FILE *fp;
	uint64_t size = 0;
	if (!path_allowed(path)) {
		snprintf(detail, detail_len, "refusing a path that is not a .fakemtd file");
		return MP716_ERR_PATH;
	}
	fp = fopen(path, "r+b");
	if (!fp) {
		snprintf(detail, detail_len, "fake firmware partition cannot be opened");
		return MP716_ERR_IO;
	}
	if (mp716_file_size(fp, &size) != MP716_OK) {
		fclose(fp);
		snprintf(detail, detail_len, "fake firmware partition length cannot be read");
		return MP716_ERR_IO;
	}
	if (size != MP716_FIRMWARE_BYTES) {
		fclose(fp);
		snprintf(detail, detail_len, "fake firmware partition is not 8060928 bytes");
		return MP716_ERR_NO_SPACE;
	}
	*out = fp;
	return MP716_OK;
}

static void load_fault(const char *image_path, struct mp716_fault *fault)
{
	char path[320];
	FILE *fp;
	char line[128];
	fault->power_cut_after = -1;
	fault->io_error_at = -1;
	snprintf(path, sizeof(path), "%s.fault", image_path);
	fp = fopen(path, "rb");
	if (!fp)
		return;
	while (fgets(line, sizeof(line), fp)) {
		if (strncmp(line, "power_cut_after=", 16) == 0)
			fault->power_cut_after = atoi(line + 16);
		else if (strncmp(line, "io_error_at=", 12) == 0)
			fault->io_error_at = atoi(line + 12);
	}
	fclose(fp);
}

int mp716_nor_program(const char *path, uint32_t offset, const uint8_t *data, uint32_t len)
{
	FILE *fp = NULL;
	char detail[80];
	uint8_t existing[256];
	uint32_t done = 0;
	int rc = open_fake(path, &fp, detail, sizeof(detail));
	if (rc != MP716_OK)
		return rc;
	if ((uint64_t)offset + len > MP716_FIRMWARE_BYTES) {
		fclose(fp);
		return MP716_ERR_SIZE;
	}
	while (done < len) {
		uint32_t ask = len - done > sizeof(existing) ? (uint32_t)sizeof(existing) : len - done;
		uint32_t i;
		if (fseek(fp, (long)(offset + done), SEEK_SET) != 0 || fread(existing, 1, ask, fp) != ask) {
			fclose(fp);
			return MP716_ERR_IO;
		}
		for (i = 0; i < ask; i++)
			existing[i] = (uint8_t)(existing[i] & data[done + i]);
		if (fseek(fp, (long)(offset + done), SEEK_SET) != 0 || fwrite(existing, 1, ask, fp) != ask) {
			fclose(fp);
			return MP716_ERR_IO;
		}
		done += ask;
	}
	fclose(fp);
	return MP716_OK;
}

int mp716_fake_apply(const char *path, FILE *payload, uint32_t payload_len, const uint8_t expected_sha[32],
		     struct mp716_report *report)
{
	FILE *fp = NULL;
	struct mp716_fault fault;
	uint8_t blank[MP716_IO_CHUNK];
	uint8_t chunk[MP716_IO_CHUNK];
	uint32_t offset = 0;
	uint32_t programmed = 0;
	SHA256_CTX sha;
	uint8_t digest[32];
	char detail[180];
	int rc;

	report->fake_mtd = 1;
	report->erased = 0;
	report->unrecoverable = 0;
	report->bytes_programmed = 0;
	if (payload_len == 0 || payload_len > MP716_FIRMWARE_BYTES) {
		mp716_report_fail(report, MP716_ERR_SIZE, "payload does not fit the firmware partition");
		return MP716_ERR_SIZE;
	}
	rc = open_fake(path, &fp, detail, sizeof(detail));
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, detail);
		return rc;
	}
	load_fault(path, &fault);
	memset(blank, 0xff, sizeof(blank));
	if (fseek(fp, 0, SEEK_SET) != 0) {
		fclose(fp);
		mp716_report_fail(report, MP716_ERR_IO, "fake partition seek failed");
		return MP716_ERR_IO;
	}
	while (offset < MP716_FIRMWARE_BYTES) {
		uint32_t ask = MP716_FIRMWARE_BYTES - offset;
		if (ask > MP716_IO_CHUNK)
			ask = MP716_IO_CHUNK;
		if (fwrite(blank, 1, ask, fp) != ask) {
			fclose(fp);
			mp716_report_fail(report, MP716_ERR_IO, "fake erase failed");
			return MP716_ERR_IO;
		}
		offset += ask;
	}
	fflush(fp);
	report->erased = 1;
	report->unrecoverable = 1;
	while (programmed < payload_len) {
		uint32_t ask = payload_len - programmed;
		uint32_t i;
		if (ask > MP716_IO_CHUNK)
			ask = MP716_IO_CHUNK;
		if (fault.power_cut_after >= 0 && programmed >= (uint32_t)fault.power_cut_after) {
			report->bytes_programmed = programmed;
			fclose(fp);
			mp716_report_fail(report, MP716_ERR_POWER_LOSS, "simulated power loss after erase");
			return MP716_ERR_POWER_LOSS;
		}
		if (fault.io_error_at >= 0 && programmed >= (uint32_t)fault.io_error_at) {
			report->bytes_programmed = programmed;
			fclose(fp);
			mp716_report_fail(report, MP716_ERR_IO, "simulated IO error after erase");
			return MP716_ERR_IO;
		}
		if (fault.power_cut_after >= 0 && (uint32_t)fault.power_cut_after - programmed < ask)
			ask = (uint32_t)fault.power_cut_after - programmed;
		if (fault.io_error_at >= 0 && (uint32_t)fault.io_error_at > programmed &&
		    (uint32_t)fault.io_error_at - programmed < ask)
			ask = (uint32_t)fault.io_error_at - programmed;
		if (fread(chunk, 1, ask, payload) != ask) {
			report->bytes_programmed = programmed;
			fclose(fp);
			mp716_report_fail(report, MP716_ERR_INTERRUPTED, "payload stream ended during program");
			return MP716_ERR_INTERRUPTED;
		}
		if (fseek(fp, (long)programmed, SEEK_SET) != 0) {
			fclose(fp);
			mp716_report_fail(report, MP716_ERR_IO, "fake partition seek failed");
			return MP716_ERR_IO;
		}
		for (i = 0; i < ask; i++)
			chunk[i] = (uint8_t)(0xffu & chunk[i]);
		if (fwrite(chunk, 1, ask, fp) != ask) {
			report->bytes_programmed = programmed;
			fclose(fp);
			mp716_report_fail(report, MP716_ERR_IO, "fake program failed");
			return MP716_ERR_IO;
		}
		programmed += ask;
	}
	fflush(fp);
	report->bytes_programmed = programmed;
	if (fseek(fp, 0, SEEK_SET) != 0) {
		fclose(fp);
		mp716_report_fail(report, MP716_ERR_IO, "readback seek failed");
		return MP716_ERR_IO;
	}
	sha256_init(&sha);
	offset = 0;
	while (offset < payload_len) {
		uint32_t ask = payload_len - offset;
		if (ask > MP716_IO_CHUNK)
			ask = MP716_IO_CHUNK;
		if (fread(chunk, 1, ask, fp) != ask) {
			fclose(fp);
			mp716_report_fail(report, MP716_ERR_IO, "readback failed");
			return MP716_ERR_IO;
		}
		sha256_update(&sha, chunk, ask);
		offset += ask;
	}
	sha256_final(&sha, digest);
	if (memcmp(digest, expected_sha, 32) != 0) {
		fclose(fp);
		mp716_report_fail(report, MP716_ERR_HASH, "readback hash does not match the verified payload");
		return MP716_ERR_HASH;
	}
	if (payload_len < MP716_FIRMWARE_BYTES) {
		uint8_t tail = 0;
		uint8_t last = 0;
		if (fseek(fp, (long)payload_len, SEEK_SET) != 0 || fread(&tail, 1, 1, fp) != 1 ||
		    fseek(fp, (long)(MP716_FIRMWARE_BYTES - 1), SEEK_SET) != 0 || fread(&last, 1, 1, fp) != 1 ||
		    tail != 0xff || last != 0xff) {
			fclose(fp);
			mp716_report_fail(report, MP716_ERR_HASH, "erased tail is not empty");
			return MP716_ERR_HASH;
		}
	}
	fclose(fp);
	report->unrecoverable = 0;
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	snprintf(report->detail, sizeof(report->detail), "fake partition programmed and read back");
	return MP716_OK;
}
