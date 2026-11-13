#define _CRT_SECURE_NO_WARNINGS

#include "upgrade_manager.h"

#include "error_codes.h"
#include "system_info.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *option_value(int argc, char **argv, const char *name)
{
	int i;
	for (i = 2; i + 1 < argc; i++) {
		if (strcmp(argv[i], name) == 0)
			return argv[i + 1];
	}
	return NULL;
}

static int option_flag(int argc, char **argv, const char *name)
{
	int i;
	for (i = 2; i < argc; i++) {
		if (strcmp(argv[i], name) == 0)
			return 1;
	}
	return 0;
}

static void usage(void)
{
	fprintf(stderr,
		"usage: mp716-upgraded info|check|verify|apply|recover|boot-verify|status|history|reset|error-name ...\n"
		"check --image FILE [--extract NEW_FILE] verifies the container and can stage its payload.\n"
		"recover restores a separate known-good image onto a .fakemtd file after FAILED;\n"
		"it is not automatic rollback. real flash writes and --allow-flash-upgrade are refused\n");
}

int main(int argc, char **argv)
{
	struct mp716_paths paths;
	struct mp716_report report;
	const char *root;
	const char *command;
	int rc;

	if (argc < 2) {
		usage();
		return MP716_ERR_USAGE;
	}
	command = argv[1];
	mp716_report_init(&report, command);
	if (mp716_argv_rejected(argc, argv, &report)) {
		mp716_report_write_json(stdout, &report);
		return report.code;
	}
	if (strcmp(command, "error-name") == 0) {
		int code = argc >= 3 ? atoi(argv[2]) : -1;
		printf("{\"code\":%d,\"error\":\"%s\"}\n", code, mp716_error_name(code));
		return MP716_OK;
	}
	root = option_value(argc, argv, "--root");
	if (option_flag(argc, argv, "--root") && !root) {
		mp716_report_fail(&report, MP716_ERR_USAGE, "missing --root");
		mp716_report_write_json(stdout, &report);
		return MP716_ERR_USAGE;
	}
	rc = root ? mp716_paths_from_root(&paths, root) : mp716_paths_device(&paths);
	if (rc != MP716_OK) {
		mp716_report_fail(&report, rc, "runtime root is not usable");
		mp716_report_write_json(stdout, &report);
		return rc;
	}
	if (option_value(argc, argv, "--meminfo"))
		snprintf(paths.meminfo, sizeof(paths.meminfo), "%s", option_value(argc, argv, "--meminfo"));
	if (strcmp(command, "info") == 0)
		rc = mp716_cmd_info(&paths, &report);
	else if (strcmp(command, "check") == 0) {
		const char *payload_path = option_value(argc, argv, "--extract");
		const char *pending_path = option_value(argc, argv, "--pending-state");
		const char *meminfo = option_value(argc, argv, "--meminfo");
		if (option_flag(argc, argv, "--extract") && !payload_path) {
			mp716_report_fail(&report, MP716_ERR_USAGE, "missing extraction path");
			mp716_report_write_json(stdout, &report);
			return MP716_ERR_USAGE;
		}
		if (option_flag(argc, argv, "--pending-state") && (!pending_path || !payload_path)) {
			mp716_report_fail(&report, MP716_ERR_USAGE, "--pending-state requires a path and --extract");
			mp716_report_write_json(stdout, &report);
			return MP716_ERR_USAGE;
		}
		rc = mp716_cmd_check(&paths, option_value(argc, argv, "--image"),
				     payload_path || option_flag(argc, argv, "--require-memory") ? paths.meminfo : meminfo,
				     option_flag(argc, argv, "--allow-downgrade"), payload_path, pending_path, &report);
	} else if (strcmp(command, "status") == 0)
		rc = mp716_cmd_status(&paths, &report);
	else if (strcmp(command, "history") == 0)
		return mp716_history_write(stdout, paths.history);
	else if (strcmp(command, "reset") == 0)
		rc = mp716_cmd_reset(&paths, &report);
	else if (strcmp(command, "verify") == 0)
		rc = mp716_cmd_verify(&paths, option_flag(argc, argv, "--allow-downgrade"), &report);
	else if (strcmp(command, "boot-verify") == 0)
		rc = mp716_cmd_boot_verify(&paths, &report);
	else if (strcmp(command, "apply") == 0)
		rc = mp716_cmd_apply(&paths, option_value(argc, argv, "--backend"), option_value(argc, argv, "--fakemtd"),
				     option_value(argc, argv, "--runtime-path"), option_flag(argc, argv, "--allow-downgrade"),
				     option_flag(argc, argv, "--lock-inherited"), &report);
	else if (strcmp(command, "recover") == 0)
		rc = mp716_cmd_recover(&paths, option_value(argc, argv, "--backend"), option_value(argc, argv, "--fakemtd"),
				       option_value(argc, argv, "--known-good"), option_value(argc, argv, "--runtime-path"), &report);
	else {
		usage();
		mp716_report_fail(&report, MP716_ERR_USAGE, "unknown command");
		rc = MP716_ERR_USAGE;
	}
	mp716_report_write_json(stdout, &report);
	return rc;
}
