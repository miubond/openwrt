'use strict';
import { cursor } from 'uci';
import { readfile, writefile, mkdir, chmod, rename, unlink, stat, popen } from 'fs';
import { command, store, load, acquire, release, expire, pending, begin, applied, rollback, uptime } from '/usr/share/mp716/admin-state.uc';

export const CONFIGS=['network','wireless','dhcp','system','firewall','upnpd','mp716_system','mp716_vpn','pptpd','xl2tp','ipsec','openvpn'];
function integer(v,low,high) { return type(v)=='int' && v>=low && v<=high; }
function text(v,maxlen) { return type(v)=='string' && length(v)<=maxlen && index(v,'\x00')<0 && !match(v,/[[:cntrl:]]/); }
function host(v) {
	if (!text(v,253) || !length(v)) return false;
	for (let label in split(v,'.')) if (!match(label,/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/)) return false;
	return true;
};
function section(c,pkg,kind,fallback) {
	let found=null;c.foreach(pkg,kind,(s)=>{if(!found)found=s['.name'];});return found || fallback;
};
function list(v) { return type(v)=='array'?v:(v?[v]:[]); }
function format_time(t,filename) {
	return filename?sprintf('%04d%02d%02d-%02d%02d%02d',t.year,t.mon,t.mday,t.hour,t.min,t.sec):
		sprintf('%04d-%02d-%02d %02d:%02d:%02d',t.year,t.mon,t.mday,t.hour,t.min,t.sec);
}
function time_config(c) {
	return {timezone:c.get('system',section(c,'system','system','system'),'timezone') || 'UTC',
		ntpEnabled:c.get('system','ntp','enabled')!='0',ntpServers:list(c.get('system','ntp','server')),
		localTime:format_time(localtime())};
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
	if (cfg.mode==1 && cfg.remainHour*60+cfg.remainMinute<1) die('倒计时至少为 1 分钟');
	if (cfg.mode==2 && !(cfg.weeks & 127)) die('请选择重启日期');
	return cfg;
};
function schedule(c) {
	let s=c.get_all('mp716_system','schedule') || {};
	let sameboot=s.boot==trim(readfile('/proc/sys/kernel/random/boot_id') || '');
	return {mode:int(s.mode||0),remainHour:int(s.remainHour||0),remainMinute:int(s.remainMinute||30),
		hour:int(s.hour||0),minute:int(s.minute||0),weeks:int(s.weeks||0),timeDay:time(),
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
	let files={};
	for (let name in CONFIGS) {
		let path='/etc/config/'+name, info=stat(path);
		if(info) files[name]={contentBase64:b64enc(readfile(path)||''),mode:info.mode & 0777};
	}
	let shadow=readfile('/etc/shadow');
	let document={format:'MP716-CONFIG',version:1,product:'MP716',files:files,rootShadow:shadow?b64enc(shadow):null};
	return sprintf('%J',document);
};
function validate_shadow(value) {
	let incoming=split(value,'\n'), current=split(readfile('/etc/shadow') || '','\n');
	if(length(incoming)!=length(current))die('账号备份无效');
	for(let i=0;i<length(incoming);i++) {
		if(index(current[i],'root:')==0) {
			let fields=split(incoming[i],':');
			if(fields[0]!='root' || length(fields)!=9 || !match(fields[1],/^[!*$A-Za-z0-9.\/-]+$/))die('管理员凭据无效');
			for(let n=2;n<9;n++)if(!match(fields[n],/^(|-?[0-9]+)$/))die('管理员凭据无效');
		} else if(incoming[i]!=current[i])die('备份不能变更其他系统账号');
	}
};
function restore(c,owner,doc) {
	if(doc?.format!='MP716-CONFIG'||doc.version!=1||doc.product!='MP716'||type(doc.files)!='object')die('请选择本机自研后台的配置备份');
	let packages=[],decoded={}, total=0;
	for(let name,row in doc.files) {
		if(index(CONFIGS,name)<0 || !row || index([0600,0644],row.mode)<0 || type(row.contentBase64)!='string')die('配置备份含不允许的文件');
		let raw=b64dec(row.contentBase64);
		if(type(raw)!='string'||b64enc(raw)!=row.contentBase64||length(raw)>262144||index(raw,'\x00')>=0||match(raw,/[\x01-\x08\x0b\x0c\x0e-\x1f]/))die('配置文件无效');
		total+=length(raw);decoded[name]=raw;push(packages,name);
	}
	if(total>1048576 || !length(packages))die('配置备份大小无效');
	let shadow=doc.rootShadow?b64dec(doc.rootShadow):null;
	if(shadow)validate_shadow(shadow);
	let dir='/tmp/mp716-restore-'+owner;mkdir(dir,0700);mkdir(dir+'/uci',0700);
	for(let name,raw in decoded) { if(writefile(dir+'/'+name,raw)==null)die('无法准备配置');chmod(dir+'/'+name,0600); }
	let check=cursor(dir,dir+'/uci');
	for(let name in packages) if(!check.load(name))die('UCI 配置格式无效');
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
	return transaction(owner,packages,'all',()=>{
		for(let name,raw in decoded) {
			let target='/etc/config/'+name;
			if(writefile(target+'.mp716-new',raw)==null)die('无法写入配置');
			chmod(target+'.mp716-new',doc.files[name].mode);
			if(!rename(target+'.mp716-new',target))die('无法提交配置');
		}
		if(shadow) {
			if(writefile('/etc/shadow.mp716-new',shadow)==null)die('无法恢复管理员凭据');
			chmod('/etc/shadow.mp716-new',0600);
			if(!rename('/etc/shadow.mp716-new','/etc/shadow'))die('无法恢复管理员凭据');
		}
	},shadow?['/etc/shadow']:[]);
};
export function apply_system() {
	let c=cursor();
	command('/etc/init.d/system reload >/dev/null 2>&1');
	command('/etc/init.d/sysntpd restart >/dev/null 2>&1');
	if(c.get('mp716_system','main','logging')=='0')command('/etc/init.d/log stop >/dev/null 2>&1');
	else command('/etc/init.d/log start >/dev/null 2>&1');
};
export function tick_system() {
	if(!acquire())return;
	try {
		if(!pending()) {
			let c=cursor(), s=c.get_all('mp716_system','schedule') || {}, mode=int(s.mode), fire=false;
			let boot=trim(readfile('/proc/sys/kernel/random/boot_id') || '');
			if(mode==1 && s.boot==boot && int(s.deadline)>0 && uptime()>=int(s.deadline)) {
				c.set('mp716_system','schedule','mode','0');c.commit('mp716_system');fire=true;
			}
			if(mode==2 && time()>1700000000) {
				let now=localtime(), day=now.wday%7, stamp=substr(format_time(now),0,16);
				if((int(s.weeks)&(1<<day)) && int(s.hour)==now.hour && int(s.minute)==now.min && s.last!=stamp) {
					c.set('mp716_system','schedule','last',stamp);c.commit('mp716_system');fire=true;
				}
			}
			if(fire) command('/sbin/reboot >/dev/null 2>&1');
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
		if(path=='system/logs') {let enabled=c.get('mp716_system','main','logging')!='0';return {data:{enabled:enabled,content:enabled?command('/sbin/logread -l 200').output:''}};}
		return {error:'VALIDATION',message:'此操作需要 POST'};
	}
	if(method!='POST')return {error:'VALIDATION',message:'无效请求方式'};
	if(!acquire())return {error:'DEVICE_BUSY',message:'另一个设备操作正在执行'};
	let result;
	try {result=(function(){
		expire();if(pending())return {error:'DEVICE_BUSY',message:'请先确认或撤销当前配置'};
		if(path=='system/backup/download')return {data:{filename:'mp716-config-'+format_time(localtime(),true)+'.json',mime:'application/json',contentBase64:b64enc(backup())}};
		if(path=='system/backup') {
			let raw=backup(), file='/tmp/mp716-backup-'+owner+'.json';writefile(file,raw);chmod(file,0600);
			let checksum=split(command('/usr/bin/sha256sum '+file).output,' ')[0];unlink(file);
			return {data:{filename:'mp716-config.json',size:length(raw),checksum:checksum}};
		}
		if(path=='system/restore')return restore(c,owner,body.backup);
		if(path=='system/time') {
			let cfg=validate_time(body.config || body);
			return transaction(owner,['system'],'system',()=>{
				let name=section(c,'system','system','system');if(!c.get('system',name))c.set('system',name,'system');
				c.set('system',name,'timezone',cfg.timezone);
				if(!c.get('system','ntp'))c.set('system','ntp','timeserver');
				c.set('system','ntp','enabled',cfg.ntpEnabled?'1':'0');c.set('system','ntp','server',filter(cfg.ntpServers,(s)=>length(s)>0));
				if(!c.commit('system'))die('无法保存 NTP 配置');
			});
		}
		if(path=='system/time/browser') {
			if(type(body.localTime)!='string'||!match(body.localTime,/^20[0-9]{2}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/))die('浏览器时间无效');
			if(command("/bin/date -s '"+body.localTime+"' >/dev/null 2>&1").code!=0)die('无法设置系统时间');
			return {data:null};
		}
		if(path=='system/sche-reboot') {
			let cfg=validate_schedule(body.config || body);
			return transaction(owner,['mp716_system'],'system',()=>{
				ensure_package(c,'mp716_system');
				if(!c.get('mp716_system','schedule'))c.set('mp716_system','schedule','schedule');
				for(let name in ['mode','remainHour','remainMinute','hour','minute','weeks'])c.set('mp716_system','schedule',name,sprintf('%d',cfg[name]));
				c.set('mp716_system','schedule','boot',trim(readfile('/proc/sys/kernel/random/boot_id') || ''));
				c.set('mp716_system','schedule','deadline',sprintf('%d',uptime()+cfg.remainHour*3600+cfg.remainMinute*60));
				c.delete('mp716_system','schedule','last');if(!c.commit('mp716_system'))die('无法保存定时重启');
			});
		}
		if(path=='system/password') {
			if(!text(body.oldPassword,128)||!text(body.newPassword,128)||length(body.newPassword)<8)die('管理员密码至少为 8 位');
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
			if(command('/etc/init.d/log restart >/dev/null 2>&1').code!=0)die('无法清空日志');return {data:null};
		}
		if(path=='system/reboot') {command('(sleep 3; /sbin/reboot) >/tmp/mp716-admin/reboot.log 2>&1 &');return {data:{accepted:true,rollbackSec:0}};}
		if(path=='system/factory-reset') {
			if(body.confirmToken!='RESET')die('请确认恢复出厂设置');
			command('(sleep 3; /sbin/firstboot -y && /sbin/reboot) >/tmp/mp716-admin/reset.log 2>&1 &');return {data:{accepted:true,rollbackSec:0}};
		}
	})();}catch(e){result={error:'VALIDATION',message:e.message || string(e)};}
	release();return result;
};
