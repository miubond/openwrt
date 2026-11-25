// Pure WireGuard logic tests. Run on the device or the native harness; no
// network/firewall service is touched. Key generation cases need /usr/bin/wg.
import { stat } from 'fs';
import { wg_key, cidr4, cidr6, ipv6_addr, wg_defaults, wg_missing, wg_service_info, validate_client, validate_server, client_view, server_view,
	parse_client_conf, peer_client_conf, wg_sync, MASK, WG_CLIENT_IF, WG_SERVER_IF } from '../wireguard.uc';
import { sync_network } from '../vpn.uc';
import { defaults, VPN_KINDS } from '../vpn-config.uc';

let passed=[], skipped=[];
function assert(ok,name){if(!ok)die('FAIL '+name);push(passed,name);}
function rejects(fn,needle,name){
	let message=null;
	try{fn();}catch(e){message=e.message || sprintf('%s',e);}
	assert(message!=null && (!needle || index(message,needle)>=0),name+(message?'':' (accepted)'));
}
const K1='YAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', K2='xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';
const K3='HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=', K4='gN65BkIKy1eCE9pP1wdc8ROUtkHLF2PfAqYdyYBz6EA=';
let lan={reserved:[{label:'lan',net:cidr4('192.168.199.0/24')},{label:'wan',net:cidr4('10.251.0.0/24')}]};
let have_wg=!!stat('/usr/bin/wg');

assert(wg_key(K1) && !wg_key('abc') && !wg_key(K1+'x') && !wg_key(replace(K1,'=','A')),'key_format');
let n=cidr4('10.72.0.1/24');
assert(n.network==cidr4('10.72.0.0/24').value && n.bits==24 && n.size==256 && !cidr4('10.0.0.0/33') && !cidr4('300.0.0.0/8'),'cidr4');
let info=wg_service_info({enabled:false}), missing=wg_missing();
assert(info.enabled===false && info.serviceAvailable==!length(missing) &&
	(length(missing)?index(info.serviceMessage,missing[0])>=0:info.serviceMessage==''),'service_info_reports_missing');

// Client
let off=validate_client(wg_defaults('wgclient'),null,lan);
assert(!off.enabled && off.privateKey=='','disabled_client_needs_nothing');
let base={...wg_defaults('wgclient'),enabled:true,privateKey:K1,addresses:['10.73.0.2/32'],
	peer:{publicKey:K2,presharedKey:'',endpointHost:'vpn.example.org',endpointPort:51820,allowedIPs:['10.73.0.0/24'],keepalive:25}};
if(have_wg) {
	let cl=validate_client(base,null,lan);
	assert(cl.enabled && wg_key(cl.publicKey) && cl.publicKey!=K1,'client_public_key_derived');
	let kept=validate_client({...base,privateKey:MASK},cl,lan);
	assert(kept.privateKey==K1 && kept.publicKey==cl.publicKey,'mask_keeps_private_key');
	let regen=validate_client({...base,privateKey:'generate'},cl,lan);
	assert(wg_key(regen.privateKey) && regen.privateKey!=K1,'generate_replaces_private_key');
	let psk=validate_client({...base,peer:{...base.peer,presharedKey:'generate'}},cl,lan);
	assert(wg_key(psk.peer.presharedKey),'psk_generate');
	let v=client_view(psk), text=sprintf('%J',v);
	assert(index(text,K1)<0 && index(text,psk.peer.presharedKey)<0 && v.privateKey==MASK && v.peer.presharedKey==MASK && v.hasPrivateKey,'client_view_hides_secrets');
	rejects(()=>validate_client({...base,peer:{...base.peer,allowedIPs:['0.0.0.0/0']}},cl,lan),'全局模式','split_rejects_default_route');
	rejects(()=>validate_client({...base,peer:{...base.peer,allowedIPs:['0.0.0.0/1']}},cl,lan),'全局模式','split_rejects_wide_prefix');
	rejects(()=>validate_client({...base,routeMode:'global'},cl,lan),'允许全局路由','global_needs_explicit_consent');
	assert(validate_client({...base,routeMode:'global',allowGlobalRoute:true},cl,lan).routeMode=='global','global_with_consent');
	rejects(()=>validate_client({...base,peer:{...base.peer,allowedIPs:['192.168.199.0/24']}},cl,lan),'重叠','allowed_ips_cannot_shadow_lan');
	rejects(()=>validate_client({...base,peer:{...base.peer,allowedIPs:['10.251.0.0/16']}},cl,lan),'重叠','allowed_ips_cannot_shadow_wan');
	rejects(()=>validate_client({...base,addresses:['192.168.199.5/32']},cl,lan),'重叠','tunnel_address_cannot_shadow_lan');
	rejects(()=>validate_client({...base,useDns:true,dns:['1.1.1.1']},cl,lan),'AllowedIPs','split_dns_must_be_inside_tunnel');
	assert(validate_client({...base,useDns:true,dns:['10.73.0.1']},cl,lan).useDns,'split_dns_inside_tunnel');
	rejects(()=>validate_client({...base,peer:{...base.peer,publicKey:cl.publicKey}},cl,lan),'相同','peer_key_differs_from_own');
	rejects(()=>validate_client({...base,peer:{...base.peer,endpointHost:'bad host;reboot'}},cl,lan),'Endpoint','endpoint_validated');
	let v6=validate_client({...base,addresses:['10.73.0.2/32','fd00::2/64'],peer:{...base.peer,allowedIPs:['10.73.0.0/24','fd00:1::/64']}},cl,lan);
	assert(index(v6.addresses,'fd00::2/64')>=0 && index(v6.peer.allowedIPs,'fd00:1::/64')>=0,'client_accepts_ipv6_addresses');
} else push(skipped,'client_key_cases_need_wg');
rejects(()=>validate_client({...base,privateKey:''},null,lan),'私钥','enabled_requires_private_key');
rejects(()=>validate_client({...base,privateKey:'not-a-key'},null,lan),'私钥','bad_private_key_rejected');
rejects(()=>validate_client({...base,mtu:9000},null,lan),'MTU','mtu_bounds');
assert(cidr6('fd00::2/64') && cidr6('fd00::2/64').bits==64 && !cidr6('fd00::2/129') && ipv6_addr('fd00::2') && !ipv6_addr(':::1'),'cidr6_and_ipv6_addr');

// Server
let sbase={...wg_defaults('wgserver'),enabled:true,privateKey:K1,publicHost:'vpn.example.org',
	peers:[{name:'laptop',publicKey:K3},{name:'phone',publicKey:K4,address:'10.72.0.9',allowedIPs:['192.168.50.0/24']}]};
rejects(()=>validate_server({...sbase,listenPort:1701},null,lan),'端口','server_reserved_port');
rejects(()=>validate_server({...sbase,address:'10.72.0.0/24'},null,lan),'主机地址','server_address_not_network');
rejects(()=>validate_server({...sbase,address:'192.168.199.200/24'},null,lan),'重叠','server_subnet_cannot_shadow_lan');
if(have_wg) {
	rejects(()=>validate_server({...sbase,peers:[{name:'a',publicKey:K3},{name:'b',publicKey:K3}]},null,lan),'重复','duplicate_peer_key');
	rejects(()=>validate_server({...sbase,peers:[{name:'a',publicKey:K3,address:'10.72.1.5'}]},null,lan),'网段','peer_address_inside_subnet');
	rejects(()=>validate_server({...sbase,peers:[{name:'a',publicKey:K3,allowedIPs:['192.168.199.0/24']}]},null,lan),'重叠','peer_subnet_cannot_shadow_lan');
	let sv=validate_server(sbase,null,lan);
	assert(sv.peers[0].address=='10.72.0.2/32' && sv.peers[1].address=='10.72.0.9/32','peer_address_allocation');
	assert(index(sv.peers[0].clientAllowedIPs,'10.72.0.0/24')>=0 && index(sv.peers[0].clientAllowedIPs,'192.168.199.0/24')>=0,'client_allowed_ips_default');
	assert(sv.peers[0].privateKey=='' && match(sv.peers[0].id,/^p[0-9a-f]{8}$/),'imported_peer_has_no_private_key');
	let gen=validate_server({...sbase,peers:[...sv.peers,{name:'tablet',generateKeys:true,presharedKey:'generate'}]},sv,lan);
	let tablet=gen.peers[2];
	assert(wg_key(tablet.privateKey) && wg_key(tablet.publicKey) && wg_key(tablet.presharedKey) && tablet.address=='10.72.0.3/32','router_generated_peer_keys');
	assert(gen.peers[0].id==sv.peers[0].id && gen.peers[0].publicKey==K3,'existing_peer_identity_kept');
	let kept=validate_server({...sbase,privateKey:MASK,peers:map(server_view(gen).peers,(p)=>({...p}))},gen,lan);
	assert(kept.privateKey==K1 && kept.peers[2].privateKey==tablet.privateKey && kept.peers[2].presharedKey==tablet.presharedKey,'view_roundtrip_keeps_secrets');
	let text=sprintf('%J',server_view(gen));
	assert(index(text,K1)<0 && index(text,tablet.privateKey)<0 && index(text,tablet.presharedKey)<0,'server_view_hides_secrets');
	let conf=peer_client_conf(gen,tablet);
	assert(index(conf,'PrivateKey = '+tablet.privateKey)>=0 && index(conf,'PublicKey = '+gen.publicKey)>=0 &&
		index(conf,'Endpoint = vpn.example.org:51820')>=0 && index(conf,'Address = 10.72.0.3/32')>=0,'export_client_conf');
	assert(index(peer_client_conf(gen,gen.peers[0]),'<')>=0,'export_without_private_key_uses_placeholder');
	rejects(()=>peer_client_conf({...gen,publicHost:''},tablet),'公网地址','export_needs_public_host');
} else push(skipped,'server_key_cases_need_wg');

// Import
let imported=parse_client_conf('[Interface]\nPrivateKey = '+K1+'\nAddress = 10.8.0.2/24, fd00::2/64\nDNS = 10.8.0.1\n\n[Peer]\nPublicKey = '+K2+'\nPresharedKey = '+K3+'\nEndpoint = 203.0.113.5:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n');
let ic=imported.config;
assert(!ic.enabled && ic.routeMode=='global' && !ic.allowGlobalRoute && ic.privateKey==K1 && ic.peer.presharedKey==K3,'import_global_config_disabled');
assert(ic.addresses[0]=='10.8.0.2/24' && ic.addresses[1]=='fd00::2/64' && ic.peer.endpointHost=='203.0.113.5' && ic.peer.endpointPort==51820 && length(imported.warnings)>=1,'import_keeps_ipv6_and_sets_global');
rejects(()=>parse_client_conf('[Interface]\nPrivateKey = '+K1+'\nPostUp = iptables -F\n[Peer]\nPublicKey = '+K2+'\nEndpoint = a.b:1\n'),'PostUp','import_rejects_hooks');
rejects(()=>parse_client_conf('[Interface]\nPrivateKey = '+K1+'\n[Peer]\nPublicKey = '+K2+'\nEndpoint = a.b:1\n[Peer]\nPublicKey = '+K3+'\nEndpoint = c.d:1\n'),'一个','import_single_peer');
rejects(()=>parse_client_conf('[Interface]\nPrivateKey = '+K1+'\n[Peer]\nPublicKey = '+K2+'\nEndpoint = [2001:db8::1]:51820\n'),'IPv6','import_ipv6_endpoint_rejected');

// UCI generation
let records={network:{},firewall:{}};
let c={
	get:(pkg,name,option)=>{
		if(pkg=='network' && name=='lan' && option=='ipaddr')return '192.168.199.1';
		if(pkg=='network' && name=='lan' && option=='netmask')return '255.255.255.0';
		return option?records[pkg][name]?.[option]:records[pkg][name]?.['.type'];
	},
	set:(pkg,name,key,value)=>{
		if(type(value)=='array' && !length(value))return false;
		records[pkg][name]??={'.name':name};
		if(value==null)records[pkg][name]['.type']=key;else records[pkg][name][key]=value;
		return true;
	},
	foreach:(pkg,t,fn)=>{for(let name,row in records[pkg])if(!t||row['.type']==t)fn(row);},
	delete:(pkg,name,option)=>{if(option)delete records[pkg][name][option];else delete records[pkg][name];return true;}
};
let bus={call:()=>null};
let m={};for(let kind in VPN_KINDS)m[kind]=defaults(kind);
let client={...base,publicKey:K3,routeMode:'global',allowGlobalRoute:true,useDns:true,dns:['1.1.1.1','8.8.8.8']};
records.network.wan={'.name':'wan','.type':'interface',proto:'dhcp',peerdns:'1'};
let server={...wg_defaults('wgserver'),enabled:true,privateKey:K4,publicKey:K2,peers:[{id:'pa',name:'a',enabled:true,publicKey:K3,presharedKey:'',address:'10.72.0.2/32',allowedIPs:['192.168.50.0/24'],clientAllowedIPs:[],keepalive:0}]};
m.wg={wgclient:client,wgserver:server};
sync_network(c,m,bus);
let ifc=records.network[WG_CLIENT_IF], peer=records.network.mp716_vpn_wgc_peer;
assert(ifc?.proto=='wireguard' && ifc.private_key==K1 && ifc.mp716_managed=='1' && peer?.['.type']=='wireguard_'+WG_CLIENT_IF,'client_uci_sections');
assert(index(peer.allowed_ips,'0.0.0.0/1')>=0 && index(peer.allowed_ips,'128.0.0.0/1')>=0 && index(peer.allowed_ips,'0.0.0.0/0')<0 && ifc.defaultroute==null,'global_mode_never_replaces_default_route');
assert(records.network.mp716_vpn_wgc_protect_lan?.lookup=='main' && records.network.mp716_vpn_wgc_protect_lan?.dest=='192.168.199.0/24','global_protects_lan_management');
assert(records.firewall.mp716_vpn_wgc_nowan?.src=='lan' && records.firewall.mp716_vpn_wgc_nowan?.dest=='wan' && records.firewall.mp716_vpn_wgc_nowan?.proto=='all' && records.firewall.mp716_vpn_wgc_nowan?.target=='REJECT','global_blocks_lan_wan_fallback');
assert(records.network.wan?.peerdns=='0' && records.network.wan?.mp716_wg_hold_peerdns=='1','global_dns_pauses_wan_peerdns');
let ifs=records.network[WG_SERVER_IF], sp=records.network.mp716_vpn_wgs_pa;
assert(ifs?.listen_port=='51820' && sp?.public_key==K3 && index(sp.allowed_ips,'10.72.0.2/32')>=0 && index(sp.allowed_ips,'192.168.50.0/24')>=0,'server_uci_sections');
assert(records.firewall.mp716_vpn_wgs_in?.dest_port=='51820' && records.firewall.mp716_vpn_wgs_zone?.input=='REJECT' && records.firewall.mp716_vpn_wgs_dns && !records.firewall.mp716_vpn_wgs_fwd_wan,'server_firewall_defaults');
assert(records.firewall.mp716_vpn_wgc_zone?.masq=='1' && records.firewall.mp716_vpn_wgc_fwd_lan?.dest==WG_CLIENT_IF && records.firewall.mp716_vpn_zone==null,'wireguard_zones_independent_of_ppp_zone');
m.pptp={...m.pptp,enabled:true,server:'vpn.example.org',username:'one',password:'two'};
sync_network(c,m,bus);
assert(records.network[WG_CLIENT_IF]?.private_key==K1 && records.network.mp716pptp?.proto=='pptp','pptp_save_keeps_wireguard_sections');
m.wg={wgclient:{...client,enabled:false},wgserver:{...server,enabled:false}};
sync_network(c,m,bus);
assert(!records.network[WG_CLIENT_IF] && !records.network.mp716_vpn_wgs_pa && !records.firewall.mp716_vpn_wgs_in && records.network.mp716pptp,'disable_removes_only_wireguard');
assert(!records.firewall.mp716_vpn_wgc_nowan && records.network.wan?.peerdns=='1' && records.network.wan?.mp716_wg_hold_peerdns==null,'disable_restores_wan_dns_and_fallback');

printf('%J\n',{passed:length(passed),skipped:skipped,names:passed});
