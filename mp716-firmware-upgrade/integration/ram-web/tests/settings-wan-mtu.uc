// Run with fixture copies of admin.uc/admin-state.uc, never with the live paths.
import { cursor } from 'uci';
import { readfile, writefile, stat } from 'fs';
import { route_admin } from '../admin.uc';
let root = getenv('MP716_NATIVE_FIXTURE_ROOT');
if (!match(root || '', /^\/tmp\/mp716-settings-fix-103\.[A-Za-z0-9]+\/fixture$/)) die('Expected isolated /tmp fixture');
let owner = '11111111111111111111111111111111', results = [];
let common = "config interface 'lan'\n option device 'br-lan'\n option ipaddr '192.168.199.1/24'\nconfig interface 'wan'\n option device 'eth0.2'\n option proto 'dhcp'\n option hostname 'ROUTE'\n option mtu '1499'\n option peerdns '1'\n";
let cfg = {proto:'dhcp',mtu:1498,hostname:'ROUTE',dns:[],macaddr:'',wanMode:'wired'};
function fixture(text) { if (stat(root+'/state/pending.json')) die('Unfinished previous test'); writefile(root+'/config/network',text); }
function ctx() { return cursor(root+'/config',root+'/uci'); }
function apply(value) { return route_admin(null,'POST','network/wan/config',{config:value,confirmTimeoutSec:30},owner); }
function cancel(t, original) {
 let result=route_admin(null,'POST','system/config-task/cancel',{taskId:t.taskId},owner);
 if(result?.data?.state!='rolled_back'||readfile(root+'/config/network')!=original)die('Rollback did not restore exact fixture');
}
function device() { let found=[];ctx().foreach('network','device',(s)=>{if(s.name=='eth0.2')push(found,s);});return found; }
function check_apply(original) {
 fixture(original);let result=apply(cfg),t=result?.data;
 if(!t?.taskId||device()[0]?.mtu!='1498'||ctx().get('network','wan','mtu')!='1498')die('MTU write plan failed');
 return t;
}
let text=common+"config device\n option name 'eth0.2'\n option macaddr '02:00:00:00:00:02'\n";
let t=check_apply(text);if(length(device())!=1||device()[0].macaddr!='02:00:00:00:00:02')die('Existing device changed');cancel(t,text);push(results,'anonymous_device_and_exact_rollback');
text=common+"config device 'wan_link'\n option name 'eth0.2'\n option mtu '1500'\n";
t=check_apply(text);if(device()[0]['.name']!='wan_link')die('Named device not reused');cancel(t,text);push(results,'named_device_reused');
text=common;t=check_apply(text);if(ctx().get('network','mp716_wan_device')!='device')die('Named device not created');cancel(t,text);push(results,'missing_device_creation_rollback');
t=check_apply(text);if(route_admin(null,'POST','system/config-task/confirm',{taskId:t.taskId},owner)?.data?.state!='confirmed')die('Confirm failed');
if(apply(cfg)?.data?.rollbackSec!=0||stat(root+'/state/pending.json'))die('Unchanged configuration created a task');push(results,'confirm_and_unchanged_noop');
function rejects(label,text,value) {
 fixture(text);let result=apply(value);
 if(!result?.error||readfile(root+'/config/network')!=text||stat(root+'/state/pending.json'))die('Invalid plan mutated configuration: '+label);
 push(results,label);
}
rejects('invalid_mtu_rejected',common,{...cfg,mtu:1501});
rejects('alias_device_rejected',replace(common,"option device 'eth0.2'","option device '@wan6'"),cfg);
rejects('shared_lan_device_rejected',replace(common,"option device 'br-lan'","option device 'eth0.2'"),cfg);
rejects('duplicate_device_rejected',common+"config device 'a'\n option name 'eth0.2'\nconfig device 'b'\n option name 'eth0.2'\n",cfg);
rejects('section_collision_rejected',common+"config device 'mp716_wan_device'\n option name 'other0'\n",cfg);
printf('%J\n',{passed:results,isolated_fixture:true});
