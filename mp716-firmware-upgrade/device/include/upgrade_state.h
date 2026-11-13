#ifndef MP716_UPGRADE_STATE_H
#define MP716_UPGRADE_STATE_H

#include "system_info.h"

enum {
	MP716_ST_IDLE = 0,
	MP716_ST_UPLOADING,
	MP716_ST_VERIFYING,
	MP716_ST_READY,
	MP716_ST_APPLYING,
	MP716_ST_REBOOT_REQUIRED,
	MP716_ST_BOOT_VERIFYING,
	MP716_ST_SUCCESS,
	MP716_ST_FAILED
};

struct mp716_state {
	int id;
	char name[32];
	int code;
	char error[32];
	char detail[180];
	char expected_custom_firmware[24];
	char payload_sha256[65];
	uint32_t bytes_programmed;
	int erased;
	int unrecoverable;
};

const char *mp716_state_name(int id);
int mp716_state_id(const char *name);
int mp716_state_can(int from, int to);
void mp716_state_init(struct mp716_state *state);
int mp716_state_load(const char *path, struct mp716_state *state);
int mp716_state_store(const char *path, const struct mp716_state *state);
int mp716_state_transition(struct mp716_state *state, int to, int code, const char *detail);
int mp716_history_append(const char *path, const struct mp716_report *report);

#endif
