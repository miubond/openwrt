'use strict';
import { readfile, writefile, stat } from 'fs';

const LOG = '/tmp/mp716-perf.log';
let shell_ms = 0;
let route = '';
let request_id = '';
let ubus_connect_ms = 0;
let session_access_ms = 0;

export function perf_enabled() {
	if (getenv('MP716_PERF_DIAG') == '1') return true;
	if (stat('/etc/mp716-admin/perf-diag')) return true;
	return false;
};

export function perf_monotonic_ms() {
	let parts = split(trim(readfile('/proc/uptime') || '0'), ' ');
	if (!length(parts)) return 0;
	return int(+(parts[0]) * 1000);
};

export function perf_begin(id, path) {
	request_id = id || 'anon';
	route = path || '';
	shell_ms = 0;
	ubus_connect_ms = 0;
	session_access_ms = 0;
};

export function perf_add_shell(ms) {
	if (type(ms) == 'int' && ms > 0) shell_ms += ms;
};

export function perf_shell_ms() {
	return shell_ms;
};

export function perf_set_ubus_connect_ms(ms) {
	if (type(ms) == 'int' && ms >= 0) ubus_connect_ms = ms;
};

export function perf_set_session_access_ms(ms) {
	if (type(ms) == 'int' && ms >= 0) session_access_ms = ms;
};

function safe_route(path) {
	if (type(path) != 'string') return '';
	return replace(replace(path, '\n', ''), '\r', '');
};

export function perf_log(path, total_ms, serialization_ms) {
	if (!perf_enabled()) return;
	let handler_ms = int(total_ms || 0) - int(shell_ms || 0) - int(serialization_ms || 0)
		- int(ubus_connect_ms || 0) - int(session_access_ms || 0);
	if (handler_ms < 0) handler_ms = 0;
	let line = sprintf(
		'perf request_id=%s route=%s total_ms=%d ubus_connect_ms=%d session_access_ms=%d handler_ms=%d system_command_ms=%d serialization_ms=%d\n',
		request_id,
		safe_route(path || route),
		int(total_ms || 0),
		int(ubus_connect_ms || 0),
		int(session_access_ms || 0),
		handler_ms,
		int(shell_ms || 0),
		int(serialization_ms || 0)
	);
	writefile(LOG, (readfile(LOG) || '') + line);
};