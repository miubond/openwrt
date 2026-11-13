#define _CRT_SECURE_NO_WARNINGS

#include "error_codes.h"
#include "image_verify.h"
#include "mp716_format.h"
#include "mtd_backend.h"
#include "signature_verify.h"
#include "system_info.h"
#include "upgrade_state.h"

#include <stdio.h>
#include <string.h>

static int g_failed;

static void expect(int ok, const char *message)
{
	if (!ok) {
		fprintf(stderr, "FAIL %s\n", message);
		g_failed++;
	}
}

static int write_filled(const char *path, uint32_t size, uint8_t value)
{
	FILE *fp = fopen(path, "wb");
	uint8_t chunk[4096];
	uint32_t left = size;
	if (!fp)
		return -1;
	memset(chunk, value, sizeof(chunk));
	while (left) {
		uint32_t ask = left > sizeof(chunk) ? (uint32_t)sizeof(chunk) : left;
		if (fwrite(chunk, 1, ask, fp) != ask) {
			fclose(fp);
			return -1;
		}
		left -= ask;
	}
	fclose(fp);
	return 0;
}

static void write_fault(const char *image, const char *text)
{
	char path[360];
	FILE *fp;
	snprintf(path, sizeof(path), "%s.fault", image);
	fp = fopen(path, "wb");
	if (!fp)
		return;
	fputs(text, fp);
	fclose(fp);
}

int main(int argc, char **argv)
{
	const char *dir = argc > 1 ? argv[1] : ".";
	char path[320];
	char raw[320];
	uint8_t hash[32];
	uint8_t data[16];
	uint8_t expected[32];
	char hex[65];
	struct mp716_report report;
	FILE *payload;

	expect(mp716_crc32((const uint8_t *)"123456789", 9) == 0xcbf43926u, "crc32");
	mp716_sha256((const uint8_t *)"abc", 3, hash);
	mp716_hex32(hash, hex);
	expect(strcmp(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") == 0, "sha256");
	expect(!mp716_state_can(MP716_ST_UPLOADING, MP716_ST_SUCCESS), "upload must not become success");
	expect(mp716_state_can(MP716_ST_VERIFYING, MP716_ST_READY), "verify to ready");
	expect(mp716_state_can(MP716_ST_APPLYING, MP716_ST_REBOOT_REQUIRED), "apply to reboot");
	expect(mp716_state_can(MP716_ST_APPLYING, MP716_ST_FAILED), "apply can fail");
	expect(!mp716_state_can(MP716_ST_IDLE, MP716_ST_SUCCESS), "idle is not success");
	expect(mp716_runtime_is_ram("/tmp/mp716-upgraded", 0, NULL), "tmp path");
	expect(!mp716_runtime_is_ram("/usr/sbin/mp716-upgraded", 0, NULL), "rootfs path");
	expect(!mp716_runtime_is_ram("/tmp/../etc/passwd", 0, NULL), "dotdot path");
	expect(strcmp(mp716_error_name(MP716_ERR_FLASH_DISABLED), "flash_disabled") == 0, "error name");

	snprintf(path, sizeof(path), "%s/short.fakemtd", dir);
	write_filled(path, 32, 0xff);
	expect(mp716_nor_program(path, 0, (const uint8_t *)"x", 1) == MP716_ERR_NO_SPACE, "short fake partition");
	snprintf(path, sizeof(path), "%s/dev/mtd0.fakemtd", dir);
	expect(mp716_nor_program(path, 0, (const uint8_t *)"x", 1) == MP716_ERR_PATH, "device path rejected");

	snprintf(path, sizeof(path), "%s/and.fakemtd", dir);
	expect(write_filled(path, MP716_FIRMWARE_BYTES, 0xff) == 0, "create and image");
	{
		FILE *fp = fopen(path, "r+b");
		uint8_t preset = 0xf0;
		uint8_t value = 0x0f;
		uint8_t got = 0xff;
		expect(fp != NULL, "open and image");
		if (fp) {
			fwrite(&preset, 1, 1, fp);
			fclose(fp);
		}
		expect(mp716_nor_program(path, 0, &value, 1) == MP716_OK, "nor program");
		fp = fopen(path, "rb");
		if (fp) {
			fread(&got, 1, 1, fp);
			fclose(fp);
		}
		expect(got == 0x00, "nor and result");
	}

	memset(data, 0x22, sizeof(data));
	mp716_sha256(data, sizeof(data), expected);
	snprintf(raw, sizeof(raw), "%s/payload.bin", dir);
	payload = fopen(raw, "wb");
	expect(payload != NULL, "payload file");
	if (payload) {
		fwrite(data, 1, sizeof(data), payload);
		fclose(payload);
	}

	snprintf(path, sizeof(path), "%s/power.fakemtd", dir);
	expect(write_filled(path, MP716_FIRMWARE_BYTES, 0xa5) == 0, "create power image");
	write_fault(path, "power_cut_after=4\n");
	payload = fopen(raw, "rb");
	mp716_report_init(&report, "fake");
	expect(payload && mp716_fake_apply(path, payload, sizeof(data), expected, &report) == MP716_ERR_POWER_LOSS, "power cut code");
	expect(report.erased && report.unrecoverable && report.bytes_programmed == 4, "power cut report");
	if (payload)
		fclose(payload);
	{
		FILE *fp = fopen(path, "rb");
		uint8_t first = 0, fifth = 0, last = 0;
		if (fp) {
			fread(&first, 1, 1, fp);
			fseek(fp, 4, SEEK_SET);
			fread(&fifth, 1, 1, fp);
			fseek(fp, (long)(MP716_FIRMWARE_BYTES - 1), SEEK_SET);
			fread(&last, 1, 1, fp);
			fclose(fp);
		}
		expect(first == 0x22 && fifth == 0xff && last == 0xff, "power cut bytes");
	}

	snprintf(path, sizeof(path), "%s/io.fakemtd", dir);
	expect(write_filled(path, MP716_FIRMWARE_BYTES, 0xa5) == 0, "create io image");
	write_fault(path, "io_error_at=0\n");
	payload = fopen(raw, "rb");
	mp716_report_init(&report, "fake");
	expect(payload && mp716_fake_apply(path, payload, sizeof(data), expected, &report) == MP716_ERR_IO, "io error code");
	expect(report.erased && report.unrecoverable && report.bytes_programmed == 0, "io error report");
	if (payload)
		fclose(payload);

	if (g_failed) {
		fprintf(stderr, "%d device unit checks failed\n", g_failed);
		return 1;
	}
	printf("{\"ok\":true,\"command\":\"test_device\",\"failed\":0}\n");
	return 0;
}
