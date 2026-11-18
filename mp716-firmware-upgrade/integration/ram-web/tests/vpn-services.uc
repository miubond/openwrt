// Dependency/ownership/procd readiness checks with synthetic process records.
import { defaults, VPN_KINDS } from '../vpn-config.uc';
import { service_requirements, missing_service_dependencies, validate_service_ownership, vpn_service_health } from '../vpn-services.uc';
let passed=[];
function models(){let m={};for(let name in VPN_KINDS)m[name]=defaults(name);return m;}
function assert(ok,name){if(!ok)die(name);push(passed,name);}
function rejects(name,fn){let failed=false;try{fn();}catch(e){failed=true;}assert(failed,name);}
let m=models();
assert(!length(service_requirements(m)),'disabled_models_need_no_daemon');
m.pptp.enabled=true;
assert(index(service_requirements(m),'/usr/sbin/pppd')>=0 && index(service_requirements(m),'/lib/netifd/proto/ppp.sh')>=0 && index(service_requirements(m),'/lib/netifd/proto/pptp.sh')<0,'client_uses_pinned_ppp_protocol_path');
assert(!length(missing_service_dependencies(m,()=>true,pattern=>pattern=='/usr/lib/pppd/*/pptp.so'?['/usr/lib/pppd/2.5.2/pptp.so']:[])),'versioned_pptp_plugin_satisfies_dependencies');
assert(missing_service_dependencies(m,()=>true,()=>[])[0]=='/usr/lib/pppd/*/pptp.so','pppd_without_pptp_plugin_is_rejected');
assert(index(missing_service_dependencies(m,path=>path!='/lib/netifd/proto/ppp.sh',()=>['plugin']),'/lib/netifd/proto/ppp.sh')>=0,'missing_ppp_protocol_is_rejected');
m=models();m.xl2tp.enabled=true;m.xl2tp.ipsecKey='secret';
assert(index(service_requirements(m),'/usr/lib/ipsec/starter')>=0 && index(service_requirements(m),'/usr/sbin/xl2tpd')>=0,'ipsec_client_requires_both_daemons');
assert(missing_service_dependencies(m,()=>true,()=>[])[0]=='/usr/lib/pppd/*/pppol2tp.so','l2tp_requires_kernel_ppp_plugin');
rejects('unmanaged_l2tp_refused',()=>validate_service_ownership(m,[{cmd:'/usr/sbin/xl2tpd\x00-D\x00-c\x00/etc/xl2tpd/xl2tpd.conf'}]));
assert(validate_service_ownership(m,[{cmd:'/usr/sbin/xl2tpd\x00-D\x00-c\x00/var/run/mp716-vpn/xl2tpd.conf'}]),'managed_l2tp_allowed');
rejects('unmanaged_ipsec_refused',()=>validate_service_ownership(m,[{cmd:'/usr/lib/ipsec/charon\x00',environ:'PATH=/usr/bin\x00'}]));
assert(validate_service_ownership(m,[{cmd:'/usr/lib/ipsec/charon\x00',environ:'STRONGSWAN_CONF=/var/run/mp716-vpn/strongswan.conf\x00'}]),'managed_charon_environment_allowed');
m=models();m.pptpd.enabled=true;
rejects('unmanaged_pptpd_refused',()=>validate_service_ownership(m,[{cmd:'/usr/sbin/pptpd\x00--fg\x00'}]));
let instances={},bus={call:(object,action,args)=>({'mp716-vpn':{instances:instances}})};
assert(!vpn_service_health(bus,m).ready && vpn_service_health(bus,m).missing[0]=='pptp','missing_server_process_not_ready');
instances.pptp={running:true,pid:123};
assert(vpn_service_health(bus,m).ready,'running_managed_server_is_ready');
instances.pptp={running:false,pid:123};
assert(!vpn_service_health(bus,m).ready,'crashed_server_not_ready');
m=models();instances.pptp={running:true,pid:123};
assert(!vpn_service_health(bus,m).ready && vpn_service_health(bus,m).unexpected[0]=='pptp','disabled_server_must_actually_stop');
instances={};m.pptp.enabled=true;
assert(vpn_service_health(bus,m).ready && !length(vpn_service_health(bus,m).expected),'client_only_does_not_fake_a_server_process');
printf('%J\n',{passed:passed,fixture_only:true,services_started:false});
