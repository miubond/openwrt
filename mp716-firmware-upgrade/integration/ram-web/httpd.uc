#!/usr/bin/env ucode
'use strict';

import { connect } from 'ubus';
import { popen, stdin } from 'fs';
import { cursor } from 'uci';
import { route_admin } from '/usr/share/mp716/admin.uc';

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
	let session = ubus.call('session', 'login', { username: 'root', password: password, timeout: 600 });
	if (!session?.ubus_rpc_session)
		return fail(401, 'UNAUTHORIZED', '用户名或密码错误');
	return ok({ token: session.ubus_rpc_session, expiresIn: session.timeout || 30 });
}

function verify() {
	let child = popen('/usr/sbin/mp716-package-verify', 'r');
	if (!child)
		return fail(500, 'INTERNAL', '无法启动固件校验器');
	let raw = child.read('all');
	let status = child.close();
	let report;
	try {
		report = json(raw || '');
	} catch (e) {
		return fail(500, 'INTERNAL', '固件校验器返回无效结果');
	}
	if (status != 0 || report?.ok != true || report?.signature_checked != true || report?.flash_write != false)
		return fail(400, 'VALIDATION', report?.detail || '固件校验失败', report);
	return ok(report);
}

function main() {
	let path = split(getenv('REQUEST_URI') || '', '?')[0];
	let method = getenv('REQUEST_METHOD');
	if (method == 'GET' && path == '/cgi-bin/mp716/auth/prelogin')
		return ok({ firstBoot: 0, needAuthorized: 1 });
	let ubus = connect();
	if (!ubus)
		return fail(503, 'INTERNAL', '设备会话服务不可用');
	if (method == 'POST' && path == '/cgi-bin/mp716/auth/login')
		return login(ubus);
	let header = getenv('HTTP_AUTHORIZATION') || '';
	let token = substr(header, 0, 7) == 'Bearer ' ? substr(header, 7) : '';
	if (!match(token, /^[0-9a-f]{32}$/) || token == '00000000000000000000000000000000')
		return fail(401, 'UNAUTHORIZED', '会话无效或已过期');
	let session = ubus.call('session', 'access', {
		ubus_rpc_session: token, scope: 'ubus', object: 'mp716', function: '*',
	});
	if (session?.access != true)
		return fail(401, 'UNAUTHORIZED', '会话无效或已过期');
	if (method == 'POST' && path == '/cgi-bin/mp716/auth/logout') {
		ubus.call('session', 'destroy', { ubus_rpc_session: token });
		return ok(null);
	}
	if (method == 'GET' && path == '/cgi-bin/mp716/system/ping')
		return ok({ latencyMs: 0 });
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
		return ok({ currentVersion: '1.0.2', buildDate: '', hardware: 'MP716',
			canUpgrade: false, flashUpgradeEnabled: false, maxBytes: 8060928, maxSizeLabel: '8M', validationOnly: true });
	if (method == 'POST' && path == '/cgi-bin/mp716/system/firmware-package/verify')
		return verify();
	let body = {};
	if (method == 'POST') {
		let size = int(getenv('CONTENT_LENGTH') || '0');
		if (size < 0 || size > 16384) return fail(400, 'VALIDATION', '请求内容过大');
		try { body = size ? json(stdin.read(size)) : {}; }
		catch (e) { return fail(400, 'VALIDATION', '无效的 JSON 请求'); }
		if (type(body) != 'object') return fail(400, 'VALIDATION', '无效的请求对象');
	}
	try {
		let result = route_admin(ubus, method, substr(path, length('/cgi-bin/mp716/')), body, token);
		if (result?.error) return fail(result.error == 'DEVICE_BUSY' ? 409 : 400, result.error, result.message);
		if (result != null) return ok(result.data);
	} catch (e) { return fail(500, 'INTERNAL', '设备接口执行失败', { reason: e.message || string(e) }); }
	return fail(404, 'NOT_IMPLEMENTED', '此接口在测试固件中不可用');
}

main();
