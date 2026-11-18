'use strict';
import { readfile, writefile, mkdir, chmod, rename, unlink, rmdir, stat, popen } from 'fs';

export const STATE = '/etc/mp716-admin';
const RUNTIME = '/tmp/mp716-admin';
const PENDING = STATE + '/pending.json';

export function command(text) {
	let p = popen(text, 'r');
	if (!p) return { code: -1, output: '' };
	let output = p.read('all') || '';
	return { code: p.close(), output: output };
};
export function ensure_dirs() {
	mkdir(STATE, 0700); chmod(STATE, 0700);
	mkdir(RUNTIME, 0700); chmod(RUNTIME, 0700);
};
export function store(path, data) {
	let temporary = path + '.new';
	if (writefile(temporary, sprintf('%J', data)) == null) die('无法保存配置任务');
	chmod(temporary, 0600);
	if (!rename(temporary, path)) die('无法提交配置任务');
};
export function load(path) {
	let data = readfile(path);
	if (!data) return null;
	try { return json(data); } catch (e) { return null; }
};
export function uptime() { return int(split(readfile('/proc/uptime') || '0', ' ')[0]); };
function boot_id() { return trim(readfile('/proc/sys/kernel/random/boot_id') || ''); }
function task_file(id) { return RUNTIME + '/' + id + '.json'; }
export function task_view(t) {
	return { taskId: t.id, state: t.state, remainingSec: t.state == 'pending' ? max(0, t.deadline - uptime()) : 0,
		message: t.message || '' };
};
export function acquire() {
	ensure_dirs();
	let lock = RUNTIME + '/lock';
	let owner = load(lock + '/owner');
	if (owner && !stat('/proc/' + owner.pid)) { unlink(lock + '/owner'); rmdir(lock); }
	if (!owner && stat(lock) && time() - stat(lock).mtime > 30) rmdir(lock);
	if (!mkdir(lock, 0700)) return false;
	store(lock + '/owner', { pid: int(split(readfile('/proc/self/stat'), ' ')[0]) });
	return true;
};
export function release() { unlink(RUNTIME + '/lock/owner'); rmdir(RUNTIME + '/lock'); };
export function pending() { return load(PENDING); };
function finish(t, state, message) {
	t.state = state; t.message = message;
	delete t.files;
	store(task_file(t.id), t);
	unlink(PENDING);
	return task_view(t);
};
export function reload(kind) {
	if (kind == 'network') command('(sleep 1; /etc/init.d/network reload) >/tmp/mp716-admin/reload.log 2>&1 &');
	else if (kind == 'wireless') command('(sleep 1; /sbin/wifi reload) >/tmp/mp716-admin/reload.log 2>&1 &');
	else if (kind == 'dhcp') command('(sleep 1; /etc/init.d/dnsmasq reload) >/tmp/mp716-admin/reload.log 2>&1 &');
};
export function rollback(t) {
	for (let name, data in t.files) {
		if (!match(name, /^(network|wireless|dhcp)$/)) die('无效配置备份');
		if (writefile('/etc/config/' + name + '.mp716-new', data) == null) die('无法恢复配置');
		chmod('/etc/config/' + name + '.mp716-new', 0600);
		if (!rename('/etc/config/' + name + '.mp716-new', '/etc/config/' + name)) die('无法恢复配置');
	}
	let result = finish(t, 'rolled_back', '配置已恢复');
	reload(t.reload);
	return result;
};
export function expire() {
	let t = pending();
	if (t && (t.boot != boot_id() || uptime() >= t.deadline)) return rollback(t);
	return null;
};
export function begin(owner, packages, kind, timeout) {
	if (pending()) die('已有配置等待确认');
	let random = readfile('/proc/sys/kernel/random/uuid');
	let id = replace(trim(random || ''), /-/g, '');
	if (!match(id, /^[a-f0-9]{32}$/)) die('无法创建配置任务');
	let t = { id: id, owner: owner, boot: boot_id(), state: 'pending', deadline: uptime() + timeout,
		reload: kind, files: {} };
	for (let name in packages) t.files[name] = readfile('/etc/config/' + name) || '';
	store(PENDING, t);
	store(task_file(id), { id: id, owner: owner, state: 'pending', deadline: t.deadline });
	return t;
};
export function applied(t) {
	reload(t.reload);
	return { accepted: true, rollbackSec: max(0, t.deadline - uptime()), taskId: t.id };
};
export function get_task(id, owner, action) {
	if (!match(id || '', /^[a-f0-9]{32}$/)) die('无效任务编号');
	expire();
	let t = pending();
	if (!t || t.id != id) t = load(task_file(id));
	if (!t || t.owner != owner) die('任务不存在或无权访问');
	if (action == 'confirm' && t.state == 'pending') return finish(t, 'confirmed', '配置已确认');
	if (action == 'cancel' && t.state == 'pending') return rollback(t);
	return task_view(t);
};
export function access_list() { return load(STATE + '/access.json') || []; };
export function apply_access() {
	let entries = access_list();
	let macs = [];
	for (let entry in entries) {
		if (!match(entry.mac || '', /^([A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/)) die('无效终端 MAC');
		push(macs, lc(entry.mac));
	}
	let exists = command('/usr/sbin/nft list table inet mp716_access 2>/dev/null').code == 0;
	let rules = exists ? 'delete table inet mp716_access\n' : '';
	rules += 'table inet mp716_access {\nset blocked { type ether_addr;';
	if (length(macs)) rules += ' elements = { ' + join(', ', macs) + ' };';
	rules += ' }\nchain forward { type filter hook forward priority -10; policy accept; iifname "br-lan" ether saddr @blocked counter drop; }\n}\n';
	let p = popen('/usr/sbin/nft -f - 2>/tmp/mp716-admin/access-error.log', 'w');
	if (!p) die('无法应用终端访问控制');
	p.write(rules);
	if (p.close() != 0) die('无法应用终端访问控制');
};
export function tick() {
	if (!acquire()) return;
	try {
		expire();
		if (command('/usr/sbin/nft list table inet mp716_access 2>/dev/null').code != 0) apply_access();
	} catch(e) { release(); die(e); }
	release();
};
