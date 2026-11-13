#define _CRT_SECURE_NO_WARNINGS

#include "upgrade_manager.h"

#include "error_codes.h"
#include "image_verify.h"
#include "mp716_format.h"
#include "mp716_port.h"
#include "mtd_backend.h"
#include "signature_verify.h"
#include "upgrade_state.h"
#include "sha256.h"

#include <stdlib.h>
#include <string.h>

int mp716_paths_from_root(struct mp716_paths *paths, const char *root)
{
	if (!paths || !root || !root[0] || strstr(root, ".."))
		return MP716_ERR_PATH;
	memset(paths, 0, sizeof(*paths));
	snprintf(paths->root, sizeof(paths->root), "%s", root);
	if (mp716_join(paths->image, sizeof(paths->image), root, "incoming.mp716upd") ||
	    mp716_join(paths->state_path, sizeof(paths->state_path), root, "state") ||
	    mp716_join(paths->history, sizeof(paths->history), root, "history.log") ||
	    mp716_join(paths->profile, sizeof(paths->profile), root, "device.profile") ||
	    mp716_join(paths->pubkey, sizeof(paths->pubkey), root, "upgrade.pub") ||
	    mp716_join(paths->auth_mode, sizeof(paths->auth_mode), root, "auth.mode") ||
	    mp716_join(paths->session, sizeof(paths->session), root, "session") ||
	    mp716_join(paths->lock_path, sizeof(paths->lock_path), root, "LOCK") ||
	    mp716_join(paths->meminfo, sizeof(paths->meminfo), root, "meminfo"))
		return MP716_ERR_PATH;
	return MP716_OK;
}

int mp716_paths_device(struct mp716_paths *paths)
{
	int rc = mp716_paths_from_root(paths, "/tmp/mp716-upgrade");
	if (rc != MP716_OK)
		return rc;
	snprintf(paths->profile, sizeof(paths->profile), "/etc/mp716-upgrade/device.profile");
	snprintf(paths->pubkey, sizeof(paths->pubkey), "/etc/mp716-upgrade/upgrade.pub");
	snprintf(paths->auth_mode, sizeof(paths->auth_mode), "/etc/mp716-upgrade/auth.mode");
	snprintf(paths->meminfo, sizeof(paths->meminfo), "/proc/meminfo");
	return MP716_OK;
}

int mp716_argv_rejected(int argc, char **argv, struct mp716_report *report)
{
	int i;
	for (i = 1; i < argc; i++) {
		if (strcmp(argv[i], "--allow-flash-upgrade") == 0 || strcmp(argv[i], "allow-flash-upgrade") == 0) {
			mp716_report_fail(report, MP716_ERR_FLASH_DISABLED, "real flash upgrade is disabled");
			return 1;
		}
		if (strcmp(argv[i], "--mtd") == 0 || strcmp(argv[i], "--partition") == 0 || strcmp(argv[i], "--device") == 0) {
			mp716_report_fail(report, MP716_ERR_PATH, "partition paths cannot be selected from arguments");
			return 1;
		}
	}
	return 0;
}

static void fill_profile(struct mp716_report *report, const struct mp716_profile *profile)
{
	snprintf(report->product, sizeof(report->product), "%s", profile->product);
	snprintf(report->hardware_revision, sizeof(report->hardware_revision), "%s", profile->hardware_revision);
	snprintf(report->base_firmware, sizeof(report->base_firmware), "%s", profile->base_firmware);
	snprintf(report->vendor_software_version, sizeof(report->vendor_software_version), "%s", profile->vendor_software_version);
	snprintf(report->custom_firmware, sizeof(report->custom_firmware), "%s", profile->installed_custom_firmware);
	snprintf(report->web_ui, sizeof(report->web_ui), "%s", profile->web_ui);
	snprintf(report->upgrade_engine, sizeof(report->upgrade_engine), "%s", profile->upgrade_engine);
	report->custom_firmware_installed = profile->installed_custom_firmware[0] != 0;
}

static int with_lock(const struct mp716_paths *paths, int inherited, int *owned)
{
	*owned = 0;
	if (inherited) {
		FILE *fp = fopen(paths->lock_path, "rb");
		if (!fp)
			return MP716_ERR_BUSY;
		fclose(fp);
		*owned = 1;
		return MP716_OK;
	}
	if (mp716_exclusive_create(paths->lock_path) != MP716_OK)
		return MP716_ERR_BUSY;
	*owned = 1;
	return MP716_OK;
}

static void unlock(const struct mp716_paths *paths, int owned)
{
	if (owned)
		mp716_remove_file(paths->lock_path);
}

static void remember_state(struct mp716_report *report, const struct mp716_state *state)
{
	snprintf(report->state, sizeof(report->state), "%s", state->name);
	report->task_code = state->code;
	report->bytes_programmed = state->bytes_programmed;
	report->erased = state->erased;
	report->unrecoverable = state->unrecoverable;
}

static int save_failure(const struct mp716_paths *paths, struct mp716_state *state, struct mp716_report *report)
{
	mp716_state_transition(state, MP716_ST_FAILED, report->code, report->detail);
	mp716_state_store(paths->state_path, state);
	remember_state(report, state);
	mp716_history_append(paths->history, report);
	return report->code;
}

int mp716_cmd_check(const char *image, const char *pubkey, const char *profile_path, const char *meminfo,
		    int operator_allow_downgrade, struct mp716_report *report)
{
	struct mp716_profile profile;
	char detail[180];
	int rc;
	if (!image || strstr(image, "..") || strstr(image, "/dev/mtd") || strstr(image, "mtdblock")) {
		mp716_report_fail(report, MP716_ERR_PATH, "check refuses a device path");
		return MP716_ERR_PATH;
	}
	rc = mp716_profile_load(profile_path, &profile, detail, sizeof(detail));
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, detail);
		return rc;
	}
	rc = mp716_verify_image(image, pubkey, &profile, meminfo, meminfo != NULL, operator_allow_downgrade, report);
	if (rc == MP716_OK) {
		snprintf(report->vendor_software_version, sizeof(report->vendor_software_version), "%s", profile.vendor_software_version);
		report->upgraded = 0;
	}
	return rc;
}

int mp716_cmd_info(const struct mp716_paths *paths, struct mp716_report *report)
{
	struct mp716_profile profile;
	struct mp716_state state;
	char detail[180];
	int rc = mp716_profile_load(paths->profile, &profile, detail, sizeof(detail));
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, detail);
		return rc;
	}
	fill_profile(report, &profile);
	mp716_state_load(paths->state_path, &state);
	remember_state(report, &state);
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	report->upgraded = 0;
	snprintf(report->detail, sizeof(report->detail), "vendor and custom versions are separate");
	return MP716_OK;
}

int mp716_cmd_status(const struct mp716_paths *paths, struct mp716_report *report)
{
	struct mp716_state state;
	int rc = mp716_state_load(paths->state_path, &state);
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "upgrade state cannot be read");
		return rc;
	}
	remember_state(report, &state);
	snprintf(report->detail, sizeof(report->detail), "%s", state.detail);
	snprintf(report->payload_sha256, sizeof(report->payload_sha256), "%s", state.payload_sha256);
	snprintf(report->firmware_version, sizeof(report->firmware_version), "%s", state.expected_custom_firmware);
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	report->upgraded = 0;
	return MP716_OK;
}

int mp716_history_write(FILE *fp, const char *path)
{
	FILE *in = fopen(path, "rb");
	int first = 1;
	fprintf(fp, "{\"ok\":true,\"code\":0,\"error\":\"ok\",\"command\":\"history\",\"flash_write\":false,\"upgraded\":false,\"entries\":[");
	if (in) {
		char line[640];
		while (fgets(line, sizeof(line), in)) {
			size_t n;
			if (line[0] != '{')
				continue;
			n = strlen(line);
			while (n && (line[n - 1] == '\n' || line[n - 1] == '\r'))
				line[--n] = 0;
			if (!first)
				fputc(',', fp);
			fputs(line, fp);
			first = 0;
		}
		fclose(in);
	}
	fprintf(fp, "]}\n");
	return MP716_OK;
}

int mp716_cmd_history(const struct mp716_paths *paths, struct mp716_report *report)
{
	(void)paths;
	(void)report;
	return MP716_OK;
}

int mp716_cmd_reset(const struct mp716_paths *paths, struct mp716_report *report)
{
	struct mp716_state state;
	int owned = 0;
	int rc = with_lock(paths, 0, &owned);
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "another upgrade task holds the lock");
		return rc;
	}
	rc = mp716_state_load(paths->state_path, &state);
	if (rc == MP716_OK)
		rc = mp716_state_transition(&state, MP716_ST_IDLE, MP716_OK, "reset");
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "only a failed task can be reset");
		unlock(paths, owned);
		return rc;
	}
	mp716_remove_file(paths->image);
	mp716_state_store(paths->state_path, &state);
	remember_state(report, &state);
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	report->upgraded = 0;
	unlock(paths, owned);
	return MP716_OK;
}

int mp716_cmd_upload(const struct mp716_paths *paths, FILE *body, long content_length, struct mp716_report *report)
{
	struct mp716_state state;
	char tmp[340];
	FILE *out = NULL;
	int owned = 0;
	int available = 0;
	long remaining;
	int rc;

	if (content_length <= 0) {
		mp716_report_fail(report, MP716_ERR_SIZE, "upload length is missing");
		return MP716_ERR_SIZE;
	}
	if ((unsigned long)content_length > (unsigned long)MP716_HEADER_BYTES + MP716_MANIFEST_MAX + MP716_FIRMWARE_BYTES + MP716_SIGNATURE_BYTES) {
		mp716_report_fail(report, MP716_ERR_SIZE, "upload is larger than the firmware partition container");
		return MP716_ERR_SIZE;
	}
	rc = mp716_meminfo_available_kib(paths->meminfo, &available, report->detail, sizeof(report->detail));
	if (rc != MP716_OK || !mp716_memory_allows(available, (uint32_t)content_length, "upload")) {
		mp716_report_fail(report, MP716_ERR_LOW_MEMORY, "not enough free memory to accept the upload");
		return MP716_ERR_LOW_MEMORY;
	}
	report->memory_checked = 1;
	report->memory_available_kib = available;
	rc = with_lock(paths, 0, &owned);
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "another upgrade task holds the lock");
		return rc;
	}
	rc = mp716_state_load(paths->state_path, &state);
	if (rc == MP716_OK)
		rc = mp716_state_transition(&state, MP716_ST_UPLOADING, MP716_OK, "upload_started");
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "upload is not allowed from the current state");
		unlock(paths, owned);
		return rc;
	}
	mp716_state_store(paths->state_path, &state);
	snprintf(tmp, sizeof(tmp), "%s.tmp", paths->image);
	out = fopen(tmp, "wb");
	if (!out) {
		mp716_report_fail(report, MP716_ERR_IO, "upload file cannot be created");
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return MP716_ERR_IO;
	}
	remaining = content_length;
	while (remaining > 0) {
		uint8_t chunk[MP716_IO_CHUNK];
		size_t ask = (size_t)remaining > sizeof(chunk) ? sizeof(chunk) : (size_t)remaining;
		size_t got = fread(chunk, 1, ask, body);
		if (got != ask) {
			fclose(out);
			mp716_remove_file(tmp);
			mp716_report_fail(report, MP716_ERR_INTERRUPTED, "upload ended before content-length");
			save_failure(paths, &state, report);
			unlock(paths, owned);
			return MP716_ERR_INTERRUPTED;
		}
		if (fwrite(chunk, 1, got, out) != got) {
			fclose(out);
			mp716_remove_file(tmp);
			mp716_report_fail(report, MP716_ERR_IO, "upload could not be stored");
			save_failure(paths, &state, report);
			unlock(paths, owned);
			return MP716_ERR_IO;
		}
		remaining -= (long)got;
	}
	fclose(out);
	if (mp716_replace_file(tmp, paths->image) != MP716_OK) {
		mp716_remove_file(tmp);
		mp716_report_fail(report, MP716_ERR_IO, "upload could not be committed");
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return MP716_ERR_IO;
	}
	snprintf(state.detail, sizeof(state.detail), "upload_stored");
	state.code = MP716_OK;
	snprintf(state.error, sizeof(state.error), "ok");
	mp716_state_store(paths->state_path, &state);
	remember_state(report, &state);
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	snprintf(report->detail, sizeof(report->detail), "upload_stored");
	report->upgraded = 0;
	report->payload_size = (uint32_t)content_length;
	unlock(paths, owned);
	return MP716_OK;
}

int mp716_cmd_verify(const struct mp716_paths *paths, int operator_allow_downgrade, struct mp716_report *report)
{
	struct mp716_state state;
	struct mp716_profile profile;
	int owned = 0;
	int rc = with_lock(paths, 0, &owned);
	char detail[180];
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "another upgrade task holds the lock");
		return rc;
	}
	rc = mp716_state_load(paths->state_path, &state);
	if (rc == MP716_OK && state.id != MP716_ST_UPLOADING)
		rc = MP716_ERR_STATE;
	if (rc == MP716_OK)
		rc = mp716_state_transition(&state, MP716_ST_VERIFYING, MP716_OK, "verifying");
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc == MP716_ERR_STATE ? rc : rc, "verify requires a stored upload");
		unlock(paths, owned);
		return rc;
	}
	mp716_state_store(paths->state_path, &state);
	rc = mp716_profile_load(paths->profile, &profile, detail, sizeof(detail));
	if (rc != MP716_OK)
		mp716_report_fail(report, rc, detail);
	else
		rc = mp716_verify_image(paths->image, paths->pubkey, &profile, paths->meminfo, 1, operator_allow_downgrade, report);
	if (rc != MP716_OK) {
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return report->code;
	}
	snprintf(report->vendor_software_version, sizeof(report->vendor_software_version), "%s", profile.vendor_software_version);
	rc = mp716_state_transition(&state, MP716_ST_READY, MP716_OK, "verified");
	snprintf(state.payload_sha256, sizeof(state.payload_sha256), "%s", report->payload_sha256);
	snprintf(state.expected_custom_firmware, sizeof(state.expected_custom_firmware), "%s", report->firmware_version);
	mp716_state_store(paths->state_path, &state);
	remember_state(report, &state);
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	report->upgraded = 0;
	mp716_history_append(paths->history, report);
	unlock(paths, owned);
	return rc;
}

int mp716_cmd_apply(const struct mp716_paths *paths, const char *backend, const char *fakemtd, const char *runtime_path,
		    int operator_allow_downgrade, int lock_inherited, struct mp716_report *report)
{
	struct mp716_state state;
	struct mp716_profile profile;
	FILE *image = NULL;
	uint8_t header[64];
	uint8_t expected[32];
	char version[24];
	char sha_hex[65];
	char detail[180];
	uint32_t manifest_size, payload_size;
	int owned = 0;
	int host_build = 0;
	int rc;

#ifdef MP716_HOST
	host_build = 1;
#endif
	if (!backend || strcmp(backend, "fake") != 0) {
		mp716_report_fail(report, MP716_ERR_FLASH_DISABLED, "only the fake backend can be selected, and real flash is disabled");
		return MP716_ERR_FLASH_DISABLED;
	}
	if (!fakemtd || !runtime_path) {
		mp716_report_fail(report, MP716_ERR_USAGE, "fake backend requires a runtime path and a fakemtd file");
		return MP716_ERR_USAGE;
	}
	if (!mp716_runtime_is_ram(runtime_path, host_build, paths->root)) {
		mp716_report_fail(report, MP716_ERR_NOT_IN_RAM, "upgrade process is not running from the RAM copy");
		return MP716_ERR_NOT_IN_RAM;
	}
	rc = with_lock(paths, lock_inherited, &owned);
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "another upgrade task holds the lock");
		return rc;
	}
	rc = mp716_state_load(paths->state_path, &state);
	if (rc == MP716_OK && state.id != MP716_ST_READY)
		rc = MP716_ERR_STATE;
	if (rc != MP716_OK) {
		mp716_report_fail(report, MP716_ERR_STATE, "apply requires a verified image");
		unlock(paths, owned);
		return MP716_ERR_STATE;
	}
	rc = mp716_profile_load(paths->profile, &profile, detail, sizeof(detail));
	if (rc != MP716_OK)
		mp716_report_fail(report, rc, detail);
	else
		rc = mp716_verify_image(paths->image, paths->pubkey, &profile, paths->meminfo, 1, operator_allow_downgrade, report);
	if (rc != MP716_OK) {
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return report->code;
	}
	snprintf(version, sizeof(version), "%s", report->firmware_version);
	snprintf(sha_hex, sizeof(sha_hex), "%s", report->payload_sha256);
	if (mp716_hex_decode_fixed(sha_hex, 64, expected, 32) != 0) {
		mp716_report_fail(report, MP716_ERR_HASH, "verified hash could not be decoded");
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return MP716_ERR_HASH;
	}
	rc = mp716_state_transition(&state, MP716_ST_APPLYING, MP716_OK, "applying");
	mp716_state_store(paths->state_path, &state);
	image = fopen(paths->image, "rb");
	if (!image || fread(header, 1, 64, image) != 64) {
		if (image)
			fclose(image);
		mp716_report_fail(report, MP716_ERR_IO, "verified image could not be reopened");
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return report->code;
	}
	manifest_size = (uint32_t)header[16] | ((uint32_t)header[17] << 8) | ((uint32_t)header[18] << 16) | ((uint32_t)header[19] << 24);
	payload_size = (uint32_t)header[20] | ((uint32_t)header[21] << 8) | ((uint32_t)header[22] << 16) | ((uint32_t)header[23] << 24);
	if (fseek(image, (long)(64 + manifest_size), SEEK_SET) != 0) {
		fclose(image);
		mp716_report_fail(report, MP716_ERR_IO, "payload seek failed");
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return report->code;
	}
	rc = mp716_fake_apply(fakemtd, image, payload_size, expected, report);
	fclose(image);
	snprintf(report->firmware_version, sizeof(report->firmware_version), "%s", version);
	snprintf(report->payload_sha256, sizeof(report->payload_sha256), "%s", sha_hex);
	snprintf(report->vendor_software_version, sizeof(report->vendor_software_version), "%s", profile.vendor_software_version);
	report->fake_mtd = 1;
	report->upgraded = 0;
	if (rc != MP716_OK) {
		/* Stay FAILED. Nothing here copies the previous bytes back. */
		state.bytes_programmed = report->bytes_programmed;
		state.erased = report->erased;
		state.unrecoverable = report->unrecoverable;
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return report->code;
	}
	snprintf(state.expected_custom_firmware, sizeof(state.expected_custom_firmware), "%s", version);
	snprintf(state.payload_sha256, sizeof(state.payload_sha256), "%s", sha_hex);
	state.bytes_programmed = report->bytes_programmed;
	state.erased = 1;
	state.unrecoverable = 0;
	rc = mp716_state_transition(&state, MP716_ST_REBOOT_REQUIRED, MP716_OK, "reboot_required");
	mp716_state_store(paths->state_path, &state);
	remember_state(report, &state);
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	snprintf(report->detail, sizeof(report->detail), "fake partition programmed; device profile was not changed");
	report->upgraded = 0;
	mp716_history_append(paths->history, report);
	unlock(paths, owned);
	return rc;
}

static int known_good_rejected(const char *path, const char *fakemtd)
{
	size_t n;
	if (!path || !path[0] || !fakemtd || strcmp(path, fakemtd) == 0)
		return 1;
	if (strstr(path, "..") || strstr(path, "/dev/mtd") || strstr(path, "\\dev\\mtd") ||
	    strstr(path, "mtdblock") || strstr(path, "allow-flash-upgrade"))
		return 1;
	n = strlen(path);
	return n >= 8 && strcmp(path + n - 8, ".fakemtd") == 0;
}

static int hash_stream(FILE *fp, uint8_t digest[32], uint64_t *total)
{
	SHA256_CTX sha;
	uint8_t chunk[MP716_IO_CHUNK];
	*total = 0;
	sha256_init(&sha);
	if (fseek(fp, 0, SEEK_SET) != 0)
		return MP716_ERR_IO;
	for (;;) {
		size_t n = fread(chunk, 1, sizeof(chunk), fp);
		if (n == 0)
			break;
		sha256_update(&sha, chunk, n);
		*total += n;
	}
	if (ferror(fp) || fseek(fp, 0, SEEK_SET) != 0)
		return MP716_ERR_IO;
	sha256_final(&sha, digest);
	return MP716_OK;
}

int mp716_cmd_recover(const struct mp716_paths *paths, const char *backend, const char *fakemtd, const char *known_good,
		      const char *runtime_path, struct mp716_report *report)
{
	struct mp716_state state;
	struct mp716_profile profile;
	FILE *image = NULL;
	uint8_t digest[32];
	char detail[180];
	char sha_hex[65];
	uint64_t image_bytes = 0;
	int owned = 0;
	int host_build = 0;
	int rc;

#ifdef MP716_HOST
	host_build = 1;
#endif
	if (!backend || strcmp(backend, "fake") != 0) {
		mp716_report_fail(report, MP716_ERR_FLASH_DISABLED, "manual recovery can target only the fake firmware partition");
		return MP716_ERR_FLASH_DISABLED;
	}
	if (!fakemtd || !known_good || !runtime_path) {
		mp716_report_fail(report, MP716_ERR_USAGE, "recovery requires a runtime path, a fakemtd file, and a known-good image");
		return MP716_ERR_USAGE;
	}
	if (known_good_rejected(known_good, fakemtd)) {
		mp716_report_fail(report, MP716_ERR_PATH, "known-good image must be a separate offline copy, not a live partition");
		return MP716_ERR_PATH;
	}
	if (!mp716_runtime_is_ram(runtime_path, host_build, paths->root)) {
		mp716_report_fail(report, MP716_ERR_NOT_IN_RAM, "recovery process is not running from the RAM copy");
		return MP716_ERR_NOT_IN_RAM;
	}
	rc = with_lock(paths, 0, &owned);
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "another upgrade task holds the lock");
		return rc;
	}
	rc = mp716_state_load(paths->state_path, &state);
	if (rc != MP716_OK || state.id != MP716_ST_FAILED || !state.unrecoverable) {
		mp716_report_fail(report, MP716_ERR_STATE, "manual recovery runs only after an unrecoverable failed program");
		unlock(paths, owned);
		return MP716_ERR_STATE;
	}
	rc = mp716_profile_load(paths->profile, &profile, detail, sizeof(detail));
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, detail);
		unlock(paths, owned);
		return rc;
	}
	image = fopen(known_good, "rb");
	if (!image) {
		mp716_report_fail(report, MP716_ERR_IO, "known-good image cannot be opened");
		unlock(paths, owned);
		return MP716_ERR_IO;
	}
	rc = hash_stream(image, digest, &image_bytes);
	if (rc != MP716_OK) {
		fclose(image);
		mp716_report_fail(report, rc, "known-good image could not be hashed");
		unlock(paths, owned);
		return rc;
	}
	if (image_bytes != MP716_FIRMWARE_BYTES) {
		fclose(image);
		mp716_report_fail(report, MP716_ERR_SIZE, "known-good image is not the firmware partition size");
		unlock(paths, owned);
		return MP716_ERR_SIZE;
	}
	mp716_hex32(digest, sha_hex);
	rc = mp716_fake_apply(fakemtd, image, MP716_FIRMWARE_BYTES, digest, report);
	fclose(image);
	fill_profile(report, &profile);
	snprintf(report->payload_sha256, sizeof(report->payload_sha256), "%s", sha_hex);
	report->fake_mtd = 1;
	report->upgraded = 0;
	report->firmware_version[0] = 0;
	if (rc != MP716_OK) {
		state.bytes_programmed = report->bytes_programmed;
		state.erased = report->erased;
		state.unrecoverable = report->unrecoverable;
		state.code = report->code;
		snprintf(state.error, sizeof(state.error), "%s", report->error);
		snprintf(state.detail, sizeof(state.detail), "%s", report->detail);
		mp716_state_store(paths->state_path, &state);
		remember_state(report, &state);
		report->upgraded = 0;
		mp716_history_append(paths->history, report);
		unlock(paths, owned);
		return report->code;
	}
	state.expected_custom_firmware[0] = 0;
	snprintf(state.payload_sha256, sizeof(state.payload_sha256), "%s", sha_hex);
	state.bytes_programmed = report->bytes_programmed;
	state.erased = 1;
	state.unrecoverable = 0;
	rc = mp716_state_transition(&state, MP716_ST_IDLE, MP716_OK,
				    "manual recovery restored the fake firmware partition; this is not automatic rollback");
	mp716_state_store(paths->state_path, &state);
	remember_state(report, &state);
	report->code = MP716_OK;
	snprintf(report->error, sizeof(report->error), "ok");
	snprintf(report->detail, sizeof(report->detail), "%s", state.detail);
	report->upgraded = 0;
	mp716_history_append(paths->history, report);
	unlock(paths, owned);
	return rc;
}

int mp716_cmd_boot_verify(const struct mp716_paths *paths, struct mp716_report *report)
{
	struct mp716_state state;
	struct mp716_profile profile;
	char detail[180];
	int owned = 0;
	int rc = with_lock(paths, 0, &owned);
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, "another upgrade task holds the lock");
		return rc;
	}
	rc = mp716_state_load(paths->state_path, &state);
	if (rc != MP716_OK) {
		unlock(paths, owned);
		mp716_report_fail(report, rc, "upgrade state cannot be read");
		return rc;
	}
	if (state.id == MP716_ST_IDLE) {
		remember_state(report, &state);
		report->code = MP716_OK;
		snprintf(report->error, sizeof(report->error), "ok");
		snprintf(report->detail, sizeof(report->detail), "no_pending_upgrade");
		report->upgraded = 0;
		unlock(paths, owned);
		return MP716_OK;
	}
	if (state.id != MP716_ST_REBOOT_REQUIRED) {
		mp716_report_fail(report, MP716_ERR_STATE, "boot verification requires a reboot-required task");
		unlock(paths, owned);
		return MP716_ERR_STATE;
	}
	mp716_state_transition(&state, MP716_ST_BOOT_VERIFYING, MP716_OK, "boot_verifying");
	mp716_state_store(paths->state_path, &state);
	rc = mp716_profile_load(paths->profile, &profile, detail, sizeof(detail));
	if (rc != MP716_OK) {
		mp716_report_fail(report, rc, detail);
		save_failure(paths, &state, report);
		unlock(paths, owned);
		return rc;
	}
	fill_profile(report, &profile);
	if (profile.installed_custom_firmware[0] &&
	    strcmp(profile.installed_custom_firmware, state.expected_custom_firmware) == 0) {
		mp716_state_transition(&state, MP716_ST_SUCCESS, MP716_OK, "running custom version matches the pending image");
		mp716_state_store(paths->state_path, &state);
		remember_state(report, &state);
		report->code = MP716_OK;
		snprintf(report->error, sizeof(report->error), "ok");
		snprintf(report->detail, sizeof(report->detail), "running custom version matches the pending image");
		report->upgraded = 1;
		mp716_history_append(paths->history, report);
		unlock(paths, owned);
		return MP716_OK;
	}
	mp716_report_fail(report, MP716_ERR_VERSION, "running custom firmware does not match the pending image");
	save_failure(paths, &state, report);
	unlock(paths, owned);
	return MP716_ERR_VERSION;
}
