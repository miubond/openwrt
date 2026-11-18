'use strict';
import { cursor } from 'uci';
import { readfile, writefile, mkdir, chmod, rename, stat } from 'fs';
import { defaults, validate_vpn, validate_openvpn, ppp_quote, VPN_KINDS } from '/usr/share/mp716/vpn-config.uc';
import { check_vpn_services } from '/usr/share/mp716/vpn-services.uc';

export const VPN_RUNTIME='/var/run/mp716-vpn';
function options(cfg,name) {
	let lines=['auth','name '+name,'require-mschap-v2','refuse-pap','refuse-chap','refuse-mschap','refuse-eap',
		'nobsdcomp','nodeflate','mtu '+cfg.mtu,'mru '+cfg.mru,'lcp-echo-interval 30','lcp-echo-failure 3',
		'ipparam '+name,'ip-up-script /usr/share/mp716/vpn-ppp-up.sh','ip-down-script /usr/share/mp716/vpn-ppp-down.sh'];
	if(name=='mp716-pptp')push(lines,cfg.mppe==0?'require-mppe-128':'nomppe');
	else push(lines,'nomppe');
	if(cfg.dnsEnabled) {push(lines,'ms-dns '+cfg.primaryDns);if(cfg.secondaryDns)push(lines,'ms-dns '+cfg.secondaryDns);}
	return join('\n',lines)+'\n';
}
export function read_models(c) {
	let m={};
	for(let name in VPN_KINDS) {
		let raw=c.get('mp716_vpn',name,'data');
		try {m[name]=raw?{...defaults(name),...json(raw)}:defaults(name);} catch(e) {die('VPN 配置无效: '+name);}
	}
	// A configuration restore must not bypass the same validation as a save.
	for(let name in VPN_KINDS)m[name]=validate_vpn(name,m[name],null,m);
	return m;
};
export function vpn_plan(m,read,base_chap) {
	for(let name in VPN_KINDS)m[name]=validate_vpn(name,m[name],null,m);
	let files={}, services={pptp:!!m.pptpd.enabled,l2tp:!!(m.xl2tpd.enabled||m.xl2tp.enabled),openvpn:!!m.openvpn.enabled,pptpClient:!!m.pptp.enabled,l2tpClient:!!m.xl2tp.enabled,
		ipsec:!!(m.xl2tpd.enabled&&m.xl2tpd.ipsecEnabled||m.xl2tp.enabled&&length(m.xl2tp.ipsecKey))};
	let chap=base_chap || '';
	if(length(chap)&&substr(chap,-1)!='\n')chap+='\n';
	for(let user in m.users.users) {
		for(let pair in [['pptp','mp716-pptp'],['l2tp','mp716-l2tp']]) {
			if(user.type!='all'&&user.type!=pair[0])continue;
			chap+=ppp_quote(user.username)+' '+pair[1]+' '+ppp_quote(user.password)+' '+(user.address || '*')+'\n';
		}
	}
	files['chap-secrets']=chap;
	files['pptp.options']=options(m.pptpd,'mp716-pptp');
	files['l2tp.options']=options(m.xl2tpd,'mp716-l2tp');
	files['pptpd.conf']='option '+VPN_RUNTIME+'/pptp.options\nlocalip '+m.pptpd.server+'\nremoteip '+m.pptpd.startIp+'-'+split(m.pptpd.endIp,'.')[3]+'\n';
	let l2tp='[global]\nport = 1701\naccess control = no\n';
	if(m.xl2tpd.enabled)l2tp+='[lns mp716]\nip range = '+m.xl2tpd.startIp+'-'+m.xl2tpd.endIp+'\nlocal ip = '+m.xl2tpd.server+'\nrequire authentication = yes\nrefuse pap = yes\nrequire chap = yes\nname = mp716-l2tp\npppoptfile = '+VPN_RUNTIME+'/l2tp.options\nlength bit = yes\n';
	files['xl2tpd.conf']=l2tp;files['xl2tp-secrets']='';
	files['openvpn.auth']=m.openvpn.username+'\n'+m.openvpn.password+'\n';
	let ovpn='';
	if(m.openvpn.enabled) {
		if(m.openvpn.mode==1) {
			let raw=read('/etc/mp716-vpn/client.ovpn');if(raw==null)die('请先上传 OpenVPN 配置');ovpn=validate_openvpn(raw);
			if(match(ovpn,/(^|\n)auth-user-pass([ \t]|\n|$)/)&&!length(m.openvpn.username))die('该 OpenVPN 配置需要用户名与密码');
		}else {
			if(!read('/etc/mp716-vpn/ca.pem'))die('OpenVPN 表单模式需要上传 CA 证书');
			ovpn='client\ndev tun-mp716\nproto udp\nremote '+m.openvpn.host+' '+m.openvpn.port+'\nnobind\npersist-key\npersist-tun\nremote-cert-tls server\nca /etc/mp716-vpn/ca.pem\n';
			if(length(m.openvpn.username))ovpn+='auth-user-pass '+VPN_RUNTIME+'/openvpn.auth\n';
			if(read('/etc/mp716-vpn/client.crt')&&read('/etc/mp716-vpn/client.key'))ovpn+='cert /etc/mp716-vpn/client.crt\nkey /etc/mp716-vpn/client.key\n';
		}
		// --up runs before peer authentication. Only --route-up establishes a
		// connected state; restart/down hooks clear it even with persist-tun.
		ovpn+='\nclient\ndev tun-mp716\nauth-nocache\nscript-security 2\nroute-up /usr/share/mp716/vpn-openvpn-up.sh\nroute-pre-down /usr/share/mp716/vpn-openvpn-down.sh\ndown /usr/share/mp716/vpn-openvpn-down.sh\ndown-pre\nup-restart\n';
	}
	files['openvpn.conf']=ovpn;
	let server=m.xl2tpd.enabled&&m.xl2tpd.ipsecEnabled, key=server?m.xl2tpd.ipsecKey:m.xl2tp.ipsecKey;
	files['ipsec.conf']='config setup\n  uniqueids=no\n';
	if(services.ipsec)files['ipsec.conf']+='conn mp716-l2tp\n  keyexchange=ikev1\n  type=transport\n  authby=psk\n  reqid=902\n  left=%defaultroute\n  leftprotoport=17/'+(server?'1701':'%any')+'\n  right='+(server?'%any':m.xl2tp.server)+'\n  rightprotoport=17/'+(server?'%any':'1701')+'\n  dpddelay=30s\n  dpdtimeout=120s\n  dpdaction='+(server?'clear':'restart')+'\n  rekey=no\n  auto='+(server?'add':'start')+'\n';
	files['ipsec.secrets']=services.ipsec?': PSK '+ppp_quote(key)+'\n':'';
	files['strongswan.conf']='charon {\n  load_modular = yes\n  plugins {\n    include /etc/strongswan.d/charon/*.conf\n    stroke {\n      secrets_file = '+VPN_RUNTIME+'/ipsec.secrets\n    }\n  }\n}\n';
	let guard=server?'input':services.ipsec?'output':'';
	files['services.json']=sprintf('%J',{...services,chap:!!(m.pptpd.enabled||m.xl2tpd.enabled),guard:guard});
	files['guard.nft']=guard?'table inet mp716_vpn_guard {\nchain '+guard+' { type filter hook '+guard+' priority -5; policy accept; udp dport 1701 ipsec '+(server?'in':'out')+' reqid 902 accept; udp dport 1701 drop; }\n}\n':'';
	return {files:files,services:services};
};
export function render_vpn() {
	let c=cursor(), m=read_models(c);
	check_vpn_services(m);
	mkdir(VPN_RUNTIME,0700);chmod(VPN_RUNTIME,0700);mkdir(VPN_RUNTIME+'/sessions',0700);
	let base=readfile(VPN_RUNTIME+'/chap-original');
	if(base==null)base=readfile('/etc/ppp/chap-secrets') || '';
	let plan=vpn_plan(m,readfile,base);
	for(let name,raw in plan.files) {
		if(readfile(VPN_RUNTIME+'/'+name)==raw)continue;
		if(writefile(VPN_RUNTIME+'/'+name+'.new',raw)==null)die('无法生成 VPN 服务配置');
		chmod(VPN_RUNTIME+'/'+name+'.new',0600);
		if(!rename(VPN_RUNTIME+'/'+name+'.new',VPN_RUNTIME+'/'+name))die('无法提交 VPN 服务配置');
	}
	return plan.services;
};
