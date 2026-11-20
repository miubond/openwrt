// Pure rendering tests: no cursor, service start, netifd, nft or mount is invoked.
import { defaults, VPN_KINDS, session_addresses } from '../vpn-config.uc';
import { vpn_plan } from '../vpn-runtime.uc';
let passed=[];
function assert(ok,message) {if(!ok)die(message);}
function models() {let m={};for(let name in VPN_KINDS)m[name]=defaults(name);return m;}
function reject(name,fn) {let failed=false;try{fn();}catch(e){failed=true;}assert(failed,name);push(passed,name);}
let m=models(), base='# Unmanaged account\n"legacy" legacy-server "untouched" *\n';
let p=vpn_plan(m,()=>null,base);
assert(!p.services.pptp&&!p.services.l2tp&&!p.services.openvpn&&!p.services.ipsec,'disabled services were started');push(passed,'disabled_services_stay_off');
assert(p.files['chap-secrets']==base,'unmanaged PPP credentials changed');push(passed,'unmanaged_chap_preserved');
assert(index(p.files['xl2tpd.conf'],'[lns ')<0,'disabled server still accepts incoming L2TP tunnels');push(passed,'disabled_l2tp_has_no_LNS_listener');
m.pptpd.enabled=true;m.users.users=[{username:'one"two',password:'a\\b"c',type:'all',address:'',comment:'',routes:'192.168.50.0/24'}];
p=vpn_plan(m,()=>null,base);
assert(index(p.files['chap-secrets'],'"one\\"two" mp716-pptp "a\\\\b\\"c" *')>=0,'PPP credential escaping failed');push(passed,'ppp_credentials_escaped');
assert(index(p.files['pptp.options'],'require-mppe-128')>=0 && index(p.files['pptp.options'],'ip-up-script /usr/share/mp716/vpn-ppp-up.sh')>=0,'PPTP native options missing');push(passed,'pptp_auth_encryption_and_hooks');
assert(index(p.files['pptpd.conf'],'remoteip 10.71.60.10-100')>=0,'PPTP pool syntax invalid');push(passed,'pptp_pool_rendered');
assert(index(p.files['pptpd.conf'],'noipparam\n')==0 && index(p.files['pptp.options'],'\nipparam mp716-pptp\n')>=0,'pptpd overrides the managed PPP hook type');push(passed,'pptp_hook_ipparam_not_overridden_by_outer_client_ip');
reject('optional_mppe_rejected',()=>vpn_plan({...m,pptpd:{...m.pptpd,mppe:1}},()=>null,base));
m=models();m.xl2tpd={...m.xl2tpd,enabled:true,ipsecEnabled:true,ipsecKey:'secret"one\\two'};
p=vpn_plan(m,()=>null,base);
assert(p.services.ipsec&&p.services.l2tp&&index(p.files['xl2tpd.conf'],'[lns default]')>=0,'L2TP server runtime absent');push(passed,'l2tp_server_runtime');
// xl2tpd 1.3.18 adds require-chap (MD5) before pppoptfile when this
// directive is set. pppd 2.5.2 ORs that bit with require-mschap-v2;
// refuse-chap affects the opposite authentication direction only.
assert(p.files['xl2tpd.conf']=='[global]\nport = 1701\naccess control = no\n[lns default]\nip range = '+m.xl2tpd.startIp+'-'+m.xl2tpd.endIp+'\nlocal ip = '+m.xl2tpd.server+'\nrequire authentication = yes\nrefuse pap = yes\nname = mp716-l2tp\npppoptfile = /var/run/mp716-vpn/l2tp.options\nlength bit = yes\n','LNS adds an authentication method outside the managed options');push(passed,'l2tp_lns_does_not_add_chap_md5');
// The outer road-warrior source is not the assigned PPP pool. With no lac
// selectors, upstream get_lns() falls back to deflns, never a named LNS.
assert(length(filter(split(p.files['xl2tpd.conf'],'\n'),(line)=>match(line,/^\[lns /)))==1 && index(p.files['xl2tpd.conf'],'\n[lns default]\n')>=0 && !match(p.files['xl2tpd.conf'],/\n(no )?lac[ \t]*=/),'incoming authenticated road warriors have no unique default LNS');push(passed,'l2tp_outer_peer_uses_default_LNS_without_broad_lac_rule');
let custom=vpn_plan({...m,xl2tpd:{...m.xl2tpd,server:'192.168.240.1',startIp:'192.168.240.10',endIp:'192.168.240.11'}},()=>null,base);
assert(index(custom.files['xl2tpd.conf'],'\n[lns default]\nip range = 192.168.240.10-192.168.240.11\nlocal ip = 192.168.240.1\n')>=0 && custom.files['l2tp.options']==p.files['l2tp.options'] && custom.files['guard.nft']==p.files['guard.nft'] && custom.files['ipsec.conf']==p.files['ipsec.conf'] && custom.files['ipsec.secrets']==p.files['ipsec.secrets'],'LNS selection changes PPP auth, IPsec protection or assigned address-pool semantics');push(passed,'l2tp_default_LNS_preserves_auth_IPsec_and_distinct_PPP_pool');
let l2tp_options=split(trim(p.files['l2tp.options']),'\n');
assert(length(filter(l2tp_options,(line)=>line=='auth'))==1 && length(filter(l2tp_options,(line)=>line=='require-mschap-v2'))==1 && !length(filter(l2tp_options,(line)=>match(line,/^(noauth|require-pap|require-chap|require-mschap|require-eap|\+pap|\+chap|\+mschap|\+eap)( |$)/))),'L2TP peer authentication is not restricted to MS-CHAPv2');push(passed,'l2tp_peer_authentication_requires_mschapv2_only');
assert(index(l2tp_options,'refuse-pap')>=0 && index(l2tp_options,'refuse-chap')>=0 && index(l2tp_options,'refuse-mschap')>=0 && index(l2tp_options,'refuse-eap')>=0 && index(l2tp_options,'nomppe')>=0 && index(l2tp_options,'require-mppe-128')<0,'L2TP authentication direction or IPsec encryption policy changed');push(passed,'l2tp_refusals_and_ipsec_encryption_policy_preserved');
assert(index(l2tp_options,'ipparam mp716-l2tp')>=0 && index(l2tp_options,'ip-up-script /usr/share/mp716/vpn-ppp-up.sh')>=0 && index(l2tp_options,'ip-down-script /usr/share/mp716/vpn-ppp-down.sh')>=0,'L2TP typed PPP hooks changed');push(passed,'l2tp_typed_ppp_hooks_preserved');
assert(index(p.files['guard.nft'],'hook input')>=0&&index(p.files['guard.nft'],'ipsec in reqid 902 accept; udp dport 1701 drop')>=0,'plaintext L2TP is not blocked');push(passed,'ipsec_inbound_plaintext_guard');
assert(index(p.files['ipsec.conf'],'leftprotoport=17/1701')>=0&&index(p.files['ipsec.conf'],'rightprotoport=17/%any')>=0,'IPsec server selectors invalid');push(passed,'ipsec_server_selectors');
assert(index(p.files['ipsec.secrets'],'secret\\"one\\\\two')>=0,'IPsec PSK escaping invalid');push(passed,'ipsec_secret_escaped');
m=models();m.xl2tp={...m.xl2tp,enabled:true,server:'vpn.example.org',username:'one',password:'two',ipsecKey:'three'};
p=vpn_plan(m,()=>null,base);
assert(p.services.l2tpClient && json(p.files['services.json']).l2tpClient,'L2TP client not represented in service plan');push(passed,'l2tp_client_service_flag');
assert(index(p.files['xl2tpd.conf'],'[lns ')<0,'L2TP client-only configuration exposes an incoming LNS');push(passed,'l2tp_client_only_has_no_LNS_listener');
assert(index(p.files['guard.nft'],'hook output')>=0&&index(p.files['ipsec.conf'],'right=vpn.example.org')>=0&&index(p.files['ipsec.conf'],'rightprotoport=17/1701')>=0,'IPsec client selectors invalid');push(passed,'ipsec_client_selectors_and_guard');
m=models();m.openvpn={...m.openvpn,enabled:true,host:'vpn.example.org',username:'one',password:'two'};
reject('form_openvpn_requires_ca',()=>vpn_plan(m,()=>null,base));
p=vpn_plan(m,(path)=>path=='/etc/mp716-vpn/ca.pem'?'fixture-CA':null,base);
assert(p.services.openvpn&&index(p.files['openvpn.conf'],'remote vpn.example.org 1194')>=0&&index(p.files['openvpn.conf'],'auth-user-pass /var/run/mp716-vpn/openvpn.auth')>=0,'OpenVPN form render failed');push(passed,'openvpn_form_and_auth_file');
assert(index(p.files['openvpn.conf'],'up /usr/share/mp716/vpn-openvpn-up.sh')>=0,'OpenVPN real state hook missing');push(passed,'openvpn_status_hooks');
assert(index(p.files['openvpn.conf'],'\nroute-up /usr/share/mp716/vpn-openvpn-up.sh\n')>=0 && index(p.files['openvpn.conf'],'\nup /usr/share/mp716/vpn-openvpn-up.sh\n')<0,'OpenVPN connected state can precede authentication');push(passed,'openvpn_status_only_after_authentication');
assert(index(p.files['openvpn.conf'],'\nroute-pre-down /usr/share/mp716/vpn-openvpn-down.sh\n')>=0 && index(p.files['openvpn.conf'],'\nup-restart\n')>=0,'OpenVPN status survives stale reconnect');push(passed,'openvpn_restart_clears_connection_state');
m.openvpn.mode=1;
p=vpn_plan(m,()=> 'client\nca /etc/mp716-vpn/ca.pem\nremote vpn.example.org\n',base);
assert(index(p.files['openvpn.conf'],'ca /etc/mp716-vpn/ca.pem')>=0,'sanitized profile could not be revalidated');push(passed,'openvpn_canonical_profile_revalidated');
reject('openvpn_auth_profile_requires_credentials',()=>vpn_plan({...m,openvpn:{...m.openvpn,username:'',password:''}},()=> 'client\nauth-user-pass\nremote vpn.example.org\n',base));
reject('restore_cannot_inject_openvpn_script',()=>vpn_plan(m,()=> 'client\nup /tmp/evil\n',base));
reject('restore_cannot_inject_vpn_host',()=>vpn_plan({...models(),openvpn:{...defaults('openvpn'),enabled:true,host:'vpn.example.org\nscript-security 3'}},()=>null,base));
m=models();m.pptp={...m.pptp,enabled:true,server:'vpn.example.org',username:'one',password:'two'};
p=vpn_plan(m,()=>null,base);
assert(p.services.pptpClient && json(p.files['services.json']).pptpClient && !p.services.pptp,'PPTP client-only configuration cannot start');push(passed,'pptp_client_only_service_flag');
let address=session_addresses('openvpn','10.8.0.2','2001:db8::1','');
assert(address.assignIp=='10.8.0.2' && address.dialIp=='2001:db8::1','OpenVPN IPv6 peer or assigned client address incorrect');push(passed,'openvpn_ipv6_transport_session_address');
assert(session_addresses('openvpn','10.8.0.2','','').assignIp=='10.8.0.2','OpenVPN subnet topology incorrectly requires a peer IPv4');push(passed,'openvpn_subnet_topology_session_address');
reject('ppp_missing_peer_address_rejected',()=>session_addresses('pptp','10.71.60.1','',''));
reject('reserved_loopback_server_pool_rejected',()=>vpn_plan({...models(),pptpd:{...defaults('pptpd'),enabled:true,server:'127.0.0.1',startIp:'127.0.0.10',endIp:'127.0.0.100'}},()=>null,base));
reject('reserved_link_local_server_pool_rejected',()=>vpn_plan({...models(),pptpd:{...defaults('pptpd'),enabled:true,server:'169.254.1.1',startIp:'169.254.1.10',endIp:'169.254.1.100'}},()=>null,base));
reject('host_bits_in_user_network_route_rejected',()=>vpn_plan({...models(),users:{...defaults('users'),users:[{username:'one',password:'two',type:'all',address:'',comment:'',routes:'192.168.50.123/24'}]}},()=>null,base));
printf('%J\n',{passed:passed,fixture_only:true,services_started:false});
