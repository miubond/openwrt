'use strict';
import { cursor } from 'uci';
import { acquire, release, expire, blocking_pending, dismiss_failed_pending, begin, applied, rollback } from '/usr/share/mp716/admin-state.uc';

function reject(message, code) { return { error: code || 'VALIDATION', message: message }; }
function list_rules(c) {
	let rules = [];
	c.foreach('firewall', 'rule', (s) => {
		push(rules, {
			id: s['.name'],
			name: s.name || s['.name'],
			enabled: s.enabled != '0',
			src: s.src || '',
			dest: s.dest || '',
			proto: s.proto || 'tcp',
			action: s.target || 'ACCEPT',
		});
	});
	return rules;
}
function list_forwards(c) {
	let rules = [];
	c.foreach('firewall', 'redirect', (s) => {
		push(rules, {
			id: s['.name'],
			name: s.name || s['.name'],
			enabled: s.enabled != '0',
			proto: s.proto || 'tcp',
			extPort: int(s.src_dport || 0),
			intIp: s.dest_ip || '',
			intPort: int(s.dest_port || 0),
		});
	});
	return rules;
}
function write_rules(c, rows) {
	if (type(rows) != 'array' || length(rows) > 64) die('防火墙规则列表无效');
	let existing = [];
	c.foreach('firewall', 'rule', (s) => { if (match(s['.name'], /^mp716_rule_/)) push(existing, s['.name']); });
	for (let name in existing) c.delete('firewall', name);
	let idx = 0;
	for (let r in rows) {
		let name = 'mp716_rule_' + idx++;
		if (!c.set('firewall', name, 'rule')) die('无法创建防火墙规则');
		c.set('firewall', name, 'name', r.name || name);
		c.set('firewall', name, 'enabled', r.enabled == false ? '0' : '1');
		c.set('firewall', name, 'src', r.src || 'lan');
		c.set('firewall', name, 'dest', r.dest || 'wan');
		c.set('firewall', name, 'proto', r.proto || 'tcp');
		c.set('firewall', name, 'target', r.action || 'ACCEPT');
	}
	if (!c.commit('firewall')) die('无法提交防火墙规则');
}
function write_forwards(c, rows) {
	if (type(rows) != 'array' || length(rows) > 64) die('端口转发列表无效');
	let existing = [];
	c.foreach('firewall', 'redirect', (s) => { if (match(s['.name'], /^mp716_pf_/)) push(existing, s['.name']); });
	for (let name in existing) c.delete('firewall', name);
	let idx = 0;
	for (let r in rows) {
		let name = 'mp716_pf_' + idx++;
		if (!c.set('firewall', name, 'redirect')) die('无法创建端口转发');
		c.set('firewall', name, 'name', r.name || name);
		c.set('firewall', name, 'enabled', r.enabled == false ? '0' : '1');
		c.set('firewall', name, 'src', 'wan');
		c.set('firewall', name, 'dest', 'lan');
		c.set('firewall', name, 'proto', r.proto || 'tcp');
		c.set('firewall', name, 'src_dport', sprintf('%d', int(r.extPort || 0)));
		c.set('firewall', name, 'dest_ip', r.intIp || '');
		c.set('firewall', name, 'dest_port', sprintf('%d', int(r.intPort || 0)));
		c.set('firewall', name, 'target', 'DNAT');
	}
	if (!c.commit('firewall')) die('无法提交端口转发');
}

function read_dmz(c) {
	let enabled = false, hostIp = '';
	c.foreach('firewall', 'redirect', (s) => {
		if (s['.name'] == 'mp716_dmz') {
			enabled = s.enabled != '0';
			hostIp = s.dest_ip || '';
		}
	});
	return { enabled: enabled, hostIp: hostIp };
}
function write_dmz(c, cfg) {
	if (type(cfg) != 'object') die('DMZ 配置无效');
	c.delete('firewall', 'mp716_dmz');
	if (cfg.enabled) {
		let ip = cfg.hostIp || '';
		if (!match(ip, /^[0-9]{1,3}(\.[0-9]{1,3}){3}$/)) die('DMZ 主机 IP 无效');
		if (!c.set('firewall', 'mp716_dmz', 'redirect')) die('无法创建 DMZ 规则');
		c.set('firewall', 'mp716_dmz', 'name', 'MP716-DMZ');
		c.set('firewall', 'mp716_dmz', 'enabled', '1');
		c.set('firewall', 'mp716_dmz', 'src', 'wan');
		c.set('firewall', 'mp716_dmz', 'dest', 'lan');
		c.set('firewall', 'mp716_dmz', 'proto', 'all');
		c.set('firewall', 'mp716_dmz', 'dest_ip', ip);
		c.set('firewall', 'mp716_dmz', 'target', 'DNAT');
		c.set('firewall', 'mp716_dmz', 'reflection', '0');
	}
	if (!c.commit('firewall')) die('无法提交 DMZ 配置');
}

export function route_firewall(bus, method, path, body, owner) {
	if (index(['firewall/rules', 'firewall/port-forwards', 'firewall/dmz'], path) < 0) return null;
	let c = cursor();
	if (method == 'GET') {
		if (path == 'firewall/rules') return { data: list_rules(c) };
		if (path == 'firewall/dmz') return { data: read_dmz(c) };
		return { data: list_forwards(c) };
	}
	if (method != 'POST') return reject('无效请求方式');
	if (!match(owner || '', /^[a-f0-9]{32}$/)) return reject('无效会话');
	if (!acquire()) return reject('另一个配置操作正在执行', 'DEVICE_BUSY');
	let result;
	try {
		result = (function() {
			expire();
			if (blocking_pending()) return reject('请先确认或撤销当前配置', 'DEVICE_BUSY');
			dismiss_failed_pending();
			let seconds = body?.confirmTimeoutSec == null ? 60 : int(body.confirmTimeoutSec);
			if (seconds < 30 || seconds > 180) return reject('确认时间必须在 30–180 秒内');
			if (path == 'firewall/dmz') {
				let cfg = body?.config;
				if (type(cfg) != 'object') return reject('DMZ 配置无效');
				let t = begin(owner, ['firewall'], 'firewall', seconds);
				try { write_dmz(c, cfg); return applied(t); }
				catch (e) { rollback(t); die(e); }
			}
			let rows = body?.rules;
			if (type(rows) != 'array') return reject('规则列表无效');
			let t = begin(owner, ['firewall'], 'firewall', seconds);
			try {
				if (path == 'firewall/rules') write_rules(c, rows);
				else write_forwards(c, rows);
				return applied(t);
			} catch (e) { rollback(t); die(e); }
		})();
	} catch (e) { result = reject(e.message || sprintf('%s', e), 'VALIDATION'); }
	release();
	return result;
};