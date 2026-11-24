'use strict';
import { cursor } from 'uci';
import { stat } from 'fs';
import { acquire, release, expire, blocking_pending, dismiss_failed_pending, begin, applied, rollback } from '/usr/share/mp716/admin-state.uc';

function reject(message, code) { return { error: code || 'VALIDATION', message: message }; }

const QUEUE = 'mp716_wan';

function sqm_installed() {
	return stat('/etc/config/sqm') != null;
}

function sqm_runtime() {
	return sqm_installed() && stat('/etc/init.d/sqm') != null;
}

function qos_capability() {
	if (!sqm_installed())
		return { supported: false, backend: 'none', reason: '未安装 sqm 配置包（opkg install sqm）' };
	if (!sqm_runtime())
		return { supported: false, backend: 'none', reason: 'sqm 服务未就绪' };
	return { supported: true, backend: 'sqm' };
}

function read_qos(c) {
	let enabled = false, download = 0, upload = 0;
	if (!sqm_installed()) return { enabled: enabled, downloadKbps: download, uploadKbps: upload };
	let section = c.get('sqm', QUEUE) != null ? QUEUE : null;
	if (!section) {
		c.foreach('sqm', 'queue', (s) => {
			if (!section && (s.interface == 'wan' || s['.name'] == 'wan')) section = s['.name'];
		});
	}
	section = section || QUEUE;
	if (c.get('sqm', section) != null) {
		enabled = c.get('sqm', section, 'enabled') == '1';
		download = int(c.get('sqm', section, 'download') || 0);
		upload = int(c.get('sqm', section, 'upload') || 0);
	}
	return { enabled: enabled, downloadKbps: download, uploadKbps: upload };
}

function write_qos(c, cfg) {
	if (!sqm_runtime()) die('设备未安装 sqm');
	if (type(cfg) != 'object' || type(cfg.enabled) != 'bool') die('QoS 配置无效');
	let down = int(cfg.downloadKbps || 0);
	let up = int(cfg.uploadKbps || 0);
	if (cfg.enabled && (down < 1 || up < 1)) die('启用 QoS 时需设置正数上下行限速（Kbps）');
	if (down < 0 || up < 0 || down > 100000000 || up > 100000000) die('限速值超出范围');
	if (!c.get('sqm', QUEUE)) {
		if (!c.set('sqm', QUEUE, 'queue')) die('无法初始化 sqm 队列');
	}
	c.set('sqm', QUEUE, 'interface', 'wan');
	c.set('sqm', QUEUE, 'enabled', cfg.enabled ? '1' : '0');
	c.set('sqm', QUEUE, 'download', sprintf('%d', down));
	c.set('sqm', QUEUE, 'upload', sprintf('%d', up));
	c.set('sqm', QUEUE, 'qdisc', 'cake');
	c.set('sqm', QUEUE, 'script', 'piece_of_cake.qos');
	if (!c.commit('sqm')) die('无法提交 QoS 配置');
}

export function route_network_qos(bus, method, path, body, owner) {
	if (path != 'network/qos/capability' && path != 'network/qos/config') return null;
	let c = cursor();
	if (method == 'GET') {
		if (path == 'network/qos/capability') return { data: qos_capability() };
		return { data: read_qos(c) };
	}
	if (method != 'POST' || path != 'network/qos/config') return reject('无效请求方式');
	if (!match(owner || '', /^[a-f0-9]{32}$/)) return reject('无效会话');
	if (!qos_capability().supported) return reject('当前固件未启用 QoS', 'VALIDATION');
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
			let current = read_qos(c);
			if (sprintf('%J', current) == sprintf('%J', {
				enabled: cfg.enabled == true,
				downloadKbps: int(cfg.downloadKbps || 0),
				uploadKbps: int(cfg.uploadKbps || 0),
			})) return { accepted: true, rollbackSec: 0 };
			let t = begin(owner, ['sqm'], 'sqm', seconds);
			try {
				write_qos(c, cfg);
				return applied(t);
			} catch (e) { rollback(t); die(e); }
		})();
	} catch (e) { result = reject(e.message || sprintf('%s', e), 'VALIDATION'); }
	release();
	return result;
};