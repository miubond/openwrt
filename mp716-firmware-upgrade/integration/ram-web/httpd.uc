#!/usr/bin/env ucode
'use strict';

import { connect } from 'ubus';
import { popen, stdin, writefile, unlink, chmod, stat, readfile, mkdir } from 'fs';
import { cursor } from 'uci';
import { firmware_version, firmware_build_date } from '/usr/share/mp716/build-meta.uc';
import { FIRMWARE_MAX_BYTES, stream_firmware_upload, job_status_payload, reverify_job_image, job_get, job_mark_phase, firmware_capacity_check, job_clear_apply_result, with_job_lock, job_can_apply, firmware_boot_result } from '/usr/share/mp716/firmware-job.uc';
import { firmware_verifier_present, firmware_flash_allowed, firmware_policy_payload, flash_gate_confirmed, upgrade_policy } from '/usr/share/mp716/upgrade-policy.uc';
import { route_native } from '/usr/share/mp716/dispatch.uc';
import { system_action_status } from '/usr/share/mp716/system-admin.uc';
import { capabilities } from '/usr/share/mp716/capabilities.uc';
import { perf_enabled, perf_begin, perf_monotonic_ms, perf_shell_ms, perf_log, perf_set_ubus_connect_ms, perf_set_session_access_ms } from '/usr/share/mp716/perf-diag.uc';

function reply(status, body) {
	printf('Status: %d %s\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n\r\n%J\n',
		status, status == 200 ? 'OK' : 'Error', body);
}

function ok(data) {
	reply(200, { ok: true, data: data, ts: time() });
}

function fail(status, code, message, details) {
	reply(status, { ok: false, code: code, message: message, details: details, ts: time() });
}

function login(ubus) {
	let content_length = int(getenv('CONTENT_LENGTH') || '0');
	if (content_length <= 0 || content_length > 4096)
		return fail(400, 'VALIDATION', '登录请求无效');
	let credentials;
	try {
		credentials = json(stdin.read(content_length));
	} catch (e) {
		return fail(400, 'VALIDATION', '登录请求无效');
	}
	let name = credentials?.username;
	let password = credentials?.password;
	if ((name != 'admin' && name != 'root') || type(password) != 'string' || !length(password))
		return fail(401, 'UNAUTHORIZED', '用户名或密码错误');
	let session = ubus.call('session', 'login', {
		scope: 'access',
		username: 'root',
		password: password,
		timeout: 600,
	});
	if (!session?.ubus_rpc_session)
		return fail(401, 'UNAUTHORIZED', '用户名或密码错误');
	ubus.call('session', 'set', {
		ubus_rpc_session: session.ubus_rpc_session,
		values: { username: name, token: session.ubus_rpc_session },
		acls: ['mp716-admin'],
	});
	return ok({ token: session.ubus_rpc_session, expiresIn: session.timeout || 600 });
}

const FIRMWARE_VERIFY_MAX_BYTES = FIRMWARE_MAX_BYTES;

function shellquote(v) {
	return "'" + replace(v, "'", "'\\''") + "'";
}

function trim_file(path) {
	let raw = readfile(path);
	return raw ? trim(raw) : '';
}

function firmware_info_payload() {
	let upload = firmware_verifier_present();
	let pol = firmware_policy_payload();
	let payload = {
		currentVersion: firmware_version(), buildDate: firmware_build_date(), hardware: 'MP716',
		canUpgrade: upload, flashUpgradeEnabled: pol.flashUpgradeEnabled,
		validationOnly: pol.validationOnly,
		hardwareValidated: pol.hardwareValidated,
		maxBytes: FIRMWARE_VERIFY_MAX_BYTES, maxSizeLabel: '8M',
		upgradeEngine: 'v2',
	};
	if (pol.upgradePolicy != 'production')
		payload.upgradePolicy = pol.upgradePolicy;
	return payload;
}

function firmware_v2_info_payload() {
	return {
		engine: 'v2',
		model: 'yunxm,mp716',
		flashReal: firmware_flash_allowed(),
		dryRunOnly: !firmware_flash_allowed(),
		upgradePolicy: upgrade_policy(),
		maxBytes: FIRMWARE_VERIFY_MAX_BYTES,
		partitionBytes: FIRMWARE_MAX_BYTES,
	};
}

function parse_verify_output(raw, status) {
	let report;
	try {
		report = json(raw || '');
	} catch (e) {
		return { error: fail(500, 'INTERNAL', '固件校验器返回无效结果') };
	}
	if (status != 0 || report?.ok != true || report?.signature_checked != true || report?.flash_write != false)
		return { error: fail(400, 'VALIDATION', report?.detail || report?.error || '固件校验失败', report) };
	return { data: report };
}

function verify_firmware_report(path) {
	let child = popen('/usr/sbin/mp716-upgraded check --image ' + path, 'r');
	if (child) {
		let raw = child.read('all');
		let status = child.close();
		try {
			json(raw || '');
			return parse_verify_output(raw, status);
		} catch (e) { /* fall through to legacy verifier */ }
	}
	child = popen('sh -c "/usr/sbin/mp716-package-verify < ' + path + '"', 'r');
	if (!child)
		return { error: fail(500, 'INTERNAL', '无法启动固件校验器') };
	return parse_verify_output(child.read('all'), child.close());
}

function query_value(name) {
	for (let part in split(getenv('QUERY_STRING') || '', '&')) {
		let kv = split(part, '=');
		if (kv[0] == name) return kv[1] || '';
	}
	return null;
}

function firmware_upload_mode() {
	// uhttpd does not forward custom X- headers to CGI. The query string does arrive.
	let mode = lc(trim(query_value('mode') || getenv('HTTP_X_MP716_UPGRADE_MODE') || getenv('HTTP_X_MP716_FLASH') || 'verify'));
	if (index(['1', 'true', 'flash', 'apply'], mode) >= 0)
		return 'flash';
	return 'verify';
}

function firmware_keep_settings() {
	let q = query_value('keep');
	let v = lc(trim(q != null ? q : (getenv('HTTP_X_MP716_KEEP_SETTINGS') || '1')));
	return index(['0', 'false', 'no'], v) < 0;
}

const APPLY_STAGING_PATH = '/tmp/mp716-firmware-upload-apply.mp716upd';

function apply_firmware_package(path, keep, verify_report, extras) {
	if (!firmware_flash_allowed())
		return { ok: false, status: 403, code: 'FORBIDDEN', message: '固件刷写未开启（生产需 gate+platform；开发需实验室开关）' };
	if (!stat('/usr/sbin/mp716-sysupgrade'))
		return { ok: false, status: 404, code: 'NOT_IMPLEMENTED', message: '未安装 OpenWrt sysupgrade 适配器' };
	let cmd = '/usr/sbin/mp716-sysupgrade apply ' + shellquote(path);
	if (keep)
		cmd += ' --keep-config';
	if (upgrade_policy() == 'laboratory' && stat('/etc/mp716/allow-flash-upgrade') && !flash_gate_confirmed()) {
		let gate = '/tmp/mp716-lab-flash-gate', plat = '/tmp/mp716-lab-platform';
		writefile(gate, 'serial-recovery-verified\n');
		writefile(plat, 'confirmed\n');
		cmd = 'MP716_GATE_FILE=' + shellquote(gate) + ' MP716_PLATFORM_FILE=' + shellquote(plat) + ' ' + cmd;
	}
	let child = popen('/bin/sh -c ' + shellquote(cmd + ' 2>&1'), 'r');
	if (!child)
		return { ok: false, status: 500, code: 'INTERNAL', message: '无法启动固件刷写' };
	let output = child.read('all') || '';
	let status = child.close();
	let async_submit = false;
	try {
		let row = json(trim(output));
		async_submit = row?.detail == 'submitted';
	} catch (e) {}
	if (status == 0) {
		let data = {
			ok: true, code: 0, signature_checked: true, flash_write: true, upgraded: false,
			detail: async_submit ? 'submitted' : 'ok', message: '固件刷写已提交，设备将重启',
		};
		if (type(verify_report) == 'object' && verify_report)
			for (let k, v in verify_report)
				if (k != 'flash_write' && k != 'ok' && k != 'upgraded')
					data[k] = v;
		if (type(extras) == 'object' && extras)
			for (let k, v in extras)
				data[k] = v;
		return { ok: true, data: data, async_submit: async_submit };
	}
	if (stat(path) && !async_submit)
		unlink(path);
	let report;
	try { report = json(output); } catch (e) { report = null; }
	if (report)
		return { ok: false, status: 400, code: 'VALIDATION', message: report.detail || report.error || '固件刷写失败', details: report };
	return { ok: false, status: 400, code: 'VALIDATION', message: trim(output) || '固件刷写失败', details: { output: substr(output, 0, 4096) } };
}

function apply_job_by_id(job_id, keep) {
	let result = with_job_lock(() => apply_locked_job(job_id, keep));
	if (result?.error)
		return fail(result.error.code == 'DEVICE_BUSY' ? 409 : 500, result.error.code, result.error.message);
	return result;
}

function apply_locked_job(job_id, keep) {
	if (!firmware_flash_allowed())
		return fail(403, 'FORBIDDEN', '固件刷写未开启（生产默认仅验证）');
	let job = job_get(job_id);
	if (!job_can_apply(job))
		return fail(400, 'VALIDATION', '升级任务已过期、被替换或已提交');
	let cap = firmware_capacity_check(job.size, 'apply');
	if (!cap.ok) {
		let st = cap.code == 'LOW_TMP' ? 507 : cap.code == 'LOW_MEMORY' ? 507 : 400;
		return fail(st, cap.code || 'VALIDATION', cap.message || '容量不足', cap);
	}
	let rev = reverify_job_image(job);
	if (rev.error)
		return fail(400, 'VALIDATION', rev.error, rev.report);
	job_clear_apply_result();
	job_mark_phase(job_id, 'submitted', { keep: keep == true });
	let result = apply_firmware_package(job.path, keep, rev.report, { job_id: job_id, taskId: job_id });
	if (!result.ok) {
		job_mark_phase(job_id, stat(job.path) ? 'verified' : 'failed', { keep: keep == true });
		return fail(result.status || 400, result.code || 'VALIDATION', result.message || '固件刷写失败', result.details);
	}
	job_mark_phase(job_id, 'applying', { path: APPLY_STAGING_PATH });
	return ok(result.data);
}

function upload_firmware_package() {
	if (!firmware_verifier_present())
		return fail(404, 'NOT_IMPLEMENTED', '设备未安装固件校验器');
	let job_id = trim(query_value('job_id') || '');
	let mode = firmware_upload_mode();
	if (mode == 'flash' && length(job_id)) {
		return apply_job_by_id(job_id, firmware_keep_settings());
	}
	let size = int(getenv('CONTENT_LENGTH') || '0');
	if (size <= 0)
		return fail(400, 'VALIDATION', '请选择固件文件');
	if (size > FIRMWARE_VERIFY_MAX_BYTES)
		return fail(400, 'VALIDATION', '固件文件不能超过 8M');
	let uploaded = stream_firmware_upload(size);
	if (uploaded.error) {
		let e = uploaded.error;
		let code = e.code || 'VALIDATION';
		let status = code == 'LOW_MEMORY' || code == 'LOW_TMP' ? 507 : code == 'DEVICE_BUSY' ? 409 : code == 'INTERNAL' ? 500 : 400;
		return fail(status, code, e.message || '上传失败', e.details || e);
	}
	let job = uploaded.job;
	let report = uploaded.report;
	let data = report;
	data.job_id = job.job_id;
	data.taskId = job.job_id;
	data.flash_write = false;
	if (mode == 'flash') {
		return apply_job_by_id(job.job_id, firmware_keep_settings());
	}
	return ok(data);
}

function firmware_v2_upload() {
	return upload_firmware_package();
}

function firmware_v2_status() {
	let id = trim(query_value('job_id') || query_value('taskId') || '');
	return ok(job_status_payload(id));
}

function firmware_v2_apply(body) {
	let job_id = trim(body?.job_id || body?.taskId || '');
	if (!length(job_id))
		return fail(400, 'VALIDATION', '缺少 job_id');
	let keep = body?.keepSettings != false;
	return apply_job_by_id(job_id, keep);
}

const SESSION_CACHE_DIR = '/tmp/mp716-api-cache';
const SESSION_CACHE_MS = 250;

function session_cache_path(token) {
	return SESSION_CACHE_DIR + '/sess_' + token + '.json';
}

function session_access_cached(token) {
	if (!match(token, /^[0-9a-f]{32}$/)) return null;
	let path = session_cache_path(token);
	if (!stat(path)) return null;
	try {
		let row = json(readfile(path) || '{}');
		if (type(row.at) != 'int' || type(row.ok) != 'bool') return null;
		if (perf_monotonic_ms() - row.at > SESSION_CACHE_MS) return null;
		return row.ok;
	} catch (e) { return null; }
}

function session_access_store(token, ok) {
	if (!stat(SESSION_CACHE_DIR)) mkdir(SESSION_CACHE_DIR, 0755);
	writefile(session_cache_path(token), sprintf('%J', { at: perf_monotonic_ms(), ok: ok == true }));
}

function session_access_invalidate(token) {
	let path = session_cache_path(token);
	if (stat(path)) unlink(path);
}

function session_access(ubus, token, method) {
	let cached = method == 'GET' ? session_access_cached(token) : null;
	if (cached != null) return cached;
	let t_session = perf_enabled() ? perf_monotonic_ms() : 0;
	let session = ubus.call('session', 'access', {
		ubus_rpc_session: token, scope: 'ubus', object: 'mp716', function: '*',
	});
	if (t_session) perf_set_session_access_ms(perf_monotonic_ms() - t_session);
	let granted = session?.access == true;
	if (method == 'GET') session_access_store(token, granted);
	else session_access_invalidate(token);
	return granted;
}

function main() {
	let path = split(getenv('REQUEST_URI') || '', '?')[0];
	let method = getenv('REQUEST_METHOD');
	if (index(path,'/cgi-bin/mp716/')!=0) return fail(404,'NOT_IMPLEMENTED','未知接口');
	if (method == 'GET' && path == '/cgi-bin/mp716/auth/prelogin') {
		let c = cursor();
		let firstBoot = c.get('system', '@system[0]', 'mp716_wizard_complete') == '0' ? 1 : 0;
		return ok({
			firstBoot: firstBoot, needAuthorized: 1,
			bootId: trim(readfile('/proc/sys/kernel/random/boot_id') || ''),
			firmwareVersion: firmware_version(), firmwareBoot: firmware_boot_result(),
			...system_action_status(),
		});
	}
	let t_ubus = perf_enabled() ? perf_monotonic_ms() : 0;
	let ubus = connect();
	if (t_ubus) perf_set_ubus_connect_ms(perf_monotonic_ms() - t_ubus);
	if (!ubus)
		return fail(503, 'INTERNAL', '设备会话服务不可用');
	if (method == 'POST' && path == '/cgi-bin/mp716/auth/login')
		return login(ubus);
	let header = getenv('HTTP_AUTHORIZATION') || '';
	let token = substr(header, 0, 7) == 'Bearer ' ? substr(header, 7) : '';
	if (!match(token, /^[0-9a-f]{32}$/) || token == '00000000000000000000000000000000')
		return fail(401, 'UNAUTHORIZED', '会话无效或已过期');
	if (!session_access(ubus, token, method))
		return fail(401, 'UNAUTHORIZED', '会话无效或已过期');
	writefile('/tmp/mp716-ui-active', '');
	if (method == 'POST')
		session_access_invalidate(token);
	if (method == 'POST' && path == '/cgi-bin/mp716/auth/logout') {
		ubus.call('session', 'destroy', { ubus_rpc_session: token });
		return ok(null);
	}
	if (method == 'GET' && path == '/cgi-bin/mp716/system/ping')
		return ok({ latencyMs: 0 });
	if (method == 'GET' && path == '/cgi-bin/mp716/system/capabilities')
		return ok(capabilities());
	if (method == 'GET' && path == '/cgi-bin/mp716/network/status') {
		let c = cursor();
		let interfaces = {};
		for (let name in ['lan', 'wan']) {
			let status = ubus.call('network.interface.' + name, 'status', {});
			interfaces[name] = {
				available: status != null, up: status?.up == true,
				protocol: status?.proto || c.get('network', name, 'proto'),
				device: status?.l3_device || status?.device || '',
				addresses: status?.['ipv4-address'] || [],
				dns: status?.['dns-server'] || [],
				mtu: int(c.get('network', name, 'mtu') || '1500'),
			};
		}
		return ok({ interfaces: interfaces,
			upnpEnabled: c.get('upnpd', 'config', 'enabled') == '1',
			hardwareValidated: flash_gate_confirmed(),
			flashUpgradeEnabled: firmware_flash_allowed(),
			firmwareVerifyEnabled: firmware_verifier_present() });
	}
	if (method == 'GET' && path == '/cgi-bin/mp716/system/firmware') {
		try {
			return ok(firmware_info_payload());
		} catch (e) {
			return fail(500, 'INTERNAL', '无法读取固件信息', { reason: e.message || sprintf('%s', e) });
		}
	}
	if (method == 'GET' && path == '/cgi-bin/mp716/system/firmware-v2/info')
		return ok(firmware_v2_info_payload());
	if (method == 'GET' && path == '/cgi-bin/mp716/system/firmware-v2/status')
		return firmware_v2_status();
	if (method == 'POST' && path == '/cgi-bin/mp716/system/firmware-package/verify')
		return upload_firmware_package();
	if (method == 'POST' && path == '/cgi-bin/mp716/system/firmware-v2/upload')
		return firmware_v2_upload();
	if (method == 'POST' && path == '/cgi-bin/mp716/system/upgrade')
		return upload_firmware_package();
	let body = {};
	if (method == 'POST') {
		let size = int(getenv('CONTENT_LENGTH') || '0');
		let limit = path == '/cgi-bin/mp716/system/restore' ? 2097152 :
			path == '/cgi-bin/mp716/vpn/openvpn/upload' ? 360448 : 65536;
		if (size < 0 || size > limit) return fail(400, 'VALIDATION', '请求内容过大');
		try { body = size ? json(stdin.read(size)) : {}; }
		catch (e) { return fail(400, 'VALIDATION', '无效的 JSON 请求'); }
		if (type(body) != 'object') return fail(400, 'VALIDATION', '无效的请求对象');
	}
	let api_path = substr(path, length('/cgi-bin/mp716/'));
	if (method == 'GET' && api_path == 'system/logs')
		body.limit = query_value('limit');
	if (method == 'POST' && api_path == 'system/firmware-v2/apply')
		return firmware_v2_apply(body);
	let t0 = perf_enabled() ? perf_monotonic_ms() : 0;
	if (perf_enabled()) perf_begin(substr(token, 0, 8), api_path);
	try {
		let result = route_native(ubus, method, api_path, body, token);
		if (result?.error) {
			let status = { DEVICE_BUSY: 409, NOT_IMPLEMENTED: 404, INTERNAL: 500, TIMEOUT: 504 };
			return fail(status[result.error] || 400, result.error, result.message);
		}
		if (result != null) {
			if (t0) {
				let ser0 = perf_monotonic_ms();
				let response = ok(result.data);
				perf_log(api_path, perf_monotonic_ms() - t0, perf_monotonic_ms() - ser0);
				return response;
			}
			return ok(result.data);
		}
	} catch (e) { return fail(500, 'INTERNAL', '设备接口执行失败', { reason: e.message || sprintf('%s', e) }); }
	return fail(404, 'NOT_IMPLEMENTED', '此接口在测试固件中不可用');
}

main();
