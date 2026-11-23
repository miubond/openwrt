'use strict';
import { cursor } from 'uci';
import { stat } from 'fs';
import { acquire, release, expire, blocking_pending, dismiss_failed_pending, begin, applied, rollback } from '/usr/share/mp716/admin-state.uc';

function reject(message, code) { return { error: code || 'VALIDATION', message: message }; }

function read_upnp(c) {
	let enabled = c.get('upnpd', 'config', 'enabled') == '1';
	return { supported: !!stat('/etc/config/upnpd'), enabled: enabled };
}
function write_upnp(c, cfg) {
	if (!stat('/etc/config/upnpd')) die('设备未安装 UPnP 服务');
	if (!c.get('upnpd', 'config')) {
		if (!c.add('upnpd', 'config')) die('无法初始化 UPnP 配置');
		c.set('upnpd', 'config', 'internal_iface', 'lan');
		c.set('upnpd', 'config', 'external_iface', 'wan');
	}
	c.set('upnpd', 'config', 'enabled', cfg.enabled ? '1' : '0');
	if (!c.commit('upnpd')) die('无法提交 UPnP 配置');
}

function read_ddns(c) {
	let supported = !!stat('/etc/config/ddns');
	let cfg = { supported: supported, enabled: false, provider: '', domain: '', username: '', hostname: '' };
	if (!supported) return cfg;
	let name = c.get('ddns', 'mp716_wan') != null ? 'mp716_wan' : null;
	if (!name) {
		c.foreach('ddns', 'service', (s) => {
			if (!name && (s['.name'] == 'mp716_wan' || s.interface == 'wan')) name = s['.name'];
		});
	}
	if (!name) return cfg;
	cfg.enabled = c.get('ddns', name, 'enabled') == '1';
	cfg.provider = c.get('ddns', name, 'service_name') || '';
	cfg.domain = c.get('ddns', name, 'domain') || c.get('ddns', name, 'lookup_host') || '';
	cfg.username = c.get('ddns', name, 'username') || '';
	cfg.hostname = c.get('ddns', name, 'lookup_host') || cfg.domain;
	return cfg;
}
function write_ddns(c, cfg) {
	if (!stat('/etc/config/ddns')) die('设备未安装 DDNS 服务');
	if (!c.get('ddns', 'mp716_wan')) {
		if (!c.add('ddns', 'service', 'mp716_wan')) die('无法创建 DDNS 条目');
	}
	let name = 'mp716_wan';
	c.set('ddns', name, 'enabled', cfg.enabled ? '1' : '0');
	c.set('ddns', name, 'service_name', cfg.provider || 'duckdns.org');
	c.set('ddns', name, 'domain', cfg.domain || '');
	c.set('ddns', name, 'username', cfg.username || '');
	if (cfg.password != null && cfg.password != '') c.set('ddns', name, 'password', cfg.password);
	c.set('ddns', name, 'lookup_host', cfg.hostname || cfg.domain || '');
	c.set('ddns', name, 'ip_source', 'network');
	c.set('ddns', name, 'ip_network', 'wan');
	c.set('ddns', name, 'interface', 'wan');
	if (!c.commit('ddns')) die('无法提交 DDNS 配置');
}

function read_cellular() {
	return { supported: false, installed: false, reason: 'no_modem', wanModes: ['wired'] };
}

export function route_network_services(bus, method, path, body, owner) {
	if (path == 'network/cellular') {
		if (method == 'GET') return { data: read_cellular() };
		return reject('蜂窝功能未安装');
	}
	if (path != 'network/upnp' && path != 'network/ddns') return null;
	let c = cursor();
	if (method == 'GET') {
		if (path == 'network/upnp') return { data: read_upnp(c) };
		return { data: read_ddns(c) };
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
			let cfg = body?.config;
			if (type(cfg) != 'object') return reject('配置无效');
			let pkg = path == 'network/upnp' ? 'upnpd' : 'ddns';
			let kind = path == 'network/upnp' ? 'upnpd' : 'ddns';
			let t = begin(owner, [pkg], kind, seconds);
			try {
				if (path == 'network/upnp') write_upnp(c, cfg);
				else write_ddns(c, cfg);
				return applied(t);
			} catch (e) { rollback(t); die(e); }
		})();
	} catch (e) { result = reject(e.message || string(e), 'VALIDATION'); }
	release();
	return result;
};