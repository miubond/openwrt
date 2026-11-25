'use strict';
import { cursor } from 'uci';
import { connect } from 'ubus';
import { readfile, writefile, mkdir, chmod, rename, unlink, rmdir, stat, popen } from 'fs';
import { validate_openvpn } from '/usr/share/mp716/vpn-config.uc';
import { command, store, load, acquire, release, expire, pending, blocking_pending, dismiss_failed_pending, begin, applied, rollback, uptime, ensure_dirs } from '/usr/share/mp716/admin-state.uc';

const ADMIN_RUNTIME = '/tmp/mp716-admin';

/**
 * 在 CGI 里用 `(...) &` 起的后台任务会随 CGI 退出被 SIGHUP/进程组清理杀掉；
 * 必须用 start-stop-daemon -b（setsid + 脱离）托管延时动作。
 */
function detached(name, body) {
	ensure_dirs();
	let script = ADMIN_RUNTIME + '/' + name + '.sh';
	if (writefile(script, '#!/bin/sh\n' + body) == null) return false;
	chmod(script, 0700);
	return command('/sbin/start-stop-daemon -S -b -x ' + script).code == 0;
}
function request_reboot() {
	if (detached('reboot-request', 'sync\nsleep 3\nexec /sbin/reboot\n')) return true;
	return command('/sbin/reboot >/dev/null 2>&1').code == 0;
}
function request_factory_reset() {
	if (detached('factory-reset', 'sync\nsleep 3\n/sbin/firstboot -y && exec /sbin/reboot\n')) return true;
	return command('/sbin/firstboot -y && /sbin/reboot >/dev/null 2>&1').code == 0;
}

export const CONFIGS=['network','wireless','dhcp','system','firewall','upnpd','mp716_system','mp716_vpn','pptpd','xl2tp','ipsec','openvpn'];
const VPN_FILES=['client.ovpn','ca.pem','client.crt','client.key','ta.key','auth'];
function integer(v,low,high) { return type(v)=='int' && v>=low && v<=high; }
function text(v,maxlen) { return type(v)=='string' && length(v)<=maxlen && index(v,'\x00')<0 && !match(v,/[[:cntrl:]]/); }
function host(v) {
	if (!text(v,253) || !length(v)) return false;
	if(match(v,/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/)) {
		for(let part in split(v,'.'))if(length(part)>3||int(part)>255)return false;
		return true;
	}
	for (let label in split(v,'.')) if (!match(label,/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/)) return false;
	return true;
};
function section(c,pkg,kind,fallback) {
	let found=null;c.foreach(pkg,kind,(s)=>{if(!found)found=s['.name'];});return found || fallback;
};
function list(v) { return type(v)=='array'?v:(v?[v]:[]); }
function flag(value,fallback) {
	if(value==null)return fallback;
	return index(['0','off','false','no','disabled'],lc(sprintf('%s',value)))<0;
}
function format_time(t,filename) {
	return filename?sprintf('%04d%02d%02d-%02d%02d%02d',t.year,t.mon,t.mday,t.hour,t.min,t.sec):
		sprintf('%04d-%02d-%02d %02d:%02d:%02d',t.year,t.mon,t.mday,t.hour,t.min,t.sec);
}
function timezone(c) {
	let zone=c.get('system',section(c,'system','system','system'),'timezone') || 'UTC';
	if(!text(zone,100) || !match(zone,/^[A-Za-z0-9<>+,:.\/-]+$/))die('时区无效');
	return zone;
}
export function parse_localtime(raw) {
	let fields=match(trim(raw || ''),/^([0-9]{4}) ([0-9]{2}) ([0-9]{2}) ([1-7]) ([0-9]{2}) ([0-9]{2}) ([0-9]{2})$/);
	if(!fields)die('无法读取设备本地时间');
	let result={year:int(fields[1]),mon:int(fields[2]),mday:int(fields[3]),wday:int(fields[4]),hour:int(fields[5]),min:int(fields[6]),sec:int(fields[7])};
	if(result.mon<1||result.mon>12||result.mday<1||result.mday>31||result.hour>23||result.min>59||result.sec>60)die('设备时间无效');
	return result;
};
function configured_localtime(c) {
	// uhttpd and the supervisor may have inherited the previous TZ at boot.
	// Read the configured zone for each new request/tick instead of inheriting it.
	let result=command("TZ='"+timezone(c)+"' /bin/busybox date '+%Y %m %d %u %H %M %S'");
	if(result.code!=0)die('无法读取设备本地时间');
	return parse_localtime(result.output);
}
export function validate_browser_time(value) {
	let fields=type(value)=='string'?match(value,/^(20[0-9]{2})-(0[1-9]|1[0-2])-([0-2][0-9]|3[01]) ([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/):null;
	if(!fields)die('浏览器时间无效');
	let y=int(fields[1]), m=int(fields[2]), d=int(fields[3]);
	let days=[31,(y%4==0 && (y%100!=0 || y%400==0))?29:28,31,30,31,30,31,31,30,31,30,31];
	if(d<1||d>days[m-1])die('浏览器日期无效');
	return value;
};
export function validate_password_change(body) {
	if(!text(body.oldPassword,128)||!length(body.oldPassword)||!text(body.newPassword,32)||length(body.newPassword)<5||body.oldPassword==body.newPassword)die('管理员新密码必须为 5–32 位且不同于原密码');
	return body;
};
function time_config(c) {
	let servers=list(c.get('system','ntp','server')), slots=null;
	try{slots=json(c.get('system','ntp','mp716_slots') || 'null');}catch(e){}
	if(type(slots)=='array'&&length(slots)==3&&sprintf('%J',filter(slots,(s)=>type(s)=='string'&&length(s)>0))==sprintf('%J',servers))servers=slots;
	return {timezone:timezone(c),
		ntpEnabled:!!c.get('system','ntp')&&flag(c.get('system','ntp','enabled'),true),ntpServers:servers,
		localTime:format_time(configured_localtime(c))};
};
export function validate_time(cfg) {
	if (!text(cfg.timezone,100) || !match(cfg.timezone,/^[A-Za-z0-9<>+,:.\/-]+$/)) die('时区无效');
	if (type(cfg.ntpEnabled)!='bool' || type(cfg.ntpServers)!='array' || length(cfg.ntpServers)>3) die('NTP 设置无效');
	for (let server in cfg.ntpServers) if (server!='' && !host(server)) die('NTP 服务器无效');
	if (cfg.ntpEnabled && !length(filter(cfg.ntpServers,(s)=>length(s)))) die('请填写 NTP 服务器');
	return cfg;
};
export function validate_schedule(cfg) {
	if (!integer(cfg.mode,0,2) || !integer(cfg.remainHour,0,23) || !integer(cfg.remainMinute,0,59) ||
		!integer(cfg.hour,0,23) || !integer(cfg.minute,0,59) || !integer(cfg.weeks,0,255)) die('定时重启设置无效');
	if (cfg.mode==1 && cfg.remainHour*60+cfg.remainMinute<10) die('倒计时至少为 10 分钟');
	if(cfg.weeks>127 && cfg.weeks!=255)die('重启日期无效');
	if (cfg.mode==2 && !(cfg.weeks & 127)) die('请选择重启日期');
	return cfg;
};
function schedule(c) {
	let s=c.get_all('mp716_system','schedule') || {};
	let sameboot=s.boot==trim(readfile('/proc/sys/kernel/random/boot_id') || '');
	return {mode:int(s.mode)==1 && !sameboot?0:int(s.mode||0),remainHour:int(s.remainHour||0),remainMinute:int(s.remainMinute||30),
		hour:int(s.hour||0),minute:int(s.minute||0),weeks:int(s.weeks||0),timeDay:time(),
		localTime:format_time(configured_localtime(c)),timezone:timezone(c),
		remainingSec:int(s.mode)==1 && sameboot?max(0,int(s.deadline)-uptime()):0};
};
function ensure_package(c,name) {
	let path='/etc/config/'+name;
	if(!stat(path)) {if(writefile(path,'')==null)die('无法创建配置包');chmod(path,0600);c.load(name);}
}
function main(c) { ensure_package(c,'mp716_system'); if (!c.get('mp716_system','main')) c.set('mp716_system','main','settings'); }
function transaction(owner,packages,kind,fn,extra) {
	let t=begin(owner,packages,kind,90,extra);
	try {fn();return {data:applied(t)};} catch(e) {rollback(t);die(e);}
};
function backup() {
	let files={}, absent=[], vpnFiles={}, total=0;
	for (let name in CONFIGS) {
		let path='/etc/config/'+name, info=stat(path);
		if(info) {
			let raw=readfile(path);if(raw==null)die('无法读取配置备份');
			if(length(raw)>262144)die('配置文件超出备份限制');
			total+=length(raw);files[name]={contentBase64:b64enc(raw),mode:info.mode & 0777};
		} else push(absent,name);
	}
	for(let name in VPN_FILES) {
		let raw=readfile('/etc/mp716-vpn/'+name);
		if(raw==null) {vpnFiles[name]=null;continue;}
		if(length(raw)>262144)die('VPN 文件超出备份限制');
		total+=length(raw);vpnFiles[name]={contentBase64:b64enc(raw),mode:0600};
	}
	let shadow=readfile('/etc/shadow');
	if(total+length(shadow || '')>1048576)die('配置备份超过 1 MiB 限制');
	let document={format:'MP716-CONFIG',version:1,product:'MP716',files:files,absentConfigs:absent,vpnFiles:vpnFiles,rootShadow:shadow?b64enc(shadow):null};
	return sprintf('%J',document);
};
function validate_shadow(value) {
	if(type(value)!='string'||length(value)>16384||index(value,'\x00')>=0)die('账号备份无效');
	let incoming=split(value,'\n'), current=split(readfile('/etc/shadow') || '','\n');
	if(length(incoming)!=length(current))die('账号备份无效');
	let root_found=false;
	for(let i=0;i<length(incoming);i++) {
		if(index(current[i],'root:')==0) {
			if(root_found)die('账号备份无效');root_found=true;
			let fields=split(incoming[i],':');
			if(fields[0]!='root' || length(fields)!=9 || !match(fields[1],/^[!*$A-Za-z0-9.\/-]+$/))die('管理员凭据无效');
			for(let n=2;n<9;n++)if(!match(fields[n],/^(|-?[0-9]+)$/))die('管理员凭据无效');
		} else if(incoming[i]!=current[i])die('备份不能变更其他系统账号');
	}
	if(!root_found)die('备份缺少管理员账号');
};
function clean_restore(dir) {
	for(let name in CONFIGS) {unlink(dir+'/'+name);unlink(dir+'/uci/'+name);}
	rmdir(dir+'/uci');rmdir(dir);
}
function restore(c,owner,doc) {
	if(doc?.format!='MP716-CONFIG'||doc.version!=1||doc.product!='MP716'||type(doc.files)!='object')die('请选择本机自研后台的配置备份');
	let packages=[],decoded={}, extra={}, extras=[], absent=doc.absentConfigs || [], total=0;
	if(type(absent)!='array')die('配置缺失清单无效');
	for(let name,row in doc.files) {
		if(index(CONFIGS,name)<0 || !row || index([0600,0644],row.mode)<0 || type(row.contentBase64)!='string')die('配置备份含不允许的文件');
		let raw=b64dec(row.contentBase64);
		if(type(raw)!='string'||b64enc(raw)!=row.contentBase64||length(raw)>262144||index(raw,'\x00')>=0||match(raw,/[\x01-\x08\x0b\x0c\x0e-\x1f]/))die('配置文件无效');
		total+=length(raw);decoded[name]=raw;push(packages,name);
	}
	for(let name in absent) {
		if(index(CONFIGS,name)<0||index(packages,name)>=0)die('配置缺失清单无效');
		push(packages,name);
	}
	if(doc.vpnFiles!=null) {
		if(type(doc.vpnFiles)!='object')die('VPN 配置备份无效');
		for(let name,row in doc.vpnFiles) {
			if(index(VPN_FILES,name)<0)die('VPN 备份含不允许的文件');
			let raw=null;
			if(row!=null) {
				if(type(row)!='object'||row.mode!=0600||type(row.contentBase64)!='string')die('VPN 文件备份无效');
				raw=b64dec(row.contentBase64);
				if(type(raw)!='string'||length(raw)>262144||b64enc(raw)!=row.contentBase64||index(raw,'\x00')>=0)die('VPN 文件备份无效');
				if(name=='client.ovpn')raw=validate_openvpn(raw);
				total+=length(raw);
			}
			let path='/etc/mp716-vpn/'+name;extra[path]=raw;push(extras,path);
		}
	}
	let shadow=null;
	if(doc.rootShadow!=null) {
		if(type(doc.rootShadow)!='string')die('账号备份无效');
		shadow=b64dec(doc.rootShadow);if(type(shadow)!='string'||b64enc(shadow)!=doc.rootShadow)die('账号备份无效');
		validate_shadow(shadow);total+=length(shadow);push(extras,'/etc/shadow');
	}
	if(total>1048576 || !length(packages))die('配置备份大小无效');
	let nonce=replace(trim(readfile('/proc/sys/kernel/random/uuid') || ''),/-/g,'');
	if(!match(nonce,/^[a-f0-9]{32}$/))die('无法准备配置恢复');
	let dir='/tmp/mp716-restore-'+owner+'-'+nonce;
	if(!mkdir(dir,0700)||!mkdir(dir+'/uci',0700))die('无法准备配置恢复');
	let result;
	try {
	for(let name,raw in decoded) { if(writefile(dir+'/'+name,raw)==null)die('无法准备配置');chmod(dir+'/'+name,0600); }
	let check=cursor(dir,dir+'/uci');
	for(let name in keys(decoded)) if(!check.load(name))die('UCI 配置格式无效');
	// A restored countdown begins now; old monotonic deadlines are never reused.
	if(index(packages,'mp716_system')>=0 && check.get('mp716_system','schedule')) {
		let s=check.get_all('mp716_system','schedule');
		let cfg=validate_schedule({mode:int(s.mode||0),remainHour:int(s.remainHour||0),remainMinute:int(s.remainMinute||30),hour:int(s.hour||0),minute:int(s.minute||0),weeks:int(s.weeks||0)});
		check.set('mp716_system','schedule','boot',trim(readfile('/proc/sys/kernel/random/boot_id')||''));
		check.set('mp716_system','schedule','deadline',sprintf('%d',uptime()+cfg.remainHour*3600+cfg.remainMinute*60));
		check.delete('mp716_system','schedule','last');
		if(!check.commit('mp716_system'))die('无法准备定时重启配置');
		decoded.mp716_system=readfile(dir+'/mp716_system');
	}
	// Restoring a backup can never replace code, boot data or upgrade gates.
	result=transaction(owner,packages,'all',()=>{
		for(let name,raw in decoded) {
			let target='/etc/config/'+name;
			if(writefile(target+'.mp716-new',raw)==null)die('无法写入配置');
			chmod(target+'.mp716-new',doc.files[name].mode);
			if(!rename(target+'.mp716-new',target))die('无法提交配置');
		}
		for(let name in absent)if(stat('/etc/config/'+name)&&!unlink('/etc/config/'+name))die('无法恢复原有配置缺失状态');
		if(length(keys(extra))) {
			if(length(filter(keys(extra),(path)=>extra[path]!=null))) {mkdir('/etc/mp716-vpn',0700);chmod('/etc/mp716-vpn',0700);}
			for(let path,raw in extra) {
				if(raw==null) {if(stat(path)&&!unlink(path))die('无法恢复原有 VPN 文件状态');continue;}
				if(writefile(path+'.mp716-new',raw)==null)die('无法恢复 VPN 文件');
				chmod(path+'.mp716-new',0600);if(!rename(path+'.mp716-new',path))die('无法恢复 VPN 文件');
			}
		}
		if(shadow) {
			if(writefile('/etc/shadow.mp716-new',shadow)==null)die('无法恢复管理员凭据');
			chmod('/etc/shadow.mp716-new',0600);
			if(!rename('/etc/shadow.mp716-new','/etc/shadow'))die('无法恢复管理员凭据');
		}
	},extras);
	}catch(e){clean_restore(dir);die(e);}
	clean_restore(dir);return result;
};
function running(instance) {return instance?.running==true && type(instance.pid)=='int' && instance.pid>1;}
export function system_service_health(bus,expected) {
	let ntp=bus.call('service','list',{name:'sysntpd'}),log=bus.call('service','list',{name:'log'});
	if(ntp==null || log==null)return {ready:false,missing:['service-manager'],unexpected:[]};
	let ntp_running=false,log_running=running(log.log?.instances?.logd),missing=[],unexpected=[];
	for(let name,instance in ntp.sysntpd?.instances || {})if(running(instance))ntp_running=true;
	if(expected.ntp && !ntp_running)push(missing,'ntpd');
	if(!expected.ntp && ntp_running)push(unexpected,'ntpd');
	if(expected.logging && !log_running)push(missing,'logd');
	if(!expected.logging && log_running)push(unexpected,'logd');
	return {ready:!length(missing)&&!length(unexpected),missing:missing,unexpected:unexpected,ntpRunning:ntp_running,logRunning:!!log_running};
};
function expected_services(c,bus) {
	let servers=list(c.get('system','ntp','server'));
	if(flag(c.get('system','ntp','use_dhcp'),true)) {
		let interfaces=list(c.get('system','ntp','dhcp_interface'));
		for(let iface in bus.call('network.interface','dump',{})?.interface || [])
			if(!length(interfaces)||index(interfaces,iface.interface)>=0)
				for(let server in list(iface.data?.ntpserver))if(type(server)=='string'&&length(server))push(servers,server);
	}
	return {ntp:!!c.get('system','ntp') && flag(c.get('system','ntp','enabled'),true) &&
		(length(servers)>0 || flag(c.get('system','ntp','enable_server'),false)),logging:c.get('mp716_system','main','logging')!='0'};
}
export function apply_system() {
	let c=cursor();
	if(command('/etc/init.d/system reload >/dev/null 2>&1').code!=0)die('无法应用系统时区');
	// validate_data substitutes UTC for an empty zonename. Enforce the UI's
	// selected POSIX TZ after system.reload, even when zoneinfo/UTC is installed.
	if(!c.get('system',section(c,'system','system','system'),'zonename')) {
		if(writefile('/tmp/TZ.mp716-new',timezone(c)+'\n')==null)die('无法更新系统时区缓存');
		chmod('/tmp/TZ.mp716-new',0644);
		if(!rename('/tmp/TZ.mp716-new','/tmp/TZ'))die('无法提交系统时区缓存');
		let existing=stat('/tmp/localtime');
		if(!unlink('/tmp/localtime') && existing)die('无法更新系统时区缓存');
	}
	if(command('/etc/init.d/sysntpd restart >/dev/null 2>&1').code!=0)die('无法应用 NTP 服务');
	let logging=c.get('mp716_system','main','logging')=='0'?'stop':'start';
	if(command('/etc/init.d/log '+logging+' >/dev/null 2>&1').code!=0)die('无法应用日志服务');
	let bus=connect();if(!bus)die('系统服务状态不可用');
	let expected=expected_services(c,bus),health;
	for(let attempt=0;attempt<5;attempt++) {
		health=system_service_health(bus,expected);if(health.ready)return true;
		command('/bin/busybox sleep 1');
	}
	die('系统服务尚未就绪: '+join(',',health.missing || [])+join(',',health.unexpected || []));
};
export function schedule_due(s,boot,current_uptime,epoch,now) {
	if(int(s.mode)==1)return {fire:s.boot==boot&&int(s.deadline)>0&&current_uptime>=int(s.deadline),countdown:true};
	if(int(s.mode)!=2||epoch<=1700000000)return {fire:false};
	let stamp=substr(format_time(now),0,16),day=now.wday%7;
	return {fire:!!((int(s.weeks)&(1<<day))&&int(s.hour)==now.hour&&int(s.minute)==now.min&&s.last!=stamp),stamp:stamp};
};
export function tick_system() {
	if(!acquire())return;
	try {
		if(!pending()) {
			let c=cursor(), s=c.get_all('mp716_system','schedule') || {};
			let boot=trim(readfile('/proc/sys/kernel/random/boot_id') || '');
			let decision=schedule_due(s,boot,uptime(),time(),int(s.mode)==2?configured_localtime(c):null);
			if(decision.fire) {
				if(decision.countdown)c.set('mp716_system','schedule','mode','0');
				else c.set('mp716_system','schedule','last',decision.stamp);
				if(!c.commit('mp716_system'))die('无法保存定时重启状态');
				command('/sbin/reboot >/dev/null 2>&1');
			}
		}
	} catch(e) { release();die(e); }
	release();
};
export function route_system(bus,method,path,body,owner) {
	let paths=['system/time','system/time/browser','system/sche-reboot','system/password','system/backup','system/backup/download','system/restore','system/reboot','system/factory-reset','system/logs','system/logs/clear'];
	if(index(paths,path)<0)return null;
	if(!match(owner || '',/^[a-f0-9]{32}$/))return {error:'VALIDATION',message:'无效会话'};
	let c=cursor();
	if(method=='GET') {
		if(path=='system/time')return {data:time_config(c)};
		if(path=='system/sche-reboot')return {data:schedule(c)};
		if(path=='system/logs') {let enabled=c.get('mp716_system','main','logging')!='0';return {data:{enabled:enabled,content:enabled?command('/sbin/logread -l 100').output:''}};}
		return {error:'VALIDATION',message:'此操作需要 POST'};
	}
	if(method!='POST')return {error:'VALIDATION',message:'无效请求方式'};
	/* 配置导出为只读，不得被其他页未确认的 config-task 挡住（避免 409） */
	if(path=='system/backup/download') {
		return {data:{filename:'mp716-config-'+format_time(configured_localtime(c),true)+'.json',mime:'application/json',contentBase64:b64enc(backup())}};
	}
	if(path=='system/backup') {
		let raw=backup(), file='/tmp/mp716-backup-'+owner+'.json';
		writefile(file,raw); chmod(file,0600);
		let checksum=split(command('/usr/bin/sha256sum '+file).output,' ')[0];
		unlink(file);
		return {data:{filename:'mp716-config.json',size:length(raw),checksum:checksum}};
	}
	if(!acquire())return {error:'DEVICE_BUSY',message:'另一个设备操作正在执行'};
	let result;
	try {result=(function(){
		expire();if(blocking_pending())return {error:'DEVICE_BUSY',message:'请先确认或撤销当前配置'};dismiss_failed_pending();
		if(path=='system/restore')return restore(c,owner,body.backup);
		if(path=='system/time') {
			let cfg=validate_time(body.config || body);
			return transaction(owner,['system'],'system',()=>{
				let name=section(c,'system','system','system');if(!c.get('system',name))c.set('system',name,'system');
				c.set('system',name,'timezone',cfg.timezone);
				// This UI owns a POSIX TZ, so do not retain a conflicting named zone.
				c.set('system',name,'zonename','');
				if(!c.get('system','ntp'))c.set('system','ntp','timeserver');
				let servers=filter(cfg.ntpServers,(s)=>length(s)>0);
				c.set('system','ntp','enabled',cfg.ntpEnabled?'1':'0');
				if(length(servers))c.set('system','ntp','server',servers);else c.delete('system','ntp','server');
				c.set('system','ntp','mp716_slots',sprintf('%J',[cfg.ntpServers[0]||'',cfg.ntpServers[1]||'',cfg.ntpServers[2]||'']));
				if(!c.commit('system'))die('无法保存 NTP 配置');
			});
		}
		if(path=='system/time/browser') {
			validate_browser_time(body.localTime);
			if(command("TZ='"+timezone(c)+"' /bin/busybox date -s '"+body.localTime+"' >/dev/null 2>&1").code!=0)die('无法设置系统时间');
			return {data:null};
		}
		if(path=='system/sche-reboot') {
			let cfg=validate_schedule(body.config || body);
			return transaction(owner,['mp716_system'],'none',()=>{
				ensure_package(c,'mp716_system');
				if(!c.get('mp716_system','schedule'))c.set('mp716_system','schedule','schedule');
				for(let name in ['mode','remainHour','remainMinute','hour','minute','weeks'])c.set('mp716_system','schedule',name,sprintf('%d',cfg[name]));
				c.set('mp716_system','schedule','boot',trim(readfile('/proc/sys/kernel/random/boot_id') || ''));
				c.set('mp716_system','schedule','deadline',sprintf('%d',uptime()+cfg.remainHour*3600+cfg.remainMinute*60));
				c.delete('mp716_system','schedule','last');if(!c.commit('mp716_system'))die('无法保存定时重启');
			});
		}
		if(path=='system/password') {
			validate_password_change(body);
			let auth=bus.call('session','login',{username:'root',password:body.oldPassword,timeout:1});
			if(!auth?.ubus_rpc_session)die('原密码不正确');
			bus.call('session','destroy',{ubus_rpc_session:auth.ubus_rpc_session});
			let process=popen('/bin/busybox passwd root >/dev/null 2>&1','w');if(!process)die('无法启动密码修改');
			process.write(body.newPassword+'\n'+body.newPassword+'\n');if(process.close()!=0)die('无法修改密码');
			return {data:null};
		}
		if(path=='system/logs') {
			if(type(body.enabled)!='bool')die('日志开关无效');
			return transaction(owner,['mp716_system'],'system',()=>{main(c);c.set('mp716_system','main','logging',body.enabled?'1':'0');if(!c.commit('mp716_system'))die('无法保存日志设置');});
		}
		if(path=='system/logs/clear') {
			let action=c.get('mp716_system','main','logging')=='0'?'stop':'restart';
			if(command('/etc/init.d/log '+action+' >/dev/null 2>&1').code!=0)die('无法清空日志');return {data:null};
		}
		if(path=='system/reboot') {
			if (!request_reboot()) die('无法提交重启请求');
			return {data:{accepted:true,rollbackSec:0}};
		}
		if(path=='system/factory-reset') {
			if(body.confirmToken!='RESET')die('请确认恢复出厂设置');
			if (!request_factory_reset()) die('无法提交恢复出厂请求');
			return {data:{accepted:true,rollbackSec:0}};
		}
	})();}catch(e){result={error:'VALIDATION',message:e.message || sprintf('%s', e)};}
	release();return result;
};
