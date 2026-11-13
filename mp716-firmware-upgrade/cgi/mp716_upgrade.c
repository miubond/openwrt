#define _CRT_SECURE_NO_WARNINGS

#include "upgrade_manager.h"

#include "error_codes.h"
#include "mp716_format.h"
#include "mp716_port.h"
#include "system_info.h"
#include "upgrade_state.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#else
#include <unistd.h>
#endif

static void send_json(const struct mp716_report *report)
{
	int status = mp716_http_status(report->code);
	const char *text = status == 200 ? "OK" : status == 403 ? "Forbidden" : status == 409 ? "Conflict" : status == 413 ? "Payload Too Large" : "Bad Request";
	printf("Status: %d %s\r\n", status, text);
	printf("Content-Type: application/json\r\n");
	printf("Cache-Control: no-store\r\n\r\n");
	mp716_report_write_json(stdout, report);
}

static int constant_equal(const char *left, const char *right)
{
	size_t left_len = left ? strlen(left) : 0;
	size_t right_len = right ? strlen(right) : 0;
	size_t n = left_len > right_len ? left_len : right_len;
	unsigned diff = (unsigned)(left_len ^ right_len);
	size_t i;
	for (i = 0; i < n; i++) {
		unsigned a = i < left_len ? (unsigned char)left[i] : 0;
		unsigned b = i < right_len ? (unsigned char)right[i] : 0;
		diff |= a ^ b;
	}
	return diff == 0;
}

static int private_remote(const char *ip)
{
	int part[4];
	int index = 0;
	int value = 0;
	int digits = 0;
	if (!ip)
		return 0;
	if (strcmp(ip, "::1") == 0)
		return 1;
	for (; ; ip++) {
		if (*ip >= '0' && *ip <= '9') {
			if (value == 0 && digits > 0)
				return 0;
			value = value * 10 + (*ip - '0');
			if (value > 255 || ++digits > 3)
				return 0;
		} else if (*ip == '.' || *ip == 0) {
			if (digits == 0 || index >= 4)
				return 0;
			part[index++] = value;
			value = 0;
			digits = 0;
			if (*ip == 0)
				break;
		} else {
			return 0;
		}
	}
	if (index != 4)
		return 0;
	if (part[0] == 127 || part[0] == 10)
		return 1;
	if (part[0] == 192 && part[1] == 168)
		return 1;
	if (part[0] == 172 && part[1] >= 16 && part[1] <= 31)
		return 1;
	return 0;
}

/* The factory Set-Cookie name and its server-side session store were not
 * identified. A Cookie header by itself is not an administrator session. */
static int vendor_session(void)
{
	return MP716_ERR_AUTH_UNAVAILABLE;
}

static int load_mode(const char *path, char *mode, size_t mode_len)
{
	FILE *fp = fopen(path, "rb");
	size_t n;
	if (!fp)
		return -1;
	if (!fgets(mode, (int)mode_len, fp)) {
		fclose(fp);
		return -1;
	}
	fclose(fp);
	n = strlen(mode);
	while (n && (mode[n - 1] == '\n' || mode[n - 1] == '\r'))
		mode[--n] = 0;
	return 0;
}

#ifdef MP716_HOST
static int test_session(const struct mp716_paths *paths, const char *method, char *role, size_t role_len)
{
	FILE *fp;
	char line[256];
	char token[128];
	const char *cookie;
	const char *found = NULL;
	token[0] = 0;
	role[0] = 0;
	fp = fopen(paths->session, "rb");
	if (!fp)
		return MP716_ERR_AUTH;
	while (fgets(line, sizeof(line), fp)) {
		size_t n = strlen(line);
		while (n && (line[n - 1] == '\n' || line[n - 1] == '\r'))
			line[--n] = 0;
		if (strncmp(line, "token=", 6) == 0)
			snprintf(token, sizeof(token), "%s", line + 6);
		else if (strncmp(line, "role=", 5) == 0)
			snprintf(role, role_len, "%s", line + 5);
	}
	fclose(fp);
	cookie = getenv("HTTP_COOKIE");
	if (cookie) {
		const char *p = cookie;
		while (*p) {
			while (*p == ' ' || *p == ';')
				p++;
			if (strncmp(p, "mp716_test_session=", 19) == 0) {
				found = p + 19;
				break;
			}
			while (*p && *p != ';')
				p++;
		}
	}
	if (!found)
		return MP716_ERR_AUTH;
	{
		char presented[128];
		size_t n = 0;
		while (found[n] && found[n] != ';' && found[n] != ' ' && n + 1 < sizeof(presented)) {
			presented[n] = found[n];
			n++;
		}
		presented[n] = 0;
		if (!constant_equal(presented, token))
			return MP716_ERR_AUTH;
	}
	if (strcmp(role, "admin") != 0 && strcmp(role, "viewer") != 0)
		return MP716_ERR_AUTH;
	if (strcmp(method, "POST") == 0 && strcmp(role, "admin") != 0)
		return MP716_ERR_FORBIDDEN;
	return MP716_OK;
}
#endif

static int authenticate(const struct mp716_paths *paths, const char *method, char *role, size_t role_len)
{
	char mode[64];
	if (load_mode(paths->auth_mode, mode, sizeof(mode)) != 0 || strcmp(mode, "deny") == 0)
		return MP716_ERR_AUTH_UNAVAILABLE;
#ifdef MP716_HOST
	if (strcmp(mode, "test") == 0)
		return test_session(paths, method, role, role_len);
#else
	(void)method;
	(void)role;
	(void)role_len;
#endif
	return vendor_session();
}

static int parse_op(const char *path_info, const char *query, char *op, size_t op_len, int *path_error)
{
	const char *segment = NULL;
	*path_error = 0;
	op[0] = 0;
	if (path_info && path_info[0]) {
		segment = strrchr(path_info, '/');
		segment = segment ? segment + 1 : path_info;
		if (segment[0] == 0) {
			*path_error = 1;
			return -1;
		}
	}
	if (query && query[0]) {
		const char *cursor = query;
		int saw_op = 0;
		while (*cursor) {
			const char *amp = strchr(cursor, '&');
			size_t len = amp ? (size_t)(amp - cursor) : strlen(cursor);
			if (len < 3 || memcmp(cursor, "op=", 3) != 0 || saw_op) {
				*path_error = 1;
				return -1;
			}
			saw_op = 1;
			if (!segment) {
				if (len - 3 >= op_len) {
					*path_error = 1;
					return -1;
				}
				memcpy(op, cursor + 3, len - 3);
				op[len - 3] = 0;
			}
			cursor = amp ? amp + 1 : cursor + len;
		}
	}
	if (segment) {
		if (strlen(segment) >= op_len) {
			*path_error = 1;
			return -1;
		}
		snprintf(op, op_len, "%s", segment);
	}
	if (!op[0])
		return -1;
	{
		const char *p;
		for (p = op; *p; p++) {
			if (*p < 'a' || *p > 'z') {
				*path_error = 1;
				return -1;
			}
		}
	}
	return 0;
}

static int known_op(const char *op)
{
	return strcmp(op, "info") == 0 || strcmp(op, "upload") == 0 || strcmp(op, "verify") == 0 ||
	       strcmp(op, "start") == 0 || strcmp(op, "status") == 0 || strcmp(op, "history") == 0;
}

#ifdef MP716_HOST
static int spawn_apply(const struct mp716_paths *paths)
{
	char fakemtd[300];
	const char *exe = getenv("MP716_UPGRADED_BIN");
	if (!exe || !exe[0] || mp716_join(fakemtd, sizeof(fakemtd), paths->root, "firmware.fakemtd") != MP716_OK)
		return MP716_ERR_IO;
#ifdef _WIN32
	{
		char cmd[1400];
		STARTUPINFOA startup;
		PROCESS_INFORMATION process;
		ZeroMemory(&startup, sizeof(startup));
		startup.cb = sizeof(startup);
		snprintf(cmd, sizeof(cmd), "\"%s\" apply --root \"%s\" --backend fake --fakemtd \"%s\" --runtime-path \"%s\" --lock-inherited",
			 exe, paths->root, fakemtd, exe);
		if (!CreateProcessA(exe, cmd, NULL, NULL, FALSE, DETACHED_PROCESS | CREATE_NO_WINDOW, NULL, NULL, &startup, &process))
			return MP716_ERR_IO;
		CloseHandle(process.hThread);
		CloseHandle(process.hProcess);
	}
#else
	{
		pid_t pid = fork();
		if (pid < 0)
			return MP716_ERR_IO;
		if (pid == 0) {
			setsid();
			execl(exe, exe, "apply", "--root", paths->root, "--backend", "fake", "--fakemtd", fakemtd,
			      "--runtime-path", exe, "--lock-inherited", (char *)NULL);
			_exit(127);
		}
	}
#endif
	return MP716_OK;
}
#endif

int main(void)
{
	struct mp716_paths paths;
	struct mp716_report report;
	const char *method = getenv("REQUEST_METHOD");
	const char *remote = getenv("REMOTE_ADDR");
	char op[32];
	char role[16];
	int path_error = 0;
	int rc;

#ifdef _WIN32
	_setmode(_fileno(stdin), _O_BINARY);
	_setmode(_fileno(stdout), _O_BINARY);
#endif
	mp716_report_init(&report, "cgi");
#ifdef MP716_HOST
	if (!getenv("MP716_RUNTIME_ROOT") || mp716_paths_from_root(&paths, getenv("MP716_RUNTIME_ROOT")) != MP716_OK) {
		mp716_report_fail(&report, MP716_ERR_IO, "test runtime root is missing");
		send_json(&report);
		return MP716_ERR_IO;
	}
#else
	if (mp716_paths_device(&paths) != MP716_OK) {
		mp716_report_fail(&report, MP716_ERR_IO, "device paths are not available");
		send_json(&report);
		return MP716_ERR_IO;
	}
#endif
	if (!private_remote(remote)) {
		mp716_report_fail(&report, MP716_ERR_FORBIDDEN, "upgrade CGI is not available from this address");
		send_json(&report);
		return MP716_ERR_FORBIDDEN;
	}
	rc = authenticate(&paths, method ? method : "", role, sizeof(role));
	if (rc != MP716_OK) {
		mp716_report_fail(&report, rc, rc == MP716_ERR_FORBIDDEN ? "role cannot perform this action" : "administrator session is not available");
		send_json(&report);
		return rc;
	}
	if (parse_op(getenv("PATH_INFO"), getenv("QUERY_STRING"), op, sizeof(op), &path_error) != 0 || !known_op(op)) {
		mp716_report_fail(&report, path_error ? MP716_ERR_PATH : MP716_ERR_USAGE, path_error ? "request path is not allowed" : "unknown upgrade operation");
		send_json(&report);
		return report.code;
	}
	snprintf(report.command, sizeof(report.command), "%s", op);
	if (strcmp(method ? method : "", "POST") == 0) {
		const char *csrf = getenv("HTTP_X_MP716_UPGRADE");
		if (!csrf || strcmp(csrf, "1") != 0) {
			mp716_report_fail(&report, MP716_ERR_CSRF, "missing upgrade CSRF header");
			send_json(&report);
			return MP716_ERR_CSRF;
		}
	}
	if ((strcmp(op, "info") == 0 || strcmp(op, "status") == 0 || strcmp(op, "history") == 0) && strcmp(method ? method : "", "GET") != 0) {
		mp716_report_fail(&report, MP716_ERR_USAGE, "method is not allowed");
		send_json(&report);
		return MP716_ERR_USAGE;
	}
	if ((strcmp(op, "upload") == 0 || strcmp(op, "verify") == 0 || strcmp(op, "start") == 0) && strcmp(method ? method : "", "POST") != 0) {
		mp716_report_fail(&report, MP716_ERR_USAGE, "method is not allowed");
		send_json(&report);
		return MP716_ERR_USAGE;
	}
	if (strcmp(op, "info") == 0)
		rc = mp716_cmd_info(&paths, &report);
	else if (strcmp(op, "status") == 0)
		rc = mp716_cmd_status(&paths, &report);
	else if (strcmp(op, "history") == 0) {
		printf("Status: 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n");
		return mp716_history_write(stdout, paths.history);
	} else if (strcmp(op, "verify") == 0)
		rc = mp716_cmd_verify(&paths, 0, &report);
	else if (strcmp(op, "upload") == 0) {
		const char *type = getenv("CONTENT_TYPE");
		const char *length_text = getenv("CONTENT_LENGTH");
		long length;
		if (!type || strncmp(type, "application/octet-stream", 24) != 0 || (type[24] != 0 && type[24] != '\0')) {
			mp716_report_fail(&report, MP716_ERR_FORMAT, "upload must be application/octet-stream");
			send_json(&report);
			return MP716_ERR_FORMAT;
		}
		length = length_text ? strtol(length_text, NULL, 10) : -1;
		rc = mp716_cmd_upload(&paths, stdin, length, &report);
	} else if (strcmp(op, "start") == 0) {
		struct mp716_state state;
#ifdef MP716_HOST
		rc = mp716_state_load(paths.state_path, &state);
		if (rc != MP716_OK || state.id != MP716_ST_READY) {
			mp716_report_fail(&report, MP716_ERR_STATE, "start requires a verified image");
		} else if (mp716_exclusive_create(paths.lock_path) != MP716_OK) {
			mp716_report_fail(&report, MP716_ERR_BUSY, "another upgrade task holds the lock");
		} else if (spawn_apply(&paths) != MP716_OK) {
			mp716_remove_file(paths.lock_path);
			mp716_report_fail(&report, MP716_ERR_IO, "upgrade worker could not be started");
		} else {
			report.code = MP716_OK;
			snprintf(report.error, sizeof(report.error), "ok");
			snprintf(report.detail, sizeof(report.detail), "accepted");
			snprintf(report.state, sizeof(report.state), "READY");
			report.accepted = 1;
			report.upgraded = 0;
			rc = MP716_OK;
		}
		rc = report.code;
#else
		(void)state;
		mp716_report_fail(&report, MP716_ERR_FLASH_DISABLED, "real flash backend is not linked");
		rc = MP716_ERR_FLASH_DISABLED;
#endif
	} else {
		mp716_report_fail(&report, MP716_ERR_USAGE, "unknown upgrade operation");
		rc = MP716_ERR_USAGE;
	}
	send_json(&report);
	return rc;
}
