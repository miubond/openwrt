#!/usr/bin/env ucode
'use strict';

import { connect } from 'ubus';
import { popen, stdin, writefile, unlink, chmod, stat } from 'fs';
import { cursor } from 'uci';
import { firmware_version, firmware_build_date } from '/usr/share/mp716/build-meta.uc';
import { route_native } from '/usr/share/mp716/dispatch.uc';
import { capabilities } from '/usr/share/mp716/capabilities.uc';
import { perf_enabled, perf_begin, perf_monotonic_ms, perf_shell_ms, perf_log,
	perf_set_ubus_connect_ms, perf_set_session_access_ms } from '/usr/share/mp716/perf-diag.uc';

function reply(status, body) {
	printf('Status: %d %s\r\nContent-Type: application/json\r\n\r\n%J\n',
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

const FIRMWARE_VERIFY_MAX_BYTES = 8060928;

function firmware_verifier_present() {
	return !!(stat('/usr/sbin/mp716-upgraded') || stat('/usr/sbin/mp716-package-verify'));
}

function firmware_flash_allowed() {
	return !!stat('/etc/mp716/allow-flash-upgrade');
}

function firmware_info_payload() {
	let upload = firmware_verifier_present();
	let flash = upload && firmware_flash_allowed();
	return {
		currentVersion: firmware_version(), buildDate: firmware_build_date(), hardware: 'MP716',
		canUpgrade: upload, flashUpgradeEnabled: flash,
		validationOnly: upload && !flash,
		maxBytes: FIRMWARE_VERIFY_MAX_BYTES, maxSizeLabel: '8M',
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

function verify() {
	if (!firmware_verifier_present())
		return fail(404, 'NOT_IMPLEMENTED', '设备未安装固件校验器');
	let size = int(getenv('CONTENT_LENGTH') || '0');
	if (size <= 0)
		return fail(400, 'VALIDATION', '请选择固件文件');
	if (size > FIRMWARE_VERIFY_MAX_BYTES)
		return fail(400, 'VALIDATION', '固件文件不能超过 8M');
	let path = '/tmp/mp716-firmware-verify-' + sprintf('%x', time()) + '.mp716upd';
	let raw = stdin.read(size);
	if (length(raw) != size)
		return fail(400, 'VALIDATION', '固件上传不完整');
	writefile(path, raw);
	chmod(path, 0600);
	let out = verify_firmware_report(path);
	unlink(path);
	if (out.error) return out.error;
	return ok(out.data);
}

function main() {
	let path = split(getenv('REQUEST_URI') || '', '?')[0];
	let method = getenv('REQUEST_METHOD');
	if (index(path,'/cgi-bin/mp716/')!=0) return fail(404,'NOT_IMPLEMENTED','未知接口');
	if (method == 'GET' && path == '/cgi-bin/mp716/auth/prelogin') {
		let c = cursor();
		let firstBoot = c.get('system', '@system[0]', 'mp716_wizard_complete') == '0' ? 1 : 0;
		return ok({ firstBoot: firstBoot, needAuthorized: 1 });
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
	let t_session = perf_enabled() ? perf_monotonic_ms() : 0;
	let session = ubus.call('session', 'access', {
		ubus_rpc_session: token, scope: 'ubus', object: 'mp716', function: '*',
	});
	if (t_session) perf_set_session_access_ms(perf_monotonic_ms() - t_session);
	if (session?.access != true)
		return fail(401, 'UNAUTHORIZED', '会话无效或已过期');
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
			hardwareValidated: false, flashUpgradeEnabled: false });
	}
	if (method == 'GET' && path == '/cgi-bin/mp716/system/firmware')
		return ok(firmware_info_payload());
	if (method == 'POST' && path == '/cgi-bin/mp716/system/firmware-package/verify')
		return verify();
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
	let t0 = perf_enabled() ? perf_monotonic_ms() : 0;
	if (perf_enabled()) perf_begin(substr(token, 0, 8), api_path);
	try {
		let result = route_native(ubus, method, api_path, body, token);
		if (result?.error) return fail(result.error == 'DEVICE_BUSY' ? 409 : result.error == 'NOT_IMPLEMENTED' ? 404 : 400, result.error, result.message);
		if (result != null) {
			if (t0) {
				let ser0 = perf_monotonic_ms();
				let response = ok(result.data);
				perf_log(api_path, perf_monotonic_ms() - t0, perf_monotonic_ms() - ser0);
				return response;
			}
			return ok(result.data);
		}
	} catch (e) { return fail(500, 'INTERNAL', '设备接口执行失败', { reason: e.message || string(e) }); }
	return fail(404, 'NOT_IMPLEMENTED', '此接口在测试固件中不可用');
}

main();
