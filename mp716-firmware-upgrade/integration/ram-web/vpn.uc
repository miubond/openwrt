'use strict';
import { cursor } from 'uci';
import { readfile, writefile, mkdir, chmod, rename, stat, glob, unlink } from 'fs';
import { VPN_KINDS, defaults, validate_vpn, validate_openvpn, ip, mask_bits, number_ip } from '/usr/share/mp716/vpn-config.uc';
import { vpn_plan } from '/usr/share/mp716/vpn-runtime.uc';
import { check_vpn_services } from '/usr/share/mp716/vpn-services.uc';
import { command, acquire, release, expire, pending, begin, applied, rollback, store, load } from '/usr/share/mp716/admin-state.uc';

const CONFIG='mp716_vpn', RUNTIME='/var/run/mp716-vpn';
// netifd prepends "pptp-" / "l2tp-" to these names. Keep the resulting
// kernel interface names within IFNAMSIZ (15 visible bytes).
export function client_interface(kind) { return kind=='pptp'?'mp716pptp':'mp716l2tp'; };
function ensure(c) {
	if(!stat('/etc/config/'+CONFIG)){writefile('/etc/config/'+CONFIG,'');chmod('/etc/config/'+CONFIG,0600);c.load(CONFIG);}
}
export function models(c) {
	let result={};
	for(let name in VPN_KINDS) {
		let raw=c.get(CONFIG,name,'data');
		try {result[name]=raw?{...defaults(name),...json(raw)}:defaults(name);}catch(e){die('VPN 配置损坏: '+name);}
	}
	return result;
};
function save(c,name,cfg) {
	if(!c.get(CONFIG,name))c.set(CONFIG,name,'vpn');
	if(!c.set(CONFIG,name,'data',sprintf('%J',cfg)))die('无法保存 VPN 设置');
}
function owned(c,pkg,name,type) {
	let existing=c.get(pkg,name);
	if(existing && c.get(pkg,name,'mp716_managed')!='1')die('配置名称已被其他服务占用: '+name);
	if(!existing && !c.set(pkg,name,type))die('无法创建 VPN 配置');
	c.set(pkg,name,'mp716_managed','1');
}
function cleanup(c,pkg) {
	let names=[];c.foreach(pkg,null,(s)=>{if(s.mp716_managed=='1' && (match(s['.name'],/^mp716_vpn_/) || index(['mp716pptp','mp716l2tp'],s['.name'])>=0))push(names,s['.name']);});
	for(let name in names)c.delete(pkg,name);
}
function configure(c,pkg,name,type,options) {
	owned(c,pkg,name,type);
	for(let key,value in options)if(!c.set(pkg,name,key,value))die('无法写入 VPN 网络配置');
}
export function sync_network(c,m,bus) {
	cleanup(c,'network');cleanup(c,'firewall');
	let clients=[];
	for(let pair in [['pptp','pptp'],['xl2tp','l2tp']]) {
		let cfg=m[pair[0]], name=client_interface(pair[0]);
		if(!cfg.enabled)continue;
		// l2tp.sh writes these inside quoted pppd option lines; escape them for
		// that parser without changing the credentials kept in mp716_vpn.
		let escape=(s)=>replace(replace(s,'\\','\\\\'),'"','\\"');
		// The supervisor brings clients up only after its daemon/control FIFO and
		// IPsec guard are ready. auto=1 races network startup against this service.
		configure(c,'network',name,'interface',{proto:pair[1],server:cfg.server,username:pair[0]=='xl2tp'?escape(cfg.username):cfg.username,password:pair[0]=='xl2tp'?escape(cfg.password):cfg.password,keepalive:'5 5',defaultroute:'0',peerdns:'0',ipv6:'0',auto:'0',checkup_interval:'5',mtu:'1400'});
		if(pair[0]=='pptp') {
			let options=cfg.mppe==0?'require-mppe-128':'nomppe';
			c.set('network',name,'pppd_options',options);
			let routes=cfg.routeType==1?[{target:'0.0.0.0',netmask:'128.0.0.0'},{target:'128.0.0.0',netmask:'128.0.0.0'}]:cfg.routes;
			for(let i,route in routes)configure(c,'network','mp716_vpn_route_'+i,'route',{interface:name,target:route.target+'/'+mask_bits(route.netmask)});
		}
		push(clients,name);
	}
	let enabled=m.pptpd.enabled || m.xl2tpd.enabled || length(clients)>0 || m.openvpn.enabled;
	if(enabled) {
		// fw4 combines positive devices with negative device predicates. PPPoE
		// WAN names start with pppoe- and must never enter the trusted VPN zone.
		let devices=['ppp+','tun-mp716','!pppoe+'];
		let wan=bus?bus.call('network.interface.wan','status',{})?.l3_device:null;
		if(type(wan)=='string'&&match(wan,/^[A-Za-z0-9_.-]{1,15}$/))push(devices,'!'+wan);
		configure(c,'firewall','mp716_vpn_zone','zone',{name:'mp716_vpn',input:'ACCEPT',output:'ACCEPT',forward:'ACCEPT',masq:'1',mtu_fix:'1',network:clients,device:devices});
		for(let pair in [['lan','mp716_vpn'],['mp716_vpn','lan'],['mp716_vpn','wan']])configure(c,'firewall','mp716_vpn_fwd_'+pair[0]+'_'+pair[1],'forwarding',{src:pair[0],dest:pair[1]});
	}
	if(m.pptpd.enabled) {
		configure(c,'firewall','mp716_vpn_pptp','rule',{name:'MP716-PPTP',src:'wan',proto:'tcp',dest_port:'1723',target:'ACCEPT'});
		configure(c,'firewall','mp716_vpn_gre','rule',{name:'MP716-GRE',src:'wan',proto:'gre',target:'ACCEPT'});
	}
	if(m.xl2tpd.enabled) {
		configure(c,'firewall','mp716_vpn_l2tp','rule',{name:'MP716-L2TP',src:'wan',proto:'udp',dest_port:'1701',target:'ACCEPT'});
		if(m.xl2tpd.ipsecEnabled) {
			configure(c,'firewall','mp716_vpn_ike','rule',{name:'MP716-IKE',src:'wan',proto:'udp',dest_port:['500','4500'],target:'ACCEPT'});
			configure(c,'firewall','mp716_vpn_esp','rule',{name:'MP716-ESP',src:'wan',proto:'esp',target:'ACCEPT'});
		}
	}
};
function check_services(kind,cfg) {
	if(!cfg.enabled)return;
	let m={};for(let name in VPN_KINDS)m[name]=defaults(name);m[kind]=cfg;
	check_vpn_services(m);
}
function session_alive(row) {
	if(!row || !match(row.pid || '',/^[1-9][0-9]{0,7}$/))return false;
	let process=readfile('/proc/'+row.pid+'/stat') || '', fields=split(substr(process,index(process,') ')+2),' ');
	return length(fields)>19 && fields[19]==row.started && fields[0]!='Z';
}
function online() {
	let rows=[];
	for(let path in glob(RUNTIME+'/sessions/*.json') || []) {
		let row=load(path);if(!session_alive(row))continue;
		push(rows,{pid:row.pid,username:row.username,type:row.type,dialIp:row.dialIp||'',assignIp:row.assignIp||'',joinedAt:row.joinedAt||''});
	}
	return rows;
}
function public_config(bus,c,kind,m) {
	let cfg={...m[kind]};
	try {check_services(kind,{...m[kind],enabled:true});cfg.serviceAvailable=true;cfg.serviceMessage='';}
	catch(e) {cfg.serviceAvailable=false;cfg.serviceMessage=e.message || string(e);}
	if(kind=='users') {
		cfg.users=map(cfg.users,(u)=>({...u,password:'********'}));cfg.pptpStart=m.pptpd.startIp;cfg.pptpEnd=m.pptpd.endIp;cfg.l2tpStart=m.xl2tpd.startIp;cfg.l2tpEnd=m.xl2tpd.endIp;
	}else {
		if(length(cfg.password||''))cfg.password='********';if(length(cfg.ipsecKey||''))cfg.ipsecKey='********';
		if(kind=='pptp'||kind=='xl2tp') {
			let status=bus.call('network.interface.'+client_interface(kind),'status',{}) || {};
			cfg.status=cfg.enabled?(status.up?1:0):2;cfg.address=(status['ipv4-address'] || [])[0]?.address || '';
			if(kind=='xl2tp')cfg.serverEnabled=m.xl2tpd.enabled;
		}
		if(kind=='openvpn') {let status=load(RUNTIME+'/openvpn-up.json');cfg.status=cfg.enabled?(session_alive(status)?1:0):2;cfg.configUploaded=!!stat('/etc/mp716-vpn/client.ovpn');}
		if((kind=='pptpd'||kind=='xl2tpd')&&!c.get(CONFIG,kind,'data')) {
			let value=c.get('network','lan','ipaddr'), address=type(value)=='array'?value[0]:value;
			if(address)cfg.primaryDns=split(address,'/')[0];
		}
	}
	return cfg;
}
function check_pool(bus,cfg) {
	for(let iface in bus.call('network.interface','dump',{})?.interface || []) {
		if(match(iface.interface || '',/^mp716_vpn_/))continue;
		for(let address in iface['ipv4-address'] || []) {
			let width=1;for(let i=0;i<32-address.mask;i++)width*=2;
			let start=int(number_ip(address.address)/width)*width, end=start+width-1;
			if(number_ip(cfg.startIp)<=end && number_ip(cfg.endIp)>=start)die('VPN 地址池与当前网络重叠');
		}
	}
}
function transaction(c,owner,fn,extra) {
	let t=begin(owner,[CONFIG,'network','firewall'],'vpn',90,extra);
	try {ensure(c);if(!c.load('network')||!c.load('firewall'))die('VPN 所需的网络或防火墙配置不存在');fn();if(!c.commit(CONFIG)||!c.commit('network')||!c.commit('firewall'))die('无法提交 VPN 配置');
		// Client credentials also appear in netifd's UCI package. Restrict that
		// file as well as the private model; rollback restores original modes.
		if(!chmod('/etc/config/'+CONFIG,0600)||!chmod('/etc/config/network',0600))die('无法保护 VPN 凭据文件权限');
		return {data:applied(t)};}
	catch(e){rollback(t);die(e);}
}
function quote(v) {return "'"+replace(v,"'","'\\''")+"'";}
function pem(name,raw) {
	let marker=match(raw,/-----BEGIN (CERTIFICATE|RSA PRIVATE KEY|PRIVATE KEY|EC PRIVATE KEY|OpenVPN Static key V1)-----/);
	if(length(raw)>131072 || index(raw,'\x00')>=0 || !marker || index(raw,'-----END '+marker[1]+'-----')<0)die('证书包中含无效 PEM 文件: '+name);
	return raw;
}
function upload_files(body,owner) {
	if(index(['config','cert'],body.kind)<0 || type(body.filename)!='string'||!match(body.filename,/^[A-Za-z0-9_.-]{1,128}$/) || type(body.contentBase64)!='string'||length(body.contentBase64)>349528)die('OpenVPN 上传参数无效');
	let raw=b64dec(body.contentBase64);
	if(type(raw)!='string' || length(raw)>262144 || b64enc(raw)!=body.contentBase64)die('OpenVPN 文件编码或大小无效');
	if(body.kind=='config')return {'client.ovpn':validate_openvpn(raw)};
	let names={'ca.crt':'ca.pem','ca.pem':'ca.pem','client.crt':'client.crt','client.pem':'client.crt','client.key':'client.key','ta.key':'ta.key','tls-auth.key':'ta.key'}, files={};
	if(substr(raw,0,2)!='\x1f\x8b') {
		let target=names[body.filename] || (match(raw,/-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY|EC PRIVATE KEY)-----/)?'client.key':'ca.pem');
		files[target]=pem(body.filename,raw);return files;
	}
	let dir='/tmp/mp716-vpn-upload-'+owner;mkdir(dir,0700);
	try {
		writefile(dir+'/input.gz',raw);chmod(dir+'/input.gz',0600);
		// Bound output without a pipe: "gzip | head" reports head's status and
		// can accept a corrupt gzip trailer. The file limit bounds a zip bomb,
		// while gzip's actual status now rejects truncated/CRC-invalid input.
		let decompress='ulimit -f 1024 || exit 1; exec /bin/busybox gzip -dc '+quote(dir+'/input.gz')+' > '+quote(dir+'/archive.tar');
		if(command('/bin/busybox timeout 10 /bin/sh -c '+quote(decompress)).code!=0 || (stat(dir+'/archive.tar')?.size || 0)>524288)die('证书包解压失败或超出限制');
		let listing=command('/bin/busybox tar -tvf '+quote(dir+'/archive.tar'));
		if(listing.code!=0)die('证书压缩包无效');
		for(let row in split(trim(listing.output),'\n'))if(!match(row,/^[-d]/))die('证书包不能包含链接或特殊文件');
		listing=command('/bin/busybox tar -tf '+quote(dir+'/archive.tar'));
		if(listing.code!=0)die('证书压缩包目录无效');
		let members=split(trim(listing.output),'\n');if(length(members)>16)die('证书包文件过多');
		for(let member in members) {
			if(member=='./'||member=='')continue;
			let normalized=replace(member,/^\.\//,''), target=names[normalized];
			if(!target || files[target]!=null)die('证书包仅允许 ca.crt、client.crt、client.key 和 ta.key');
			let extracted=command('/bin/busybox tar -xOf '+quote(dir+'/archive.tar')+' '+quote(member));
			if(extracted.code!=0)die('无法读取证书文件');files[target]=pem(normalized,extracted.output);
		}
		if(!length(keys(files)))die('证书包为空');
	} catch(e) {unlink(dir+'/input.gz');unlink(dir+'/archive.tar');die(e);}
	unlink(dir+'/input.gz');unlink(dir+'/archive.tar');return files;
}
export function route_vpn(bus,method,path,body,owner) {
	if(index(path,'vpn/')!=0)return null;
	if(!match(owner || '',/^[a-f0-9]{32}$/))return {error:'VALIDATION',message:'无效会话'};
	let kind=substr(path,4), c=cursor();
	try {
		let m=models(c);
		if(method=='GET') {
			if(kind=='online')return {data:online()};
			if(index(VPN_KINDS,kind)>=0)return {data:public_config(bus,c,kind,m)};
			return null;
		}
		if(method!='POST')return {error:'VALIDATION',message:'无效请求方式'};
		if(!acquire())return {error:'DEVICE_BUSY',message:'另一个配置正在执行'};
		let result;
		try {result=(function(){
			expire();if(pending())return {error:'DEVICE_BUSY',message:'请先确认或撤销当前配置'};
			if(kind=='online/disconnect') {
				if(!match(body.pid || '',/^[1-9][0-9]{0,7}$/))die('VPN 会话无效');
				let row=load(RUNTIME+'/sessions/'+body.pid+'.json');
				if(!session_alive(row)||index(readfile('/proc/'+body.pid+'/cmdline') || '','pppd')<0)die('VPN 会话已失效');
				if(command('/bin/busybox kill -TERM '+body.pid).code!=0)die('无法断开会话');return {data:null};
			}
			if(kind=='openvpn/upload') {
				let files=upload_files(body,owner), extras=map(keys(files),(n)=>'/etc/mp716-vpn/'+n);
				vpn_plan(m,(path)=>files[pop(split(path,'/'))] ?? readfile(path),'');
				return transaction(c,owner,()=>{
					mkdir('/etc/mp716-vpn',0700);chmod('/etc/mp716-vpn',0700);
					for(let name,raw in files) {
						let path='/etc/mp716-vpn/'+name;
						if(writefile(path+'.mp716-new',raw)==null)die('无法保存 OpenVPN 文件');
						chmod(path+'.mp716-new',0600);if(!rename(path+'.mp716-new',path))die('无法提交 OpenVPN 文件');
					}
					m.openvpn.configUploaded=!!stat('/etc/mp716-vpn/client.ovpn');save(c,'openvpn',m.openvpn);
				},extras);
			}
			if(index(VPN_KINDS,kind)<0)return {error:'NOT_IMPLEMENTED',message:'未知 VPN 接口'};
			let cfg=validate_vpn(kind,body.config || body,m[kind],m);check_services(kind,cfg);
			if((kind=='pptpd'||kind=='xl2tpd')&&cfg.enabled)check_pool(bus,cfg);
			if(kind=='openvpn'&&cfg.enabled&&cfg.mode==1&&!stat('/etc/mp716-vpn/client.ovpn'))die('请先上传 OpenVPN 配置文件');
			m[kind]=cfg;
			for(let name in VPN_KINDS)m[name]=validate_vpn(name,m[name],null,m);
			vpn_plan(m,readfile,'');
			return transaction(c,owner,()=>{save(c,kind,cfg);sync_network(c,m,bus);});
		})();}catch(e){result={error:'VALIDATION',message:e.message || string(e)};}
		release();return result;
	}catch(e){return {error:'VALIDATION',message:e.message || string(e)};}
};
