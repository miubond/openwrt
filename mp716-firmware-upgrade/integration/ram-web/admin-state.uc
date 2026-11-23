'use strict';
import { readfile, writefile, mkdir, chmod, rename, unlink, rmdir, stat, popen } from 'fs';
import { perf_enabled, perf_add_shell, perf_monotonic_ms } from '/usr/share/mp716/perf-diag.uc';

export const STATE = '/etc/mp716-admin';
const RUNTIME = '/tmp/mp716-admin';
const PENDING = STATE + '/pending.json';
const PACKAGES = /^(network|wireless|dhcp|system|firewall|upnpd|ddns|mp716_system|mp716_vpn|pptpd|xl2tp|ipsec|openvpn)$/;
function snapshot_path(path) {
	return path == '/etc/shadow' || match(path,/^\/etc\/mp716-vpn\/(client\.ovpn|ca\.pem|client\.crt|client\.key|ta\.key|auth)$/);
}

export function command(text) {
	let t0 = perf_enabled() ? perf_monotonic_ms() : 0;
	let wrapped = match(text || '', /^\/bin\/busybox timeout /) ? text :
		'/bin/busybox timeout -s KILL 15 /bin/sh -c ' + "'" + replace(text, "'", "'\\''") + "'";
	let p = popen(wrapped, 'r');
	if (!p) return { code: -1, output: '' };
	let output = p.read('all') || '';
	let result = { code: p.close(), output: output };
	if (t0) perf_add_shell(perf_monotonic_ms() - t0);
	return result;
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
		phase: t.phase || 'prepared', message: t.message || '', applyError: t.applyError || '', rollbackError: t.rollbackError || '' };
};
function process_identity(pid) {
	if(type(pid)!='int'||pid<2)return null;
	let raw=readfile('/proc/'+pid+'/stat') || '', fields=split(substr(raw,index(raw,') ')+2),' ');
	return length(fields)>19 && fields[0]!='Z'?{pid:pid,started:fields[19]}:null;
}
function self_identity() {return process_identity(int(split(readfile('/proc/self/stat') || '', ' ')[0]));}
function worker_alive(t) {
	if(t.boot!=boot_id() || !t.worker)return false;
	let p=process_identity(t.worker.pid);return p && p.started==t.worker.started;
}
export function acquire() {
	ensure_dirs();
	let lock = RUNTIME + '/lock';
	let owner = load(lock + '/owner');
	let existing=owner?process_identity(owner.pid):null;
	if (owner && (!existing || owner.started && owner.started!=existing.started)) { unlink(lock + '/owner'); rmdir(lock); }
	if (!owner && stat(lock) && time() - stat(lock).mtime > 30) rmdir(lock);
	if (!mkdir(lock, 0700)) return false;
	store(lock + '/owner', self_identity());
	return true;
};
export function release() { unlink(RUNTIME + '/lock/owner'); rmdir(RUNTIME + '/lock'); };
export function pending() { return load(PENDING); };
/** 仅等待确认/应用中的任务会阻塞新的配置写入；failed 需用户撤销或在新任务开始时解除 */
export function blocking_pending() {
	let t = pending();
	return t && t.state == 'pending' ? t : null;
};
export function dismiss_failed_pending() {
	let t = pending();
	if (!t || t.state != 'failed') return null;
	unlink(PENDING);
	return t;
};
function finish(t, state, message) {
	t.state = state; t.phase=state; t.message = message;
	delete t.files;
	delete t.modes;
	delete t.absent;
	delete t.extraSnapshots;
	delete t.worker;delete t.workerToken;
	store(task_file(t.id), t);
	if(pending()?.id==t.id)unlink(PENDING);
	return task_view(t);
};
function persist(t) {
	store(PENDING,t);
	store(task_file(t.id),{id:t.id,owner:t.owner,state:t.state,phase:t.phase,deadline:t.deadline,message:t.message,applyError:t.applyError,rollbackError:t.rollbackError});
}
function quote(v) {return "'"+replace(v,"'","'\\''")+"'";}
export function reload(kind,task_id) {
	// Run only from the asynchronous worker, outside the global request lock.
	// netifd reload preserves switch setup; never use /etc/init.d/network restart.
	let commands={network:'/bin/ubus call network reload',wireless:'/sbin/wifi reload',dhcp:'/etc/init.d/dnsmasq reload',
		system:'/usr/bin/ucode /usr/share/mp716/system-apply.uc',vpn:'/etc/init.d/mp716-vpn reload && /usr/bin/ucode /usr/share/mp716/vpn-health.uc',firewall:'/etc/init.d/firewall reload',
		upnpd:'/etc/init.d/miniupnpd restart 2>/dev/null || /etc/init.d/upnpd restart 2>/dev/null || true',ddns:'/etc/init.d/ddns restart 2>/dev/null || true'};
	let kinds=kind=='all'?['network','wireless','dhcp','system','vpn','firewall']:kind=='network-wireless'?['network','wireless']:kind=='network-dhcp'?['network','dhcp']:kind=='none'?[]:[kind];
	for(let name in kinds) {
		let current=task_id?pending():null;
		if(task_id && current && current.id==task_id && current.phase=='applying' &&
			(current.cancelRequested||current.boot!=boot_id()||uptime()>=current.deadline))return {code:-2,cancelled:true,kind:name,output:''};
		if(!commands[name])return {code:-1,kind:name,output:'Unknown apply kind'};
		let result=command('/bin/busybox timeout -s KILL 25 /bin/sh -c '+quote(name=='vpn'?commands[name]:'exec '+commands[name]));
		if(result.code!=0)return {...result,kind:name};
	}
	return {code:0,output:''};
};
function restore_files(t) {
	for (let name, data in t.files) {
		if (!match(name, PACKAGES)) die('无效配置备份');
		if (index(t.absent || [],name)>=0) {if(stat('/etc/config/'+name)&&!unlink('/etc/config/'+name))die('无法恢复配置缺失状态');continue;}
		if (writefile('/etc/config/' + name + '.mp716-new', data) == null) die('无法恢复配置');
		chmod('/etc/config/' + name + '.mp716-new', t.modes ? t.modes[name] : 0600);
		if (!rename('/etc/config/' + name + '.mp716-new', '/etc/config/' + name)) die('无法恢复配置');
	}
	for (let path, row in t.extraSnapshots || {}) {
		if (!snapshot_path(path)) die('无效配置备份路径');
		if (!row.exists) {if(stat(path)&&!unlink(path))die('无法恢复文件缺失状态');continue;}
		if (writefile(path+'.mp716-new',row.data)==null) die('无法恢复配置文件');
		chmod(path+'.mp716-new',row.mode);
		if (!rename(path+'.mp716-new',path)) die('无法恢复配置文件');
	}
}
function failed(t,message) {
	t.state='failed';t.phase='failed';t.message=message;delete t.worker;delete t.workerToken;
	// Keep the snapshot and global pending gate for explicit rollback retry.
	persist(t);return task_view(t);
}
function launch_worker(t) {
	if(!match(t.id || '',/^[a-f0-9]{32}$/))die('无效配置任务编号');
	if(!stat('/usr/share/mp716/apply-task.uc'))die('配置应用服务尚未安装');
	t.workerToken=replace(trim(readfile('/proc/sys/kernel/random/uuid') || ''),/-/g,'');
	if(!match(t.workerToken,/^[a-f0-9]{32}$/))die('无法创建配置应用进程');
	delete t.worker;t.workerQueuedAt=uptime();persist(t);
	writefile(RUNTIME+'/'+t.id+'.worker.log','');chmod(RUNTIME+'/'+t.id+'.worker.log',0600);
	let result=command('/usr/bin/ucode /usr/share/mp716/apply-task.uc '+t.id+' '+t.workerToken+' >'+RUNTIME+'/'+t.id+'.worker.log 2>&1 </dev/null & echo $!');
	if(result.code!=0||!match(trim(result.output || ''),/^[1-9][0-9]*$/))die('无法启动配置应用进程');
}
export function rollback(t) {
	let current=pending();if(!current || current.id!=t.id)die('配置任务不存在');t=current;
	if(t.phase=='rolling_back' && worker_alive(t))return task_view(t);
	if(t.phase=='applying' && worker_alive(t)) {
		t.cancelRequested=true;t.message='等待当前服务应用结束后恢复配置';persist(t);return task_view(t);
	}
	try {restore_files(t);} catch(e) {t.rollbackError=e.message || string(e);return failed(t,'配置文件恢复失败，请重试回滚');}
	if(t.phase=='prepared'||t.reload=='none')return finish(t,'rolled_back','配置已恢复，未启动服务应用');
	t.state='pending';t.phase='rolling_back';t.boot=boot_id();t.message='正在恢复原配置及服务';
	delete t.cancelRequested;
	try {launch_worker(t);} catch(e) {t.rollbackError=e.message || string(e);return failed(t,'配置文件已恢复，但服务恢复未完成');}
	return task_view(t);
};
export function expire() {
	let t = pending();
	if(!t || t.state=='failed')return null;
	if(t.phase=='rolling_back') {
		if(!worker_alive(t) && uptime()-int(t.workerQueuedAt || 0)>10)return rollback(t);
		return null;
	}
	if(t.boot!=boot_id() || uptime()>=t.deadline ||
		t.phase=='applying' && !worker_alive(t) && uptime()-int(t.workerQueuedAt || 0)>10)return rollback(t);
	return null;
};
export function begin(owner, packages, kind, timeout, extra_paths) {
	if (blocking_pending()) die('已有配置等待确认');
	dismiss_failed_pending();
	let random = readfile('/proc/sys/kernel/random/uuid');
	let id = replace(trim(random || ''), /-/g, '');
	if (!match(id, /^[a-f0-9]{32}$/)) die('无法创建配置任务');
	let t = { id: id, owner: owner, boot: boot_id(), state: 'pending', phase:'prepared', deadline: uptime() + timeout,
		reload: kind, files: {}, modes: {}, absent: [], extraSnapshots: {} };
	for (let name in packages) {
		if (!match(name,PACKAGES)) die('无效配置包');
		let path='/etc/config/'+name, info=stat(path);
		if (!info) push(t.absent,name);
		t.files[name] = readfile(path) || '';
		t.modes[name] = info ? info.mode & 0777 : 0600;
	}
	for (let path in extra_paths || []) {
		if (!snapshot_path(path)) die('无效配置备份路径');
		let info=stat(path);
		t.extraSnapshots[path]={exists:!!info,data:readfile(path)||'',mode:info?info.mode & 0777:0600};
	}
	persist(t);
	return t;
};
export function applied(t) {
	if(t.reload=='none') {t.phase='applied';t.message='配置已保存，等待确认';persist(t);}
	else {t.phase='applying';t.message='正在应用服务配置';launch_worker(t);}
	return { accepted: true, rollbackSec: max(0, t.deadline - uptime()), taskId: t.id,phase:t.phase };
};
export function get_task(id, owner, action) {
	if (!match(id || '', /^[a-f0-9]{32}$/)) die('无效任务编号');
	expire();
	let t = pending();
	if (!t || t.id != id) t = load(task_file(id));
	if (!t || t.owner != owner) die('任务不存在或无权访问');
	if (action == 'confirm' && t.state == 'pending') {
		if(t.phase!='applied')die('服务配置尚未成功应用，暂时不能确认');
		return finish(t, 'confirmed', '配置已确认');
	}
	if (action == 'cancel' && (t.state == 'pending'||t.state=='failed')) return rollback(t);
	return task_view(t);
};
function wait_lock() {
	for(let n=0;n<5;n++) {if(acquire())return true;command('/bin/busybox sleep 1');}
	return false;
}
export function run_worker(id,token) {
	if(!match(id || '',/^[a-f0-9]{32}$/)||!wait_lock())return false;
	let t=pending();
	if(!t || t.id!=id || token!=null && t.workerToken!=token || index(['applying','rolling_back'],t.phase)<0 || worker_alive(t)) {release();return false;}
	let generation=t.workerToken, phase=t.phase;
	t.worker=self_identity();persist(t);release();
	let result;
	try {result=reload(t.reload,id);}catch(e){result={code:-1,kind:t.reload,output:e.message || string(e)};}
	// Output may contain private service details; never return it in a task view.
	writefile(RUNTIME+'/'+id+'.'+phase+'.log',substr(result.output || '',0,65536));chmod(RUNTIME+'/'+id+'.'+phase+'.log',0600);
	if(!wait_lock())return false;
	let held=true, success;
	try {success=(function() {
		t=pending();if(!t||t.id!=id||t.workerToken!=generation)return false;
		if(phase=='applying') {
			if(result.code==0&&!t.cancelRequested&&t.boot==boot_id()&&uptime()<t.deadline) {
				t.phase='applied';t.message='服务配置已应用，等待确认';delete t.worker;persist(t);return true;
			}
			if(result.code!=0&&!result.cancelled)t.applyError='服务应用失败: '+(result.kind || t.reload)+'，退出码 '+result.code;
			try {restore_files(t);}catch(e){t.rollbackError=e.message || string(e);failed(t,'配置文件恢复失败，请重试回滚');return false;}
			t.phase='rolling_back';t.boot=boot_id();t.message='正在恢复原配置及服务';persist(t);
			release();held=false;
			try {result=reload(t.reload);}catch(e){result={code:-1,kind:t.reload,output:e.message || string(e)};}
			writefile(RUNTIME+'/'+id+'.rollback.log',substr(result.output || '',0,65536));chmod(RUNTIME+'/'+id+'.rollback.log',0600);
			if(!wait_lock())return false;held=true;
			t=pending();if(!t||t.id!=id||t.workerToken!=generation)return false;
		}
		if(result.code!=0) {
			t.rollbackError='服务恢复失败: '+(result.kind || t.reload)+'，退出码 '+result.code;
			failed(t,'配置文件已恢复，但原服务未恢复；请重试回滚');return false;
		}
		finish(t,'rolled_back',t.applyError?'应用失败，原配置及服务已恢复':'原配置及服务已恢复');return true;
	})();}catch(e){if(held)release();die(e);}
	if(held)release();return success;
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
