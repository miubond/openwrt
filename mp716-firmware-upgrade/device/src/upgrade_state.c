#define _CRT_SECURE_NO_WARNINGS

#include "upgrade_state.h"

#include "error_codes.h"
#include "mp716_port.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static const char *NAMES[] = {
	"IDLE", "UPLOADING", "VERIFYING", "READY", "APPLYING",
	"REBOOT_REQUIRED", "BOOT_VERIFYING", "SUCCESS", "FAILED"
};

const char *mp716_state_name(int id)
{
	if (id < MP716_ST_IDLE || id > MP716_ST_FAILED)
		return "FAILED";
	return NAMES[id];
}

int mp716_state_id(const char *name)
{
	int i;
	for (i = MP716_ST_IDLE; i <= MP716_ST_FAILED; i++) {
		if (strcmp(name, NAMES[i]) == 0)
			return i;
	}
	return -1;
}

int mp716_state_can(int from, int to)
{
	if (to == MP716_ST_FAILED && from != MP716_ST_FAILED && from != MP716_ST_IDLE && from != MP716_ST_SUCCESS)
		return 1;
	switch (from) {
	case MP716_ST_IDLE:
		return to == MP716_ST_UPLOADING;
	case MP716_ST_UPLOADING:
		return to == MP716_ST_VERIFYING;
	case MP716_ST_VERIFYING:
		return to == MP716_ST_READY;
	case MP716_ST_READY:
		return to == MP716_ST_APPLYING || to == MP716_ST_UPLOADING;
	case MP716_ST_APPLYING:
		return to == MP716_ST_REBOOT_REQUIRED;
	case MP716_ST_REBOOT_REQUIRED:
		return to == MP716_ST_BOOT_VERIFYING;
	case MP716_ST_BOOT_VERIFYING:
		return to == MP716_ST_SUCCESS;
	case MP716_ST_SUCCESS:
		return to == MP716_ST_UPLOADING;
	case MP716_ST_FAILED:
		return to == MP716_ST_UPLOADING || to == MP716_ST_IDLE;
	default:
		return 0;
	}
}

void mp716_state_init(struct mp716_state *state)
{
	memset(state, 0, sizeof(*state));
	state->id = MP716_ST_IDLE;
	snprintf(state->name, sizeof(state->name), "IDLE");
	snprintf(state->error, sizeof(state->error), "ok");
}

int mp716_state_load(const char *path, struct mp716_state *state)
{
	FILE *fp;
	char line[256];

	mp716_state_init(state);
	fp = fopen(path, "rb");
	if (!fp)
		return MP716_OK;
	while (fgets(line, sizeof(line), fp)) {
		char *eq;
		size_t n = strlen(line);
		while (n && (line[n - 1] == '\n' || line[n - 1] == '\r'))
			line[--n] = 0;
		eq = strchr(line, '=');
		if (!eq)
			continue;
		*eq = 0;
		if (strcmp(line, "state") == 0) {
			int id = mp716_state_id(eq + 1);
			if (id < 0) {
				fclose(fp);
				return MP716_ERR_STATE;
			}
			state->id = id;
			snprintf(state->name, sizeof(state->name), "%s", eq + 1);
		} else if (strcmp(line, "code") == 0) {
			state->code = atoi(eq + 1);
		} else if (strcmp(line, "error") == 0) {
			snprintf(state->error, sizeof(state->error), "%s", eq + 1);
		} else if (strcmp(line, "detail") == 0) {
			snprintf(state->detail, sizeof(state->detail), "%s", eq + 1);
		} else if (strcmp(line, "expected_custom_firmware") == 0) {
			snprintf(state->expected_custom_firmware, sizeof(state->expected_custom_firmware), "%s", eq + 1);
		} else if (strcmp(line, "payload_sha256") == 0) {
			snprintf(state->payload_sha256, sizeof(state->payload_sha256), "%s", eq + 1);
		} else if (strcmp(line, "bytes_programmed") == 0) {
			state->bytes_programmed = (uint32_t)strtoul(eq + 1, NULL, 10);
		} else if (strcmp(line, "erased") == 0) {
			state->erased = atoi(eq + 1);
		} else if (strcmp(line, "unrecoverable") == 0) {
			state->unrecoverable = atoi(eq + 1);
		}
	}
	fclose(fp);
	return MP716_OK;
}

int mp716_state_store(const char *path, const struct mp716_state *state)
{
	char tmp[320];
	FILE *fp;
	int wrote;

	wrote = snprintf(tmp, sizeof(tmp), "%s.tmp", path);
	if (wrote < 0 || (size_t)wrote >= sizeof(tmp))
		return MP716_ERR_PATH;
	fp = fopen(tmp, "wb");
	if (!fp)
		return MP716_ERR_IO;
	fprintf(fp, "state=%s\n", state->name);
	fprintf(fp, "code=%d\n", state->code);
	fprintf(fp, "error=%s\n", state->error);
	fprintf(fp, "detail=%s\n", state->detail);
	fprintf(fp, "expected_custom_firmware=%s\n", state->expected_custom_firmware);
	fprintf(fp, "payload_sha256=%s\n", state->payload_sha256);
	fprintf(fp, "bytes_programmed=%u\n", state->bytes_programmed);
	fprintf(fp, "erased=%d\n", state->erased);
	fprintf(fp, "unrecoverable=%d\n", state->unrecoverable);
	if (fclose(fp) != 0)
		return MP716_ERR_IO;
	return mp716_replace_file(tmp, path);
}

int mp716_state_transition(struct mp716_state *state, int to, int code, const char *detail)
{
	if (!mp716_state_can(state->id, to))
		return MP716_ERR_STATE;
	state->id = to;
	snprintf(state->name, sizeof(state->name), "%s", mp716_state_name(to));
	state->code = code;
	snprintf(state->error, sizeof(state->error), "%s", mp716_error_name(code));
	snprintf(state->detail, sizeof(state->detail), "%s", detail ? detail : "");
	return MP716_OK;
}

static void json_escape(char *out, size_t cap, const char *in)
{
	size_t used = 0;
	if (!in)
		in = "";
	while (*in && used + 2 < cap) {
		unsigned char c = (unsigned char)*in++;
		if (c == '"' || c == '\\') {
			out[used++] = '\\';
			out[used++] = (char)c;
		} else if (c == '\n') {
			out[used++] = '\\';
			out[used++] = 'n';
		} else if (c >= 0x20) {
			out[used++] = (char)c;
		}
	}
	out[used] = 0;
}

int mp716_history_append(const char *path, const struct mp716_report *report)
{
	FILE *fp;
	char detail[400];

	json_escape(detail, sizeof(detail), report->detail);
	fp = fopen(path, "ab");
	if (!fp)
		return MP716_ERR_IO;
	fprintf(fp, "{\"state\":\"%s\",\"code\":%d,\"error\":\"%s\",\"detail\":\"%s\",\"at\":%lld}\n",
		report->state, report->code, report->error, detail, (long long)time(NULL));
	fclose(fp);
	return MP716_OK;
}
