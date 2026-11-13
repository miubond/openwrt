#ifndef MP716_UPGRADE_MANAGER_H
#define MP716_UPGRADE_MANAGER_H

#include <stdio.h>

#include "system_info.h"

struct mp716_paths {
	char root[260];
	char image[300];
	char state_path[300];
	char history[300];
	char profile[300];
	char pubkey[300];
	char auth_mode[300];
	char session[300];
	char lock_path[300];
	char meminfo[300];
};

int mp716_paths_from_root(struct mp716_paths *paths, const char *root);
int mp716_paths_device(struct mp716_paths *paths);
int mp716_history_write(FILE *fp, const char *path);
int mp716_argv_rejected(int argc, char **argv, struct mp716_report *report);

int mp716_cmd_info(const struct mp716_paths *paths, struct mp716_report *report);
int mp716_cmd_check(const char *image, const char *pubkey, const char *profile_path, const char *meminfo,
		    int operator_allow_downgrade, struct mp716_report *report);
int mp716_cmd_status(const struct mp716_paths *paths, struct mp716_report *report);
int mp716_cmd_history(const struct mp716_paths *paths, struct mp716_report *report);
int mp716_cmd_reset(const struct mp716_paths *paths, struct mp716_report *report);
int mp716_cmd_verify(const struct mp716_paths *paths, int operator_allow_downgrade, struct mp716_report *report);
int mp716_cmd_apply(const struct mp716_paths *paths, const char *backend, const char *fakemtd, const char *runtime_path,
		    int operator_allow_downgrade, int lock_inherited, struct mp716_report *report);
int mp716_cmd_recover(const struct mp716_paths *paths, const char *backend, const char *fakemtd, const char *known_good,
		      const char *runtime_path, struct mp716_report *report);
int mp716_cmd_boot_verify(const struct mp716_paths *paths, struct mp716_report *report);
int mp716_cmd_upload(const struct mp716_paths *paths, FILE *body, long content_length, struct mp716_report *report);

#endif
