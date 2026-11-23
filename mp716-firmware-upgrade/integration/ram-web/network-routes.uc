'use strict';
import { cursor } from 'uci';
import { acquire, release, expire, blocking_pending, dismiss_failed_pending, begin, applied, rollback } from '/usr/share/mp716/admin-state.uc';

function reject(message, code) { return { error: code || 'VALIDATION', message: message }; }

function ipv4(value) {
	if (type(value) != 'string' || !match(value, /^([0-9]{1,3}\.){3}[0-9]{1,3}$/)) return false;
	for (let octet in split(value, '.')) if (int(octet) < 0 || int(octet) > 255) return false;
	return true;
}

function netmask(bits) {
	let result = [];
	for (let i = 0; i < 4; i++) {
		let take = min(8, max(0, bits - i * 8));
		push(result, 256 - (1 << (8 - take)));
	}
	return join('.', result);
}

function maskbits(mask) {
	if (!ipv4(mask)) return null;
	for (let i = 1; i <= 32; i++) if (netmask(i) == mask) return i;
	return null;
}

function list_routes(c) {
	let rows = [];
	c.foreach('network', 'route', (s) => {
		if (!match(s['.name'] || '', /^mp716_rt_/)) return;
		push(rows, {
			id: s['.name'],
			enabled: s.disabled != '1',
			interface: s.interface || 'wan',
			target: s.target || '',
			netmask: s.netmask || '255.255.255.0',
			gateway: s.gateway || '',
			metric: int(s.metric || 0),
		});
	});
	return rows;
}

function normalize_row(row, idx) {
	if (type(row) != 'object') die('静态路由项无效');
	let iface = row.interface || 'wan';
	if (index(['wan', 'lan'], iface) < 0) die('出站接口无效');
	if (!ipv4(row.target) || !ipv4(row.gateway)) die('目标或网关 IPv4 无效');
	let mask = row.netmask || '255.255.255.0';
	if (!maskbits(mask)) die('子网掩码无效');
	let metric = row.metric == null ? 0 : int(row.metric);
	if (metric < 0 || metric > 9999) die('跃点超出范围');
	return {
		id: row.id || sprintf('mp716_rt_%d', idx),
		enabled: row.enabled != false,
		interface: iface,
		target: row.target,
		netmask: mask,
		gateway: row.gateway,
		metric: metric,
	};
}

function routes_equal(a, b) {
	return sprintf('%J', a) == sprintf('%J', b);
}

function write_routes(c, rows) {
	let existing = [];
	c.foreach('network', 'route', (s) => {
		if (match(s['.name'] || '', /^mp716_rt_/)) push(existing, s['.name']);
	});
	for (let name in existing) c.delete('network', name);
	let idx = 0;
	for (let row in rows) {
		let item = normalize_row(row, idx++);
		if (!match(item.id, /^mp716_rt_/)) die('静态路由 ID 无效');
		if (!c.add('network', 'route', item.id)) die('无法创建静态路由');
		c.set('network', item.id, 'interface', item.interface);
		c.set('network', item.id, 'target', item.target);
		c.set('network', item.id, 'netmask', item.netmask);
		c.set('network', item.id, 'gateway', item.gateway);
		c.set('network', item.id, 'metric', string(item.metric));
		c.set('network', item.id, 'disabled', item.enabled ? '0' : '1');
	}
	if (!c.commit('network')) die('无法提交静态路由');
}

export function route_network_routes(bus, method, path, body, owner) {
	if (path != 'network/static-routes') return null;
	let c = cursor();
	if (method == 'GET') return { data: list_routes(c) };
	if (method != 'POST') return reject('无效请求方式');
	if (!match(owner || '', /^[a-f0-9]{32}$/)) return reject('无效会话');
	if (!acquire()) return reject('另一个配置操作正在执行', 'DEVICE_BUSY');
	let result;
	try {
		result = (function () {
			expire();
			if (blocking_pending()) return reject('请先确认或撤销当前配置', 'DEVICE_BUSY');
			dismiss_failed_pending();
			let seconds = body?.confirmTimeoutSec == null ? 60 : int(body.confirmTimeoutSec);
			if (seconds < 30 || seconds > 180) return reject('确认时间必须在 30–180 秒内');
			let rows = body?.routes;
			if (type(rows) != 'array' || length(rows) > 64) return reject('静态路由列表无效');
			let normalized = [];
			for (let row in rows) push(normalized, normalize_row(row, length(normalized)));
			if (routes_equal(normalized, list_routes(c))) return { accepted: true, rollbackSec: 0 };
			let t = begin(owner, ['network'], 'network', seconds);
			try {
				write_routes(c, normalized);
				return applied(t);
			} catch (e) { rollback(t); die(e); }
		})();
	} catch (e) { result = reject(e.message || string(e), 'VALIDATION'); }
	release();
	return result;
}