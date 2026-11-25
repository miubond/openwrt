'use strict';
import { readfile, writefile, mkdir, chmod, stat, unlink, glob, rmdir } from 'fs';
import { command, store, load, acquire, release, uptime } from '/usr/share/mp716/admin-state.uc';

const ROOT = '/tmp/mp716-diagnostics';
function integer(v, low, high) { return type(v) == 'int' && v >= low && v <= high; }
function ipv4(v) {
	if (type(v) != 'string' || !match(v,/^([0-9]{1,3}\.){3}[0-9]{1,3}$/)) return false;
	for (let part in split(v,'.')) if (int(part)>255) return false;
	return true;
};
function host(v) {
	if (type(v)!='string' || length(v)>253 || !length(v) || index(v,'\x00')>=0) return false;
	if(match(v,/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/))return ipv4(v);
	for (let label in split(v,'.')) if (!match(label,/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/)) return false;
	return true;
};
export function diagnostic_args(req, addresses, lan_device) {
	if (type(req)!='object') die('无效检测请求');
	if (index(['ping','traceroute','dns','dhcp'],req.type)<0) die('无效检测类型');
	if (req.type=='dhcp') {
		if(type(lan_device)!='string' || !match(lan_device,/^[A-Za-z0-9_.-]{1,15}$/) || lan_device=='lo') die('LAN 设备不可用');
		return ['dhcp',lan_device];
	}
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
	if (!t || !integer(t.pid,2,4194304)) return false;
	let text = t?.pid ? readfile('/proc/'+t.pid+'/stat') : null;
	let fields = text ? split(substr(text,index(text,') ')+2),' ') : [];
	// Only signal our setsid process group; matching a PID alone is insufficient.
	return length(fields)>19 && fields[19]==t.started && fields[0]!='Z' && int(fields[2])==t.pid && int(fields[3])==t.pid;
};
function snapshot(dir) {
	let task=load(dir+'/task.json'), result=trim(readfile(dir+'/exit') || ''), output=readfile(dir+'/output') || '';
	let running=task && !length(result) && process(task), servers=[];
	for (let line in split(output,'\n')) {
		let found=match(line,/^DHCP_SERVER ([0-9.]+)( ([A-Fa-f0-9]{2}(:[A-Fa-f0-9]{2}){5}))?$/);
		if (found && ipv4(found[1]) && !length(filter(servers,(s)=>s.ip==found[1]))) push(servers,{ip:found[1],mac:found[3] || ''});
	}
	return {flag:running?1:(task?2:0),running:!!running,output:substr(output,0,65536),servers:servers};
};
function cleanup() {
	let dirs=glob(ROOT+'/*') || [], active=0;
	let boot=trim(readfile('/proc/sys/kernel/random/boot_id') || '');
	for(let dir in dirs) {
		if(!match(substr(dir,length(ROOT)+1),/^[a-f0-9]{32}-(ping|traceroute|dns|dhcp)$/))continue;
		let task=load(dir+'/task.json');
		if(process(task)){active++;continue;}
		if(!task || task.boot!=boot || uptime()-int(task.created || 0)>1800 || length(dirs)>64) {
			for(let name in ['task.json','output','exit','ready','authorized'])unlink(dir+'/'+name);
			rmdir(dir);
		}
	}
	return active;
}
export function route_diagnostics(bus, method, path, body, owner) {
	if (index(['tools/diagnostic/start','tools/diagnostic/poll','tools/diagnostic/stop','tools/diagnostic'],path)<0) return null;
	if (method!='POST') return {error:'VALIDATION',message:'检测接口需要 POST'};
	if (type(body)!='object') return {error:'VALIDATION',message:'无效检测请求'};
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
				let stopped=command('/bin/busybox kill -TERM -'+task.pid+' 2>/dev/null');
				if(stopped.code!=0 && process(task))die('无法停止检测');
			}
			return {data:null};
		}
		let addresses=[];
		for (let iface in bus.call('network.interface','dump',{})?.interface || [])
			for (let ip in iface['ipv4-address'] || []) push(addresses,ip.address);
		let lan=bus.call('network.interface.lan','status',{}) || {};
		let args=diagnostic_args(body,addresses,lan.l3_device || lan.device);
		if (!stat('/usr/share/mp716/diagnostic-worker.sh')) die('检测服务尚未安装');
		if(body.type=='dhcp' && !stat('/usr/sbin/mp716-dhcp-discover'))die('DHCP 探测程序尚未安装');
		mkdir(ROOT,0700);chmod(ROOT,0700);
		if(process(load(dir+'/task.json')))return {error:'DEVICE_BUSY',message:'该检测正在执行或停止中'};
		if(cleanup()>=4)return {error:'DEVICE_BUSY',message:'同时最多执行四个检测'};
		if(!mkdir(dir,0700) && !stat(dir))die('无法准备检测目录');
		chmod(dir,0700);
		for(let name in ['exit','output','task.json','ready','authorized'])unlink(dir+'/'+name);
		let worker='/bin/sh /usr/share/mp716/diagnostic-worker.sh '+quote(dir)+' '+join(' ',map(args,quote));
		if (path=='tools/diagnostic') {
			let started=time(); command('MP716_DIAG_TIMEOUT=10 '+worker+' </dev/null >/dev/null 2>&1');
			return {data:{success:trim(readfile(dir+'/exit') || '')=='0',output:snapshot(dir).output,durationMs:(time()-started)*1000}};
		}
		let launch='MP716_DIAG_ASYNC=1 /bin/busybox setsid '+worker+' </dev/null >/dev/null 2>&1 & echo $!';
		let launched=command(launch);if(launched.code!=0)die('无法启动检测');
		let pid=0;
		for(let attempt=0;attempt<3;attempt++) {
			let ready=trim(readfile(dir+'/ready') || '');
			if(match(ready,/^[1-9][0-9]{0,6}$/)){pid=int(ready);break;}
			command('/bin/busybox sleep 1');
		}
		if (pid<2 || pid>4194304) die('检测进程启动握手超时');
		let proc=readfile('/proc/'+pid+'/stat') || '', fields=split(substr(proc,index(proc,') ')+2),' ');
		let cmdline=readfile('/proc/'+pid+'/cmdline') || '';
		if(length(fields)<=19 || int(fields[2])!=pid || int(fields[3])!=pid ||
			index(cmdline,'/usr/share/mp716/diagnostic-worker.sh')<0 || index(cmdline,dir)<0)die('检测进程身份无效');
		store(dir+'/task.json',{pid:pid,started:fields[19],created:uptime(),boot:trim(readfile('/proc/sys/kernel/random/boot_id') || '')});
		if(writefile(dir+'/authorized','1\n')==null)die('无法确认检测启动');
		return {data:null};
		})();
	} catch(e) { result={error:'VALIDATION',message:e.message || sprintf('%s', e)}; }
	release();
	return result;
};
