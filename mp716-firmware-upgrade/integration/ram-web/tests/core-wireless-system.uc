// Isolated UCI fixtures only. This suite never reloads real network services.
import { cursor } from 'uci';
import { readfile, writefile, stat } from 'fs';
import { route_admin } from '../admin.uc';
import { cpu_counters, cpu_delta } from '../system-values.uc';
let root=getenv('MP716_ADVANCED_FIXTURE');
if(!match(root || '',/^\/tmp\/mp716-advanced-tests\.[A-Za-z0-9]+\/fixture$/))die('Expected isolated fixture');
let owner='33333333333333333333333333333333',passed=[];
function assert(value,message){if(!value)die(message);}
function done(name){push(passed,name);}
function ctx(){return cursor(root+'/config',root+'/uci');}
let original="config wifi-device 'radio0'\n option type 'mac80211'\n option band '2g'\n option channel '6'\n option htmode 'HT20'\nconfig wifi-iface 'default_radio0'\n option device 'radio0'\n option mode 'ap'\n option network 'lan'\n option ssid 'NativeFixture'\n option encryption 'psk2+tkip+ccmp'\n option key 'FixturePass123'\n";
function fixture(text){assert(!stat(root+'/state/pending.json'),'Previous task unfinished');writefile(root+'/config/wireless',text);}
function get(){return route_admin(null,'GET','wireless/config',{},owner).data;}
function apply(cfg){return route_admin(null,'POST','wireless/config',{config:cfg,confirmTimeoutSec:30},owner);}
function cancel(task,text){let r=route_admin(null,'POST','system/config-task/cancel',{taskId:task.taskId},owner);assert(r?.data?.state=='rolled_back' && readfile(root+'/config/wireless')==text,'Exact wireless rollback failed');}
fixture(original);let cfg=get();assert(cfg.cipher=='tkipaes' && cfg.mode=='11gn','Mixed cipher/GN mode misreported');done('mixed_cipher_and_actual_gn_read');
let r=apply({...cfg,ssid:'RenamedFixture'});
assert(r?.data?.taskId && ctx().get('wireless','radio0','legacy_rates')==null && ctx().get('wireless','radio0','htmode')=='HT20','SSID changed PHY');
cancel(r.data,original);done('ssid_preserves_gn_phy_exact_rollback');
for(let pair in [['11g','NOHT','0',null],['11bg','NOHT','1',null],['11n','HT20','0','n'],['11bgn','HT20','1',null]]) {
	fixture(original);r=apply({...get(),mode:pair[0]});let c=ctx();
	assert(r?.data?.taskId && c.get('wireless','radio0','htmode')==pair[1] && c.get('wireless','radio0','legacy_rates')==pair[2] && c.get('wireless','radio0','require_mode')==pair[3],pair[0]+' mode mapping failed');
	assert(get().mode==pair[0],pair[0]+' mode did not round trip');cancel(r.data,original);done('mode_'+pair[0]+'_mapping_rollback');
}
fixture(original);r=apply({...get(),mode:'11b'});assert(r?.error && readfile(root+'/config/wireless')==original,'Unverified 11B accepted');done('unverified_11b_rejected');
for(let encryption in ['wep+mixed','sae-mixed','sae','psk2+tkip+ccmp']) {
	let text=replace(original,'psk2+tkip+ccmp',encryption);fixture(text);let old=get();
	assert(encryption!='wep+mixed' || old.security=='unsupported','Unknown encryption downgraded to none');
	r=apply({...old,ssid:'RenamedFixture'});
	assert(r?.data?.taskId && ctx().get('wireless','default_radio0','encryption')==encryption,'Encryption changed during unrelated save: '+encryption);
	cancel(r.data,text);done('preserve_encryption_'+encryption);
	if(index(['sae','sae-mixed','wep+mixed'],encryption)>=0) {
		r=apply({...get(),password:'NewFixturePass'});assert(r?.error && readfile(root+'/config/wireless')==text,'Uneditable cipher password falsely accepted');done('reject_password_'+encryption);
	}
}
fixture(original);let advanced=route_admin(null,'GET','wireless/advanced',{},owner).data;
assert(advanced.supportsDtim && !advanced.supportsLegacyOptions,'Wireless capability mismatch');
r=route_admin(null,'POST','wireless/advanced',{config:{...advanced,dtim:3}},owner);
assert(r?.data?.taskId && ctx().get('wireless','default_radio0','dtim_period')=='3','DTIM did not persist');cancel(r.data,original);done('dtim_save_exact_rollback');
r=route_admin(null,'POST','wireless/advanced',{config:{...advanced,txBurst:0}},owner);assert(r?.error && readfile(root+'/config/wireless')==original,'Private TxBurst silently accepted');done('private_driver_option_rejected');
let previous={ms:1000,boot:'one',values:cpu_counters('cpu 100 20 30 400 10 5 5 0 50 10\n')};
let current={ms:2000,boot:'one',values:cpu_counters('cpu 120 20 40 470 10 5 5 0 60 10\n')};
let sample=cpu_delta(previous,current);assert(sample.cpuSampled && sample.cpuPercent==30,'CPU delta/guest accounting incorrect');done('cpu_jiffy_delta_ignores_guest_double_count');
assert(cpu_delta(null,current).cpuPercent==null && !cpu_delta(null,current).cpuSampled,'First sample fabricated');done('cpu_first_sample_unknown');
for(let invalid in [{...current,boot:'two'},{...current,ms:1100},{...current,ms:40000},{...current,values:cpu_counters('cpu 90 20 30 400 10 5 5 0\n')},{...current,values:null}])assert(!cpu_delta(previous,invalid).cpuSampled,'Invalid CPU sample accepted');done('cpu_reset_short_stale_invalid_unknown');
assert(cpu_counters('cpu 10 invalid 20 30\n')==null && cpu_counters('intr 123\n')==null,'Invalid stat accepted');done('cpu_invalid_stat_rejected');
printf('%J\n',{passed:passed,isolated_fixture:true});
