'use strict';

export const VPN_KINDS=['pptp','pptpd','xl2tp','xl2tpd','users','openvpn'];
function text(v,n) { return type(v)=='string' && length(v)<=n && index(v,'\x00')<0 && !match(v,/[[:cntrl:]]/); }
function integer(v,a,b) { return type(v)=='int' && v>=a && v<=b; }
export function ip(v) {
	if(type(v)!='string'||!match(v,/^([0-9]{1,3}\.){3}[0-9]{1,3}$/))return false;
	for(let s in split(v,'.'))if(int(s)>255)return false;
	return true;
};
export function number_ip(v) { let n=0;for(let s in split(v,'.'))n=n*256+int(s);return n; };
export function mask_bits(v) {
	if(!ip(v))return null;
	let n=number_ip(v), count=0, zero=false;
	let divisor=2147483648;
	for(let i=31;i>=0;i--){let bit=int(n/divisor)%2;if(bit && zero)return null;if(bit)count++;else zero=true;divisor/=2;}
	return count;
};
export function host(v) {
	if(!text(v,253)||!length(v))return false;
	for(let s in split(v,'.'))if(!match(s,/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/))return false;
	return true;
};
function secret(v,previous,required) {
	if(v==null || v=='********')v=previous || '';
	if(!text(v,256)||(required && !length(v)))die('请填写有效的 VPN 凭据');
	return v;
}
function cidr(v) {
	if(!text(v,19))return false;
	let p=split(v,'/');return length(p)==2 && ip(p[0]) && match(p[1],/^[0-9]{1,2}$/) && int(p[1])<=32;
}
export function defaults(kind) {
	if(kind=='pptpd'||kind=='xl2tpd') {
		let prefix=kind=='pptpd'?'10.71.60.':'10.71.61.';
		return {enabled:false,startIp:prefix+'10',endIp:prefix+'100',server:prefix+'1',mppe:0,ipsecEnabled:false,ipsecKey:'',dnsEnabled:true,primaryDns:'192.168.199.1',secondaryDns:'',mtu:1400,mru:1400};
	}
	if(kind=='pptp')return {enabled:false,status:0,address:'',server:'',username:'',password:'',mppe:0,routeType:0,routes:[]};
	if(kind=='xl2tp')return {enabled:false,status:0,address:'',server:'',username:'',password:'',ipsecKey:'',serverEnabled:false};
	if(kind=='users')return {users:[],types:['all','pptp','l2tp'],pptpStart:'10.71.60.10',pptpEnd:'10.71.60.100',l2tpStart:'10.71.61.10',l2tpEnd:'10.71.61.100'};
	if(kind=='openvpn')return {enabled:false,status:0,mode:0,host:'',username:'',password:'',port:1194,configUploaded:false};
	die('未知 VPN 类型');
};
export function validate_vpn(kind,value,previous,peers) {
	if(index(VPN_KINDS,kind)<0||type(value)!='object')die('VPN 配置无效');
	let old=previous || defaults(kind), cfg={...defaults(kind),...value};
	if(kind!='users' && type(cfg.enabled)!='bool')die('VPN 开关无效');
	if(kind=='pptpd'||kind=='xl2tpd') {
		if(!ip(cfg.startIp)||!ip(cfg.endIp)||!ip(cfg.server)||int(number_ip(cfg.startIp)/256)!=int(number_ip(cfg.endIp)/256)||number_ip(cfg.startIp)>number_ip(cfg.endIp)||number_ip(cfg.server)>=number_ip(cfg.startIp)&&number_ip(cfg.server)<=number_ip(cfg.endIp))die('VPN 地址池无效');
		if(int(number_ip(cfg.server)/256)!=int(number_ip(cfg.startIp)/256))die('服务器与地址池必须同网段');
		if(!integer(cfg.mtu,576,1500)||!integer(cfg.mru,576,1500)||type(cfg.dnsEnabled)!='bool')die('VPN 高级参数无效');
		if(cfg.dnsEnabled && (!ip(cfg.primaryDns)||(cfg.secondaryDns && !ip(cfg.secondaryDns))))die('VPN DNS 地址无效');
		if(kind=='pptpd'&&!integer(cfg.mppe,0,2))die('MPPE 参数无效');
		if(kind=='xl2tpd') {
			if(type(cfg.ipsecEnabled)!='bool')die('IPSec 开关无效');
			cfg.ipsecKey=secret(cfg.ipsecKey,old.ipsecKey,cfg.enabled&&cfg.ipsecEnabled);
			if(cfg.enabled && peers?.xl2tp?.enabled)die('L2TP 服务器与客户端不能同时启用');
		}
		let other=peers?peers[kind=='pptpd'?'xl2tpd':'pptpd']:null;
		if(cfg.enabled && other?.enabled && number_ip(cfg.startIp)<=number_ip(other.endIp) && number_ip(cfg.endIp)>=number_ip(other.startIp))die('VPN 地址池冲突');
		for(let address in [cfg.startIp,cfg.endIp,cfg.server])if(index([0,255],number_ip(address)%256)>=0 || number_ip(address)<167772160 || number_ip(address)>=3758096384)die('VPN 地址不能使用网络、广播或保留地址');
		return cfg;
	}
	if(kind=='users') {
		if(type(cfg.users)!='array'||length(cfg.users)>64)die('VPN 用户数量超出限制');
		let names={};
		cfg.users=map(cfg.users,(user)=>{
			if(!text(user.username,64)||!length(user.username)||names[user.username]||index(['all','pptp','l2tp'],user.type)<0||!text(user.comment||'',128))die('VPN 用户无效或重复');
			names[user.username]=true;
			let olduser=filter(old.users || [],(u)=>u.username==user.username)[0];
			let password=secret(user.password,olduser?.password,true);
			if(user.address && !ip(user.address))die('VPN 用户地址无效');
			let routes=filter(split(user.routes||'',';'),(s)=>length(s)>0);
			if(length(routes)>16)die('VPN 用户路由过多');
			for(let route in routes)if(!cidr(route))die('VPN 用户路由无效');
			return {type:user.type,username:user.username,password:password,address:user.address||'',comment:user.comment||'',routes:join(';',routes)};
		});return cfg;
	}
	if(kind=='pptp'||kind=='xl2tp') {
		if(cfg.enabled && (!host(cfg.server)||!text(cfg.username,64)||!length(cfg.username)))die('VPN 服务器或用户名无效');
		cfg.password=secret(cfg.password,old.password,cfg.enabled);
		if(kind=='pptp') {
			if(!integer(cfg.mppe,0,2)||!integer(cfg.routeType,0,1)||type(cfg.routes)!='array'||length(cfg.routes)>32)die('PPTP 客户端参数无效');
			for(let route in cfg.routes)if(!ip(route.target)||mask_bits(route.netmask)==null)die('PPTP 静态路由无效');
		}else {
			cfg.ipsecKey=secret(cfg.ipsecKey,old.ipsecKey,false);
			if(cfg.enabled&&peers?.xl2tpd?.enabled)die('L2TP 客户端与服务器不能同时启用');
		}return cfg;
	}
	if(!integer(cfg.mode,0,1)||!integer(cfg.port,1,65535)||!text(cfg.username,64))die('OpenVPN 参数无效');
	if(cfg.enabled && cfg.mode==0 && !host(cfg.host))die('OpenVPN 服务器无效');
	cfg.password=secret(cfg.password,old.password,cfg.enabled&&length(cfg.username)>0);
	return cfg;
};
export function ppp_quote(v) { return '"'+replace(replace(v,'\\','\\\\'),'"','\\"')+'"'; };
export function validate_openvpn(text) {
	if(type(text)!='string'||length(text)>262144||index(text,'\x00')>=0||match(text,/[\x0b\x0c]/))die('OpenVPN 配置文件无效');
	let rows=[], inline=null;
	let allowed=['client','dev','proto','remote','remote-random','resolv-retry','nobind','persist-key','persist-tun','auth-user-pass','auth-nocache','remote-cert-tls','verify-x509-name','ca','cert','key','tls-auth','tls-crypt','tls-crypt-v2','key-direction','cipher','data-ciphers','data-ciphers-fallback','auth','tls-version-min','tls-cipher','tls-ciphersuites','verb','mute','connect-retry','connect-timeout','server-poll-timeout','keepalive','ping','ping-restart','pull','pull-filter','route','route-nopull','route-delay','redirect-gateway','dhcp-option','tun-mtu','mssfix','explicit-exit-notify','sndbuf','rcvbuf','reneg-sec','float','fast-io'];
	let paths={ca:'ca.pem',cert:'client.crt',key:'client.key','tls-auth':'ta.key','tls-crypt':'ta.key','tls-crypt-v2':'ta.key'};
	for(let raw in split(text,'\n')) {
		let line=trim(replace(raw,/\r$/,''));if(!length(line)||match(line,/^[#;]/))continue;
		if(inline) {push(rows,line);if(line=='</'+inline+'>')inline=null;else if(!match(line,/^[-A-Za-z0-9+/= :]+$/))die('内嵌证书内容无效');continue;}
		let tag=match(line,/^<(ca|cert|key|tls-auth|tls-crypt|tls-crypt-v2)>$/);
		if(tag){inline=tag[1];push(rows,line);continue;}
		let words=split(line,/[ \t]+/), option=words[0];
		if(index(allowed,option)<0)die('不支持的 OpenVPN 指令: '+option);
		if(option=='dev')line='dev tun-mp716';
		if(option=='auth-user-pass')line='auth-user-pass /var/run/mp716-vpn/openvpn.auth';
		if(paths[option]) {
			if(length(words)<2 || !match(words[1],/^[A-Za-z0-9_.-]+$/))die('证书文件必须使用相对文件名');
			line=option+' /etc/mp716-vpn/'+paths[option];
			if(option=='tls-auth'&&words[2]) {if(index(['0','1'],words[2])<0)die('TLS 密钥方向无效');line+=' '+words[2];}
		}
		push(rows,line);
	}
	if(inline)die('内嵌证书标签不完整');
	return join('\n',rows)+'\n';
};
