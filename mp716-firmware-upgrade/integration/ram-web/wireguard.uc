'use strict';
// WireGuard business logic shared by the CGI gateway and rpcd. It never talks
// HTTP and never returns private keys from view/status functions.
import { readfile, writefile, chmod, unlink, stat, glob, mkdir } from 'fs';
import { ip, number_ip, host, mask_bits } from '/usr/share/mp716/vpn-config.uc';
import { command } from '/usr/share/mp716/admin-state.uc';

export const WG_KINDS=['wgclient','wgserver'];
export const WG_CLIENT_IF='mp716wgc';
export const WG_SERVER_IF='mp716wgs';
export const MASK='********';
const CONFIG='mp716_vpn', WG='/usr/bin/wg', PROTO='/lib/netifd/proto/wireguard.sh', KEYDIR='/tmp/mp716-admin';
const RESERVED_PORTS=[22,53,67,68,80,123,443,500,1194,1701,1723,4500,5000,5351];
const MAX_PEERS=32;

function text(v,n) { return type(v)=='string' && length(v)<=n && !match(v,/[[:cntrl:]]/); }
function integer(v,a,b) { return type(v)=='int' && v>=a && v<=b; }
function random_id() { return substr(replace(trim(readfile('/proc/sys/kernel/random/uuid') || ''),/-/g,''),0,8); }
export function wg_key(v) { return type(v)=='string' && !!match(v,/^[A-Za-z0-9+\/]{42}[AEIMQUYcgkosw048]=$/); };
export function cidr4(v) {
	let m=type(v)=='string'?match(v,/^([0-9.]+)\/([0-9]{1,2})$/):null;
	if(!m || !ip(m[1]) || int(m[2])>32)return null;
	let bits=int(m[2]), size=1;
	for(let i=0;i<32-bits;i++)size*=2;
	let value=number_ip(m[1]);
	return {address:m[1],bits:bits,size:size,value:value,network:int(value/size)*size,family:4};
};
export function ipv6_addr(v) {
	if(type(v)!='string' || length(v)<2 || length(v)>39 || index(v,'.')>=0)return false;
	if(!match(v,/^[0-9A-Fa-f:]+$/) || index(v,':::')>=0)return false;
	let doubled=0, i=0;
	while(i<length(v)-1) {
		if(substr(v,i,2)=='::'){doubled++;i+=2;continue;}
		i++;
	}
	if(doubled>1)return false;
	for(let g in split(v,':'))if(length(g)>4)return false;
	return true;
};
export function cidr6(v) {
	let m=type(v)=='string'?match(v,/^([0-9A-Fa-f:]+)\/([0-9]{1,3})$/):null;
	if(!m || !ipv6_addr(m[1]))return null;
	let bits=int(m[2]);
	if(bits<0||bits>128)return null;
	return {address:m[1],bits:bits,family:6};
};
function overlaps(a,b) { return a.network<=b.network+b.size-1 && b.network<=a.network+a.size-1; }
function inside(c,n) { return n>=c.network && n<=c.network+c.size-1; }
function dotted(n) { return sprintf('%d.%d.%d.%d',int(n/16777216)%256,int(n/65536)%256,int(n/256)%256,n%256); }
function list(v,max,label) {
	if(v==null)v=[];
	if(type(v)=='string')v=filter(map(split(v,/[, \t\n]+/),(s)=>trim(s)),(s)=>length(s)>0);
	if(type(v)!='array' || length(v)>max)die(label+'数量超出限制');
	for(let s in v)if(!text(s,64))die(label+'无效');
	return v;
}

export function wg_missing() {
	let missing=[];
	if(!stat(WG))push(missing,'wireguard-tools');
	if(!stat(PROTO))push(missing,'netifd wireguard.sh');
	if(!stat('/sys/module/wireguard') && !length(glob('/lib/modules/*/wireguard.ko') || []))push(missing,'kmod-wireguard');
	return missing;
};
export function wg_available() { return !length(wg_missing()); };
function missing_message(missing) { return length(missing)?'当前固件未集成 WireGuard（缺少 '+join('、',missing)+'）':''; }
export function wg_require() {
	let missing=wg_missing();
	if(length(missing))die(missing_message(missing));
};
export function wg_service_info(view) {
	let missing=wg_missing();
	return {...view,serviceAvailable:!length(missing),serviceMessage:missing_message(missing)};
};

function tool(arg) {
	if(!stat(WG))die('当前固件未集成 wireguard-tools，无法生成密钥');
	let r=command(WG+' '+arg), key=trim(r.output || '');
	if(r.code!=0 || !wg_key(key))die('无法生成 WireGuard 密钥');
	return key;
}
export function genkey() { return tool('genkey'); };
export function genpsk() { return tool('genpsk'); };
// The private key is passed through a 0600 file in a 0700 directory, never argv.
export function pubkey(priv) {
	if(!wg_key(priv))die('WireGuard 私钥格式无效');
	if(!stat(WG))die('当前固件未集成 wireguard-tools，无法计算公钥');
	mkdir(KEYDIR,0700);chmod(KEYDIR,0700);
	let path=KEYDIR+'/wg-'+random_id()+'.key';
	if(writefile(path,priv+'\n')==null)die('无法处理 WireGuard 私钥');
	chmod(path,0600);
	let r=command(WG+' pubkey < '+path);
	unlink(path);
	let key=trim(r.output || '');
	if(r.code!=0 || !wg_key(key))die('无法计算 WireGuard 公钥');
	return key;
};
// '' and MASK keep the stored key; 'generate' creates a new one.
function private_value(v,old) {
	if(v==null || v=='' || v==MASK)return old || '';
	if(v=='generate')return genkey();
	v=trim(v);
	if(!wg_key(v))die('WireGuard 私钥格式无效');
	return v;
}
// MASK keeps, '' clears, 'generate' creates a new pre-shared key.
function psk_value(v,old) {
	if(v==null || v==MASK)return old || '';
	if(v=='')return '';
	if(v=='generate')return genpsk();
	v=trim(v);
	if(!wg_key(v))die('预共享密钥格式无效');
	return v;
}

export function wg_defaults(kind) {
	if(kind=='wgclient')return {enabled:false,privateKey:'',publicKey:'',addresses:[],dns:[],useDns:false,mtu:1420,routeMode:'split',allowGlobalRoute:false,
		peer:{publicKey:'',presharedKey:'',endpointHost:'',endpointPort:51820,allowedIPs:[],keepalive:25}};
	if(kind=='wgserver')return {enabled:false,privateKey:'',publicKey:'',listenPort:51820,address:'10.72.0.1/24',mtu:1420,publicHost:'',clientDns:'',
		allowLan:true,allowInternet:false,allowRouterAccess:false,peers:[]};
	die('未知 WireGuard 类型');
};
export function wg_models(c) {
	let result={};
	for(let kind in WG_KINDS) {
		let raw=c.get(CONFIG,kind,'data');
		try {result[kind]=raw?{...wg_defaults(kind),...json(raw)}:wg_defaults(kind);}catch(e){die('WireGuard 配置损坏: '+kind);}
	}
	return result;
};

// Networks WireGuard must not shadow: connected LAN/WAN subnets and enabled PPP pools.
export function wg_context(c,bus,m) {
	let reserved=[];
	let add=(label,address,bits)=>{let n=cidr4(address+'/'+bits);if(n)push(reserved,{label:label,net:n});};
	let dump=bus?bus.call('network.interface','dump',{}):null;
	for(let iface in dump?.interface || []) {
		let name=iface.interface || '';
		if(name==WG_CLIENT_IF || name==WG_SERVER_IF || match(name,/^(mp716_vpn_|mp716pptp|mp716l2tp|loopback)/))continue;
		for(let a in iface['ipv4-address'] || [])add(name,a.address,a.mask);
	}
	let lan=c.get('network','lan','ipaddr'), mask=c.get('network','lan','netmask');
	if(type(lan)=='array')lan=lan[0];
	if(type(lan)=='string') {
		let p=split(lan,'/'), bits=length(p)>1?int(p[1]):(mask_bits(mask || '') ?? 24);
		add('lan',p[0],bits);
	}
	for(let kind in ['pptpd','xl2tpd'])if(m?.[kind]?.enabled && ip(m[kind].startIp || ''))add(kind,m[kind].startIp,24);
	return {reserved:reserved};
};
function check_reserved(ctx,n,label) {
	for(let r in ctx?.reserved || [])if(overlaps(n,r.net))die(label+' 与现有网络 '+r.label+' 重叠');
}
function client_has_v6(cl) {
	for(let a in cl.addresses || [])if(index(a,':')>=0)return true;
	for(let a in cl.peer?.allowedIPs || [])if(index(a,':')>=0)return true;
	return false;
}
function protect_management(c,configure) {
	let ctx=wg_context(c,null,null), pri=900;
	for(let r in ctx.reserved) {
		if(r.label!='lan' && r.label!='wan')continue;
		configure(c,'network','mp716_vpn_wgc_protect_'+r.label,'rule',{
			dest:dotted(r.net.network)+'/'+r.net.bits,lookup:'main',priority:sprintf('%d',pri),family:'4'});
		pri++;
	}
};
// Global mode keeps the WAN default route so the endpoint can reconnect, and
// installs a forward reject so LAN traffic cannot use that route when the
// tunnel is down. useDns also pauses DHCP DNS; a manual peerdns=0 is left alone.
function hold_wan_dns(c, hold) {
	for(let name in ['wan','wan6']) {
		if(type(c.get('network',name))!='string')continue;
		let mark='mp716_wg_hold_peerdns';
		if(hold) {
			if(c.get('network',name,mark)!='1') {
				if(c.get('network',name,'peerdns')=='0')continue;
				if(!c.set('network',name,mark,'1') || !c.set('network',name,'peerdns','0'))die('无法暂停 WAN 自动 DNS');
			} else if(c.get('network',name,'peerdns')!='0' && !c.set('network',name,'peerdns','0'))die('无法暂停 WAN 自动 DNS');
		} else if(c.get('network',name,mark)=='1') {
			if(!c.set('network',name,'peerdns','1') || !c.delete('network',name,mark))die('无法恢复 WAN 自动 DNS');
		}
	}
};
export function wg_reserved_list(ctx) {
	let out=[];
	for(let r in ctx?.reserved || [])push(out,{label:r.label,cidr:dotted(r.net.network)+'/'+r.net.bits});
	return out;
};

export function validate_client(value,previous,ctx) {
	if(type(value)!='object')die('WireGuard 客户端配置无效');
	let old=previous || wg_defaults('wgclient'), d=wg_defaults('wgclient');
	let incoming=type(value.peer)=='object'?value.peer:{};
	let cfg={...d,...value,peer:{...d.peer,...incoming}};
	if(type(cfg.enabled)!='bool' || type(cfg.useDns)!='bool' || type(cfg.allowGlobalRoute)!='bool')die('WireGuard 开关参数无效');
	if(index(['split','global'],cfg.routeMode)<0)die('路由模式无效');
	if(!integer(cfg.mtu,1280,1500))die('MTU 须在 1280–1500');
	cfg.privateKey=private_value(value.privateKey,old.privateKey);
	if(!length(cfg.privateKey) && cfg.enabled)die('请先生成或填写本机私钥');
	cfg.publicKey=!length(cfg.privateKey)?'':cfg.privateKey==old.privateKey && wg_key(old.publicKey)?old.publicKey:pubkey(cfg.privateKey);
	cfg.addresses=list(cfg.addresses,4,'隧道地址');
	for(let a in cfg.addresses) {
		let n4=cidr4(a);
		if(n4) {
			if(n4.bits<8)die('隧道地址须为 IPv4 CIDR（如 10.73.0.2/32）: '+a);
			check_reserved(ctx,n4,'隧道地址 '+a);
			continue;
		}
		if(!cidr6(a))die('隧道地址须为 IPv4/IPv6 CIDR（如 10.73.0.2/32 或 fd00::2/64）: '+a);
	}
	cfg.dns=list(cfg.dns,2,'DNS');
	for(let s in cfg.dns)if(!ip(s) && !ipv6_addr(s))die('DNS 地址无效: '+s);
	let peer=cfg.peer;
	peer.publicKey=trim(peer.publicKey || '');
	if(length(peer.publicKey) && !wg_key(peer.publicKey))die('对端公钥格式无效');
	peer.presharedKey=psk_value(incoming.presharedKey,old.peer?.presharedKey);
	peer.endpointHost=trim(peer.endpointHost || '');
	if(length(peer.endpointHost) && !host(peer.endpointHost))die('Endpoint 地址无效');
	if(!integer(peer.endpointPort,1,65535))die('Endpoint 端口无效');
	if(!integer(peer.keepalive,0,600))die('保活间隔须在 0–600 秒');
	peer.allowedIPs=list(peer.allowedIPs,16,'AllowedIPs');
	let nets=[];
	for(let a in peer.allowedIPs) {
		let n4=cidr4(a);
		if(n4) {
			if(n4.network!=n4.value)die('AllowedIPs 须为 IPv4 网段（如 10.0.0.0/24）: '+a);
			if(n4.bits<8)die('分流 AllowedIPs 不允许 /0–/7 大网段；需要全局路由请选择全局模式');
			check_reserved(ctx,n4,'AllowedIPs '+a);
			push(nets,n4);
			continue;
		}
		let n6=cidr6(a);
		if(!n6)die('AllowedIPs 须为 IPv4/IPv6 网段: '+a);
		if(n6.bits<8)die('分流 AllowedIPs 不允许 /0–/7 大网段；需要全局路由请选择全局模式');
	}
	if(cfg.enabled) {
		if(!length(cfg.addresses))die('请填写隧道地址');
		if(!length(peer.publicKey) || !length(peer.endpointHost))die('请填写对端公钥与 Endpoint');
		if(peer.publicKey==cfg.publicKey)die('对端公钥不能与本机公钥相同');
		if(cfg.routeMode=='split' && !length(nets))die('分流模式至少需要一条 AllowedIPs');
		if(cfg.routeMode=='global' && !cfg.allowGlobalRoute)die('全局模式会让 LAN 上网流量经隧道转发，请先勾选“允许全局路由”');
		if(cfg.useDns && !length(cfg.dns))die('启用隧道 DNS 时请填写 DNS 地址');
		if(cfg.useDns && cfg.routeMode=='split')
			for(let s in cfg.dns)if(!length(filter(nets,(n)=>inside(n,number_ip(s)))))die('分流模式下隧道 DNS 必须位于 AllowedIPs 内: '+s);
	}
	return cfg;
};

export function validate_server(value,previous,ctx) {
	if(type(value)!='object')die('WireGuard 服务器配置无效');
	let old=previous || wg_defaults('wgserver'), cfg={...wg_defaults('wgserver'),...value};
	for(let k in ['enabled','allowLan','allowInternet','allowRouterAccess'])if(type(cfg[k])!='bool')die('WireGuard 开关参数无效');
	if(!integer(cfg.listenPort,1024,65535) || index(RESERVED_PORTS,cfg.listenPort)>=0)die('监听端口无效或与系统服务冲突');
	if(!integer(cfg.mtu,1280,1500))die('MTU 须在 1280–1500');
	let net=cidr4(cfg.address);
	if(!net || net.bits<16 || net.bits>30 || net.value==net.network || net.value==net.network+net.size-1)die('隧道地址须为 /16–/30 网段内的主机地址（如 10.72.0.1/24）');
	check_reserved(ctx,net,'服务器隧道网段');
	cfg.publicHost=trim(cfg.publicHost || '');
	if(length(cfg.publicHost) && !host(cfg.publicHost))die('服务器公网地址无效');
	cfg.clientDns=trim(cfg.clientDns || '');
	if(length(cfg.clientDns) && !ip(cfg.clientDns))die('客户端 DNS 无效');
	if(type(cfg.peers)!='array' || length(cfg.peers)>MAX_PEERS)die('Peer 数量超出限制（最多 '+MAX_PEERS+' 个）');
	cfg.privateKey=private_value(value.privateKey,old.privateKey);
	if(!length(cfg.privateKey) && (cfg.enabled || length(cfg.peers)))cfg.privateKey=genkey();
	cfg.publicKey=!length(cfg.privateKey)?'':cfg.privateKey==old.privateKey && wg_key(old.publicKey)?old.publicKey:pubkey(cfg.privateKey);
	let olds={}, ids={}, keys={}, used={}, routes=[];
	for(let p in old.peers || [])olds[p.id]=p;
	used[net.value]=true;
	let peers=[];
	for(let p in cfg.peers) {
		if(type(p)!='object' || !text(p.name,32) || !length(trim(p.name)))die('Peer 名称无效（1–32 字符）');
		let id=match(p.id || '',/^[a-z0-9]{1,12}$/) && olds[p.id]?p.id:'p'+random_id();
		if(ids[id])die('Peer 编号重复');
		ids[id]=true;
		let prev=olds[id], row={id:id,name:trim(p.name),enabled:p.enabled!==false,privateKey:'',publicKey:'',presharedKey:'',address:'',allowedIPs:[],clientAllowedIPs:[],keepalive:0};
		if(type(p.keepalive ?? 0)!='int' || !integer(p.keepalive ?? 0,0,600))die('Peer 保活间隔须在 0–600 秒');
		row.keepalive=p.keepalive ?? 0;
		let supplied=trim(p.publicKey || '');
		if(p.generateKeys===true || !length(supplied) && !prev) {
			row.privateKey=genkey();row.publicKey=pubkey(row.privateKey);
		} else if(length(supplied) && (!prev || supplied!=prev.publicKey)) {
			if(!wg_key(supplied))die('Peer 公钥格式无效: '+row.name);
			row.publicKey=supplied;
		} else {
			row.publicKey=prev.publicKey;row.privateKey=prev.privateKey || '';
		}
		if(keys[row.publicKey] || row.publicKey==cfg.publicKey)die('Peer 公钥重复: '+row.name);
		keys[row.publicKey]=true;
		row.presharedKey=psk_value(p.presharedKey,prev?.presharedKey);
		let address=trim(split(p.address || '','/')[0] || '');
		if(length(address)) {
			if(!ip(address) || !inside(net,number_ip(address)) || used[number_ip(address)] || number_ip(address)==net.network || number_ip(address)==net.network+net.size-1)
				die('Peer 地址须位于服务器网段内且不重复: '+row.name);
			used[number_ip(address)]=true;row.address=address+'/32';
		}
		row.allowedIPs=list(p.allowedIPs,8,'Peer 子网');
		for(let a in row.allowedIPs) {
			let n=cidr4(a);
			if(!n || n.network!=n.value || n.bits<8)die('Peer 子网须为 /8 及更小的 IPv4 网段: '+a);
			if(overlaps(n,net))die('Peer 子网不能与服务器隧道网段重叠: '+a);
			check_reserved(ctx,n,'Peer 子网 '+a);
			for(let r in routes)if(overlaps(n,r))die('Peer 子网互相重叠: '+a);
			push(routes,n);
		}
		row.clientAllowedIPs=list(p.clientAllowedIPs,16,'客户端 AllowedIPs');
		for(let a in row.clientAllowedIPs){let n=cidr4(a);if(!n || n.network!=n.value)die('客户端 AllowedIPs 须为 IPv4 网段: '+a);}
		if(!length(row.clientAllowedIPs)) {
			push(row.clientAllowedIPs,dotted(net.network)+'/'+net.bits);
			for(let r in ctx?.reserved || []) {
				let lan=dotted(r.net.network)+'/'+r.net.bits;
				if(cfg.allowLan && r.label=='lan' && index(row.clientAllowedIPs,lan)<0)push(row.clientAllowedIPs,lan);
			}
		}
		push(peers,row);
	}
	for(let row in peers) {
		if(length(row.address))continue;
		for(let n=net.network+1;n<net.network+net.size-1;n++)if(!used[n]){used[n]=true;row.address=dotted(n)+'/32';break;}
		if(!length(row.address))die('服务器网段可分配地址不足');
	}
	cfg.peers=peers;
	return cfg;
};

export function client_view(cfg) {
	let v={...cfg,peer:{...cfg.peer}};
	v.hasPrivateKey=length(cfg.privateKey || '')>0;
	v.privateKey=v.hasPrivateKey?MASK:'';
	v.peer.presharedKey=length(cfg.peer?.presharedKey || '')?MASK:'';
	return v;
};
export function server_view(cfg) {
	let v={...cfg};
	v.hasPrivateKey=length(cfg.privateKey || '')>0;
	v.privateKey=v.hasPrivateKey?MASK:'';
	v.peers=map(cfg.peers || [],(p)=>{
		let row={...p,hasPrivateKey:length(p.privateKey || '')>0,presharedKey:length(p.presharedKey || '')?MASK:''};
		delete row.privateKey;
		return row;
	});
	return v;
};

// wg-quick style client file. Hook directives are rejected rather than ignored.
export function parse_client_conf(raw) {
	if(type(raw)!='string' || length(raw)>8192 || index(raw,'\x00')>=0)die('WireGuard 配置文件无效或超过 8KB');
	let section=null, iface={}, peers=[], peer=null, warnings=[];
	for(let line in split(raw,'\n')) {
		line=trim(replace(line,/\r$/,''));
		let hash=index(line,'#');
		if(hash>=0)line=trim(substr(line,0,hash));
		if(!length(line))continue;
		if(lc(line)=='[interface]'){section='interface';continue;}
		if(lc(line)=='[peer]'){section='peer';peer={};push(peers,peer);continue;}
		let m=match(line,/^([A-Za-z]+)[ \t]*=[ \t]*(.*)$/);
		if(!m || !section)die('无法解析配置行: '+substr(line,0,32));
		let key=lc(m[1]), value=trim(m[2]);
		if(index(['preup','postup','predown','postdown'],key)>=0)die('出于安全原因，不支持 '+m[1]+' 脚本指令');
		if(section=='interface') {
			if(index(['privatekey','address','dns','mtu'],key)>=0)iface[key]=value;
			else if(index(['listenport','table','fwmark','saveconfig'],key)>=0)push(warnings,'已忽略 '+m[1]);
			else die('不支持的 [Interface] 字段: '+m[1]);
		} else {
			if(index(['publickey','presharedkey','endpoint','allowedips','persistentkeepalive'],key)<0)die('不支持的 [Peer] 字段: '+m[1]);
			peer[key]=value;
		}
	}
	if(length(peers)!=1)die('客户端配置须且仅能包含一个 [Peer]');
	peer=peers[0];
	let split_list=(v)=>filter(map(split(v || '',','),(s)=>trim(s)),(s)=>length(s)>0);
	let addresses=[], dns=[], allowed=[], mode='split';
	for(let a in split_list(iface.address)) {
		if(index(a,':')>=0)push(addresses,index(a,'/')<0?a+'/128':a);
		else push(addresses,index(a,'/')<0?a+'/32':a);
	}
	for(let s in split_list(iface.dns)){if(ip(s)||ipv6_addr(s))push(dns,s);else push(warnings,'已忽略 DNS 项 '+s);}
	for(let a in split_list(peer.allowedips)) {
		if(a=='0.0.0.0/0' || a=='::/0'){mode='global';continue;}
		if(index(a,':')>=0)push(allowed,index(a,'/')<0?a+'/128':a);
		else push(allowed,index(a,'/')<0?a+'/32':a);
	}
	let endpoint=match(peer.endpoint || '',/^([A-Za-z0-9._-]+):([0-9]{1,5})$/);
	if(!endpoint)die('Endpoint 须为 主机:端口 格式（暂不支持 IPv6 Endpoint）');
	if(mode=='global')push(warnings,'配置包含 0.0.0.0/0，已设为全局模式；启用前须确认允许全局路由');
	return {warnings:warnings,config:{
		enabled:false,privateKey:iface.privatekey || '',addresses:addresses,dns:dns,useDns:mode=='global' && length(dns)>0,
		mtu:iface.mtu?int(iface.mtu):1420,routeMode:mode,allowGlobalRoute:false,
		peer:{publicKey:peer.publickey || '',presharedKey:peer.presharedkey || '',endpointHost:endpoint[1],endpointPort:int(endpoint[2]),
			allowedIPs:allowed,keepalive:peer.persistentkeepalive?int(peer.persistentkeepalive):0}}};
};

export function peer_client_conf(server,peer) {
	if(!wg_key(server.publicKey))die('服务器尚未生成密钥，请先保存服务器配置');
	if(!length(server.publicHost))die('请先填写服务器公网地址（客户端 Endpoint）');
	let lines=['[Interface]','PrivateKey = '+(length(peer.privateKey || '')?peer.privateKey:'<在客户端设备上填写该 Peer 的私钥>'),'Address = '+peer.address];
	if(length(server.clientDns))push(lines,'DNS = '+server.clientDns);
	push(lines,'','[Peer]','PublicKey = '+server.publicKey);
	if(length(peer.presharedKey || ''))push(lines,'PresharedKey = '+peer.presharedKey);
	push(lines,'Endpoint = '+server.publicHost+':'+server.listenPort,'AllowedIPs = '+join(', ',peer.clientAllowedIPs),'PersistentKeepalive = 25');
	return join('\n',lines)+'\n';
};

// configure(c,pkg,name,type,options) is vpn.uc's managed-section writer.
export function wg_sync(c,wg,configure) {
	let cl=wg.wgclient, sv=wg.wgserver;
	if(cl?.enabled) {
		let opts={proto:'wireguard',private_key:cl.privateKey,addresses:cl.addresses,mtu:sprintf('%d',cl.mtu),auto:'1'};
		if(cl.useDns && length(cl.dns))opts.dns=cl.dns;
		configure(c,'network',WG_CLIENT_IF,'interface',opts);
		// Global mode uses two /1 routes: the WAN default route stays in place and
		// wireguard.sh pins a host route to the endpoint via the WAN.
		let allowed=cl.routeMode=='global'?['0.0.0.0/1','128.0.0.0/1']:cl.peer.allowedIPs;
		if(cl.routeMode=='global' && client_has_v6(cl)) {
			push(allowed,'::/1');push(allowed,'8000::/1');
		}
		let peer={public_key:cl.peer.publicKey,endpoint_host:cl.peer.endpointHost,endpoint_port:sprintf('%d',cl.peer.endpointPort),
			allowed_ips:allowed,route_allowed_ips:'1',description:'MP716 WireGuard client'};
		if(cl.peer.keepalive>0)peer.persistent_keepalive=sprintf('%d',cl.peer.keepalive);
		if(length(cl.peer.presharedKey))peer.preshared_key=cl.peer.presharedKey;
		configure(c,'network','mp716_vpn_wgc_peer','wireguard_'+WG_CLIENT_IF,peer);
		configure(c,'firewall','mp716_vpn_wgc_zone','zone',{name:WG_CLIENT_IF,network:[WG_CLIENT_IF],input:'REJECT',output:'ACCEPT',forward:'REJECT',masq:'1',mtu_fix:'1'});
		configure(c,'firewall','mp716_vpn_wgc_fwd_lan','forwarding',{src:'lan',dest:WG_CLIENT_IF});
		if(cl.routeMode=='global') {
			protect_management(c,configure);
			configure(c,'firewall','mp716_vpn_wgc_nowan','rule',{name:'MP716-WG-no-wan-leak',src:'lan',dest:'wan',proto:'all',target:'REJECT'});
		}
	}
	hold_wan_dns(c, cl?.enabled==true && cl.routeMode=='global' && cl.useDns==true);
	if(sv?.enabled) {
		configure(c,'network',WG_SERVER_IF,'interface',{proto:'wireguard',private_key:sv.privateKey,listen_port:sprintf('%d',sv.listenPort),
			addresses:[sv.address],mtu:sprintf('%d',sv.mtu),auto:'1'});
		for(let p in sv.peers) {
			let peer={public_key:p.publicKey,allowed_ips:[p.address,...p.allowedIPs],route_allowed_ips:'1',description:p.name,disabled:p.enabled?'0':'1'};
			if(p.keepalive>0)peer.persistent_keepalive=sprintf('%d',p.keepalive);
			if(length(p.presharedKey))peer.preshared_key=p.presharedKey;
			configure(c,'network','mp716_vpn_wgs_'+p.id,'wireguard_'+WG_SERVER_IF,peer);
		}
		configure(c,'firewall','mp716_vpn_wgs_in','rule',{name:'MP716-WireGuard',src:'wan',proto:'udp',dest_port:sprintf('%d',sv.listenPort),target:'ACCEPT'});
		configure(c,'firewall','mp716_vpn_wgs_zone','zone',{name:WG_SERVER_IF,network:[WG_SERVER_IF],input:sv.allowRouterAccess?'ACCEPT':'REJECT',output:'ACCEPT',forward:'REJECT',mtu_fix:'1'});
		if(!sv.allowRouterAccess) {
			configure(c,'firewall','mp716_vpn_wgs_dns','rule',{name:'MP716-WG-DNS',src:WG_SERVER_IF,proto:['tcp','udp'],dest_port:'53',target:'ACCEPT'});
			configure(c,'firewall','mp716_vpn_wgs_icmp','rule',{name:'MP716-WG-ICMP',src:WG_SERVER_IF,proto:'icmp',target:'ACCEPT'});
		}
		if(sv.allowLan) {
			configure(c,'firewall','mp716_vpn_wgs_fwd_lan','forwarding',{src:WG_SERVER_IF,dest:'lan'});
			configure(c,'firewall','mp716_vpn_wgs_fwd_from_lan','forwarding',{src:'lan',dest:WG_SERVER_IF});
		}
		if(sv.allowInternet)configure(c,'firewall','mp716_vpn_wgs_fwd_wan','forwarding',{src:WG_SERVER_IF,dest:'wan'});
	}
};

function wg_show(ifname,what) {
	let r=command(WG+' show '+ifname+' '+what), rows={};
	if(r.code!=0)return rows;
	for(let line in split(trim(r.output || ''),'\n')) {
		let f=split(line,'\t');
		if(length(f)>=2 && wg_key(f[0]))rows[f[0]]=slice(f,1);
	}
	return rows;
}
function link_is_up(name) {
	// IFF_UP is the low bit. WireGuard stays operstate "unknown" while forwarding.
	let flags=trim(readfile('/sys/class/net/'+name+'/flags') || '');
	return !!match(flags,/^[0-9A-Fa-fx]*[13579bBdDfF][ \t]*$/);
}
function iface_status(bus,name) {
	let s=(bus?bus.call('network.interface.'+name,'status',{}):null) || {};
	let addrs=s['ipv4-address'] || [], v6=s['ipv6-address'] || [];
	let address=addrs[0]?.address || v6[0]?.address || '';
	let errors=[];
	for(let e in s.errors || []) {
		let msg=type(e)=='object'?(e.code || e.subsystem || ''):trim(sprintf('%s',e));
		if(length(msg)>0 && length(msg)<120 && !match(msg,/[;|&`$]/))push(errors,msg);
	}
	let link=link_is_up(name), up=s.up==true || link;
	if(link)errors=[];
	return {up:up,address:address,error:length(errors)>0,errors:errors};
}
function peer_stats(name,keys) {
	let hs=wg_show(name,'latest-handshakes'), tr=wg_show(name,'transfer'), ep=wg_show(name,'endpoints'), now=time(), out={};
	for(let k in keys) {
		let h=int(hs[k]?.[0] || 0), e=ep[k]?.[0] || '';
		out[k]={latestHandshake:h,handshakeAgeSec:h>0?max(0,now-h):-1,rxBytes:int(tr[k]?.[0] || 0),txBytes:int(tr[k]?.[1] || 0),endpoint:e=='(none)'?'':e};
	}
	return out;
}
function handshake_state(age) {
	if(type(age)!='int' || age<0)return 'none';
	return age<=180?'recent':'stale';
}
function probe_target(cl) {
	for(let s in cl.dns || [])if(ip(s))return s;
	for(let a in cl.peer?.allowedIPs || []) {
		let n=cidr4(a);
		if(!n)continue;
		if(n.bits==32)return n.address;
		if(n.bits>=24)return dotted(n.network+1);
	}
	for(let a in cl.addresses || []) {
		let n=cidr4(a);
		if(n && n.network+1!=n.value)return dotted(n.network+1);
	}
	return '';
}
function read_probe_cache(target) {
	try {
		let row=json(readfile('/tmp/mp716-wg-probe.json') || '');
		if(type(row)=='object' && row.target==target && type(row.at)=='int' && time()-row.at<=20)
			return {...row,ageSec:time()-row.at};
	} catch (e) {}
	return null;
}
function write_probe_cache(row) {
	writefile('/tmp/mp716-wg-probe.json', sprintf('%J', row));
}
function run_probe(cl,up) {
	if(!cl.enabled)return {state:'skipped',target:'',reason:'disabled',ageSec:-1};
	if(!up)return {state:'skipped',target:'',reason:'iface-down',ageSec:-1};
	let target=probe_target(cl);
	if(!target)return {state:'skipped',target:'',reason:'no-target',ageSec:-1};
	let cached=read_probe_cache(target);
	if(cached)return cached;
	let r=command('/bin/busybox ping -I '+WG_CLIENT_IF+' -c 1 -W 1 '+target+' >/dev/null 2>&1');
	let row={at:time(),target:target,state:r.code==0?'ok':'fail',reason:r.code==0?'ok':'ping-failed'};
	write_probe_cache(row);
	return {...row,ageSec:0};
}
export function wg_status(bus,wg) {
	let available=wg_available(), result={available:available,missing:wg_missing()};
	let cl=wg.wgclient;
	let cs=iface_status(bus,WG_CLIENT_IF);
	let stats={endpoint:'',latestHandshake:0,handshakeAgeSec:-1,rxBytes:0,txBytes:0};
	if(available && cs.up && wg_key(cl.peer?.publicKey)) {
		let row=peer_stats(WG_CLIENT_IF,[cl.peer.publicKey])[cl.peer.publicKey];
		if(row)stats=row;
	}
	let probe=run_probe(cl,cs.up);
	result.client={
		enabled:cl.enabled==true,up:cs.up,error:cs.error,address:cs.address || (cl.addresses || [])[0] || '',
		ifaceState:!cl.enabled?'disabled':cs.error?'error':cs.up?'up':'down',
		handshakeState:handshake_state(stats.handshakeAgeSec),
		errors:cs.errors,probe:probe,...stats
	};
	return result;
};
