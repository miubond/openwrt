'use strict';
import { readfile, stat, glob } from 'fs';
const RUNTIME='/var/run/mp716-vpn';

export function service_requirements(m) {
	let paths=[], enabled=false;
	for(let kind in ['pptp','pptpd','xl2tp','xl2tpd','openvpn']) {
		let cfg=m[kind];if(!cfg?.enabled)continue;enabled=true;
		if(kind!='openvpn')push(paths,'/usr/sbin/pppd');
		if(kind=='pptp')push(paths,'/lib/netifd/proto/pptp.sh');
		if(kind=='pptpd')push(paths,'/usr/sbin/pptpd');
		if(kind=='xl2tp'||kind=='xl2tpd')push(paths,'/usr/sbin/xl2tpd');
		if(kind=='xl2tp')push(paths,'/lib/netifd/proto/l2tp.sh');
		if(kind=='openvpn')push(paths,'/usr/sbin/openvpn');
		if(kind=='xl2tp'&&length(cfg.ipsecKey||'')||kind=='xl2tpd'&&cfg.ipsecEnabled)push(paths,'/usr/lib/ipsec/starter');
	}
	if(enabled)push(paths,'/etc/init.d/mp716-vpn','/usr/share/mp716/vpn-render.uc');
	return paths;
};
export function validate_service_ownership(m,processes) {
	for(let process in processes) {
		let cmd=process.cmd || '', executable=pop(split(split(cmd,'\x00')[0] || '','/'));
		if(executable=='pptpd'&&m.pptpd?.enabled || executable=='xl2tpd'&&(m.xl2tp?.enabled||m.xl2tpd?.enabled)) {
			if(index(cmd,RUNTIME+'/')<0)die('检测到非本后台托管的 '+executable+'，请先迁移或关闭该服务');
		}
		let ipsec=m.xl2tp?.enabled&&length(m.xl2tp.ipsecKey||'') || m.xl2tpd?.enabled&&m.xl2tpd.ipsecEnabled;
		if(ipsec&&index(['starter','charon'],executable)>=0&&index(cmd,RUNTIME+'/')<0&&index(process.environ || '','STRONGSWAN_CONF='+RUNTIME+'/')<0)
			die('检测到非本后台托管的 IPSec 服务，请先迁移或关闭该服务');
	}
	return true;
};
export function check_vpn_services(m) {
	let paths=service_requirements(m);
	for(let path in paths)if(!stat(path))die('当前固件缺少 VPN 服务，请先安装配套固件: '+path);
	if(!length(paths))return true;
	let processes=[];
	for(let path in glob('/proc/[0-9]*/cmdline') || [])push(processes,{cmd:readfile(path)||'',environ:readfile(replace(path,/\/cmdline$/,'/environ'))||''});
	return validate_service_ownership(m,processes);
};
export function vpn_service_health(bus,m) {
	let expected=[];
	if(m.pptpd?.enabled)push(expected,'pptp');
	if(m.xl2tp?.enabled||m.xl2tpd?.enabled)push(expected,'l2tp');
	if(m.openvpn?.enabled)push(expected,'openvpn');
	if(m.xl2tp?.enabled&&length(m.xl2tp.ipsecKey||'') || m.xl2tpd?.enabled&&m.xl2tpd.ipsecEnabled)push(expected,'ipsec');
	let instances=bus.call('service','list',{name:'mp716-vpn'})?.['mp716-vpn']?.instances || {}, missing=[], unexpected=[];
	for(let name in expected)if(instances[name]?.running!=true || !(instances[name]?.pid>1))push(missing,name);
	for(let name in ['pptp','l2tp','openvpn','ipsec'])if(index(expected,name)<0 && instances[name]?.running==true)push(unexpected,name);
	// This checks process readiness only. Tunnel connection state comes from
	// netifd and authenticated OpenVPN hooks, never from this readiness result.
	return {ready:!length(missing)&&!length(unexpected),missing:missing,unexpected:unexpected,expected:expected};
};
