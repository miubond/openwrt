// Run only with a harness that redirects the diagnostic root and admin-state
// modules to this isolated fixture. No network probe or service is started.
import { route_diagnostics, diagnostic_args } from '../diagnostics.uc';
import { mkdir, writefile } from 'fs';
let root=getenv('MP716_ADVANCED_FIXTURE');
if(!match(root || '',/^\/tmp\/mp716-advanced-tests\.[A-Za-z0-9]+\/fixture$/))die('Expected isolated fixture');
let owner='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',other='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',passed=[];
function assert(ok,name){if(!ok)die(name);push(passed,name);}
function rejects(name,fn){let rejected=false;try{fn();}catch(e){rejected=true;}assert(rejected,name);}
rejects('invalid_ipv4_target',()=>diagnostic_args({type:'ping',target:'999.168.1.1'},[]));
rejects('url_target_rejected',()=>diagnostic_args({type:'ping',target:'https://example.org/path'},[]));
rejects('port_target_rejected',()=>diagnostic_args({type:'traceroute',target:'example.org:443'},[]));
rejects('bad_lan_device_rejected',()=>diagnostic_args({type:'dhcp'},[],'wan;reboot'));
assert(diagnostic_args({type:'dhcp'},[],'br-lan')[1]=='br-lan','dhcp_uses_actual_lan_device');
assert(diagnostic_args({type:'ping',target:'127.0.0.1',count:1},[])[3]=='','ping_automatic_source');
let dir=root+'/diagnostics/'+owner+'-dhcp';mkdir(root+'/diagnostics',0700);mkdir(dir,0700);
writefile(dir+'/output','DHCP_SERVER 192.168.199.1 02:11:22:33:44:55\nDHCP_SERVER 192.168.199.1 02:11:22:33:44:55\nDHCP_SERVER 192.168.199.2\nDHCP_SERVER 999.1.1.1\n');
writefile(dir+'/task.json',sprintf('%J',{pid:0,started:'',created:0}));writefile(dir+'/exit','0\n');
let r=route_diagnostics(null,'POST','tools/diagnostic/poll',{type:'dhcp'},owner);
assert(r?.data?.flag==2 && r.data.running==false,'completed_poll_status');
assert(length(r.data.servers)==2 && r.data.servers[0].mac=='02:11:22:33:44:55' && r.data.servers[1].mac=='','real_offer_mac_and_relay_unknown');
r=route_diagnostics(null,'POST','tools/diagnostic/poll',{type:'dhcp'},other);
assert(r?.data?.flag==0 && length(r.data.servers)==0,'diagnostic_session_isolation');
r=route_diagnostics(null,'POST','tools/diagnostic/stop',{type:'dhcp'},owner);
assert(r?.data==null && !r?.error,'stop_completed_is_idempotent');
r=route_diagnostics(null,'POST','tools/diagnostic/poll',{type:'dhcp'},'../../escape');
assert(r?.error=='VALIDATION','diagnostic_owner_validation');
printf('%J\n',{passed:passed,fixture_only:true,network_io:false});
