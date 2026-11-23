// Run through the isolated native harness. No service or network command runs.
import { client_interface, sync_network } from '../vpn.uc';
import { defaults, VPN_KINDS } from '../vpn-config.uc';
let passed=[];
function assert(ok,name){if(!ok)die(name);push(passed,name);}
let records={network:{},firewall:{}}, removed=[];
let c={
	get:(pkg,name,option)=>option?records[pkg][name]?.[option]:records[pkg][name]?.['.type'],
	set:(pkg,name,key,value)=>{
		if(type(value)=='array' && !length(value))return false;
		if(value==null){records[pkg][name]??={'.name':name};records[pkg][name]['.type']=key;}
		else {records[pkg][name]??={'.name':name};records[pkg][name][key]=value;}
		return true;
	},
	foreach:(pkg,type,fn)=>{for(let name,row in records[pkg])if(!type||row['.type']==type)fn(row);},
	delete:(pkg,name,option)=>{
		if(option){delete records[pkg][name][option];return true;}
		push(removed,name);delete records[pkg][name];return true;
	}
};
let m={};for(let kind in VPN_KINDS)m[kind]=defaults(kind);
m.pptp={...m.pptp,enabled:true,server:'vpn.example.org',username:'one',password:'two'};
m.xl2tp={...m.xl2tp,enabled:true,server:'l2tp.example.org',username:'one"two',password:'a\\b"c'};
records.network.mp716_vpn_pptp={'.name':'mp716_vpn_pptp','.type':'interface',mp716_managed:'1'};
records.network.unmanaged={'.name':'unmanaged','.type':'interface',proto:'static'};
let bus={call:(object,method,args)=>object=='network.interface.wan'?{l3_device:'pppoe-wan'}:null};
sync_network(c,m,bus);
assert(length('pptp-'+client_interface('pptp'))<=15 && length('l2tp-'+client_interface('xl2tp'))<=15,'netifd_kernel_interface_names_fit');
assert(records.network.mp716pptp?.proto=='pptp' && records.network.mp716l2tp?.proto=='l2tp','native_client_names_used');
assert(records.network.mp716pptp.auto=='0' && records.network.mp716l2tp.auto=='0','client_boot_waits_for_supervisor');
assert(index(removed,'mp716_vpn_pptp')>=0 && records.network.unmanaged?.proto=='static','legacy_managed_interface_migrated_only');
assert(records.network.mp716l2tp.username=='one\\"two' && records.network.mp716l2tp.password=='a\\\\b\\"c','l2tp_pppd_option_escaping');
let zone=records.firewall.mp716_vpn_zone;
assert(index(zone.network,'mp716pptp')>=0 && index(zone.network,'mp716l2tp')>=0,'firewall_uses_short_native_interfaces');
assert(index(zone.device,'!pppoe+')>=0 && index(zone.device,'!pppoe-wan')>=0,'vpn_zone_excludes_pppoe_wan');
m.pptp.enabled=false;m.xl2tp.enabled=false;
sync_network(c,m,bus);
assert(!records.network.mp716pptp && !records.network.mp716l2tp && records.network.unmanaged?.proto=='static','disable_cleans_short_managed_interfaces_only');
for(let kind in ['pptpd','xl2tpd','openvpn']) {
	let only={};for(let name in VPN_KINDS)only[name]=defaults(name);
	only[kind].enabled=true;
	sync_network(c,only,bus);
	let only_zone=records.firewall.mp716_vpn_zone;
	assert(only_zone?.['.type']=='zone' && only_zone.network==null && index(only_zone.device,'tun-mp716')>=0,kind+'_device_only_zone_omits_empty_network');
	assert(records.network.unmanaged?.proto=='static',kind+'_preserves_unmanaged_network');
}
printf('%J\n',{passed:passed,fixture_only:true,services_started:false});
