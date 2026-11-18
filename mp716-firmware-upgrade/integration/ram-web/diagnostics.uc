'use strict';
import { readfile, mkdir, chmod, stat } from 'fs';
import { command, store, load, acquire, release } from '/usr/share/mp716/admin-state.uc';

const ROOT = '/tmp/mp716-diagnostics';
function integer(v, low, high) { return type(v) == 'int' && v >= low && v <= high; }
function ipv4(v) {
	if (type(v) != 'string' || !match(v,/^([0-9]{1,3}\.){3}[0-9]{1,3}$/)) return false;
	for (let part in split(v,'.')) if (int(part)>255) return false;
	return true;
};
function host(v) {
	if (type(v)!='string' || length(v)>253 || !length(v) || index(v,'\x00')>=0) return false;
	for (let label in split(v,'.')) if (!match(label,/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/)) return false;
	return true;
};
export function diagnostic_args(req, addresses) {
	if (index(['ping','traceroute','dns','dhcp'],req.type)<0) die('无效检测类型');
	if (req.type=='dhcp') return ['dhcp'];
	if (!host(req.target)) die('目标地址无效');
	if (req.type=='dns') return ['dns',req.target];
	if (req.type=='ping') {
		let count=req.count ?? 4, source=req.source || '';
		if (!integer(count,1,100)) die('Ping 次数必须为 1–100');
		if (source && (!ipv4(source) || index(addresses,source)<0)) die('源地址必须是本机 IPv4 地址');
		return ['ping',req.target,sprintf('%d',count),source];
	}
	let hops=req.maxHops ?? 10, timeout=req.timeoutSec ?? 5;
	if (!integer(hops,1,20) || !integer(timeout,1,10)) die('路由跟踪参数超出范围');
	return ['traceroute',req.target,sprintf('%d',hops),sprintf('%d',timeout)];
};
function quote(v) { return "'"+replace(v,"'","'\\''")+"'"; }
function directory(owner, kind) {
	if (!match(owner || '',/^[a-f0-9]{32}$/) || index(['ping','traceroute','dns','dhcp'],kind)<0) die('无效检测会话');
	return ROOT+'/'+owner+'-'+kind;
};
function process(t) {
	let text = t?.pid ? readfile('/proc/'+t.pid+'/stat') : null;
	let fields = text ? split(substr(text,index(text,') ')+2),' ') : [];
	return length(fields)>19 && fields[19]==t.started && fields[0]!='Z';
};
function snapshot(dir) {
	let task=load(dir+'/task.json'), result=trim(readfile(dir+'/exit') || ''), output=readfile(dir+'/output') || '';
	let running=task && !length(result) && process(task), servers=[];
	for (let line in split(output,'\n')) {
		let found=match(line,/^DHCP_SERVER ([0-9.]+)$/);
		if (found && ipv4(found[1]) && !length(filter(servers,(s)=>s.ip==found[1]))) push(servers,{ip:found[1],mac:''});
	}
	return {flag:running?1:(task?2:0),running:!!running,output:substr(output,0,65536),servers:servers};
};
export function route_diagnostics(bus, method, path, body, owner) {
	if (index(['tools/diagnostic/start','tools/diagnostic/poll','tools/diagnostic/stop','tools/diagnostic'],path)<0) return null;
	if (method!='POST') return {error:'VALIDATION',message:'检测接口需要 POST'};
	if (!acquire()) return {error:'DEVICE_BUSY',message:'另一个设备操作正在执行'};
	let result;
	try {
		result=(function() {
		let dir=directory(owner,body.type);
		if (path=='tools/diagnostic/poll') return {data:snapshot(dir)};
		if (path=='tools/diagnostic/stop') {
			let task=load(dir+'/task.json');
			if (process(task)) {
				// The worker is a dedicated setsid process group, identified by start time.
				command('/bin/busybox kill -TERM -'+task.pid+' 2>/dev/null');
			}
			return {data:null};
		}
		let addresses=[];
		for (let iface in bus.call('network.interface','dump',{})?.interface || [])
			for (let ip in iface['ipv4-address'] || []) push(addresses,ip.address);
		let args=diagnostic_args(body,addresses);
		if (!stat('/usr/share/mp716/diagnostic-worker.sh')) die('检测服务尚未安装');
		mkdir(ROOT,0700);chmod(ROOT,0700);
		if (!mkdir(dir,0700) && snapshot(dir).running) return {error:'DEVICE_BUSY',message:'该检测正在执行'};
		chmod(dir,0700);
		let worker='/bin/sh /usr/share/mp716/diagnostic-worker.sh '+quote(dir)+' '+join(' ',map(args,quote));
		if (path=='tools/diagnostic') {
			let started=time(); command('MP716_DIAG_TIMEOUT=10 '+worker+' </dev/null >/dev/null 2>&1');
			return {data:{success:trim(readfile(dir+'/exit') || '')=='0',output:snapshot(dir).output,durationMs:(time()-started)*1000}};
		}
		let launch='rm -f '+quote(dir+'/exit')+'; /bin/busybox setsid '+worker+' </dev/null >/dev/null 2>&1 & echo $!';
		let pid=int(trim(command(launch).output));
		if (pid<2) die('无法启动检测');
		let proc=readfile('/proc/'+pid+'/stat') || '', fields=split(substr(proc,index(proc,') ')+2),' ');
		if (length(fields)<=19 && !stat(dir+'/exit')) die('检测进程启动失败');
		store(dir+'/task.json',{pid:length(fields)>19?pid:0,started:fields[19] || '',created:time()});
		return {data:null};
		})();
	} catch(e) { result={error:'VALIDATION',message:e.message || string(e)}; }
	release();
	return result;
};
