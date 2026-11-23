// Run only through the isolated native harness. Every system/service command is
// replaced there, including date -s, passwd, firstboot and reboot. Do not run
// this file against installed modules or real /etc/config.
import { route_system, validate_time, validate_schedule, validate_browser_time,
	validate_password_change, parse_localtime, tick_system, schedule_due } from '../system-admin.uc';
import { get_task } from '../admin-state.uc';
import { cursor } from 'uci';
import { readfile, writefile, mkdir, chmod, unlink } from 'fs';

let root=getenv('MP716_SYSTEM_FIXTURE') || getenv('MP716_ADVANCED_FIXTURE');
function assert(ok,message) {if(!ok)die(message);}
assert(match(root || '',/^\/tmp\/mp716-[A-Za-z0-9.-]+\/fixture$/),'Expected isolated system fixture');
let module=readfile(root+'/system-admin.uc') || '', state=readfile(root+'/admin-state.uc') || '';
assert(index(module,root+'/config/')>=0 && index(module,"'/etc/config/'")<0,'System module was not redirected to the fixture');
assert(index(module,root+'/vpn/')>=0 && index(module,"'/etc/mp716-vpn/'")<0,'VPN paths were not redirected to the fixture');
assert(index(state,'MP716_TEST_COMMAND_STUB')>=0,'Refusing to run without the command stub');
let owner='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', passed=[];
function rejects(name,fn) {let failed=false;try{fn();}catch(e){failed=true;}assert(failed,name);push(passed,name);}
function success(name) {push(passed,name);}

assert(validate_browser_time('2028-02-29 23:59:59')=='2028-02-29 23:59:59','Valid leap date rejected');success('browser_clock_valid_leap_day');
rejects('browser_clock_non_leap_day',()=>validate_browser_time('2027-02-29 12:00:00'));
rejects('browser_clock_day_zero',()=>validate_browser_time('2026-11-00 12:00:00'));
rejects('browser_clock_april_31',()=>validate_browser_time('2026-04-31 12:00:00'));
rejects('browser_clock_shell_injection',()=>validate_browser_time("2026-11-18 12:00:00'; reboot"));
assert(parse_localtime('2026 11 18 3 12 34 56\n').wday==3,'ISO weekday mapping failed');success('device_clock_iso_weekday');
rejects('device_clock_malformed_output',()=>parse_localtime('2026 11 18 Wed 12 34 56'));
rejects('countdown_below_page_minimum',()=>validate_schedule({mode:1,remainHour:0,remainMinute:9,hour:0,minute:0,weeks:0}));
assert(validate_schedule({mode:1,remainHour:0,remainMinute:10,hour:0,minute:0,weeks:0}).remainMinute==10,'Ten minute countdown rejected');success('countdown_page_minimum_accepted');
rejects('week_mask_unknown_bit',()=>validate_schedule({mode:2,remainHour:0,remainMinute:30,hour:0,minute:0,weeks:129}));
assert(validate_schedule({mode:2,remainHour:0,remainMinute:30,hour:0,minute:0,weeks:255}).weeks==255,'All-days mask rejected');success('all_weekdays_page_mask');
assert(validate_password_change({oldPassword:'oldsecret',newPassword:'abcde'}).newPassword=='abcde','Page-compatible password rejected');success('password_page_length_contract');
rejects('password_below_page_minimum',()=>validate_password_change({oldPassword:'oldsecret',newPassword:'tiny'}));
rejects('password_above_page_maximum',()=>validate_password_change({oldPassword:'oldsecret',newPassword:'123456789012345678901234567890123'}));
rejects('password_unchanged',()=>validate_password_change({oldPassword:'same-secret',newPassword:'same-secret'}));
rejects('invalid_numeric_ntp_address',()=>validate_time({timezone:'CST-8',ntpEnabled:true,ntpServers:['999.1.1.1']}));
let original_for_ntp=readfile(root+'/config/system');
writefile(root+'/config/system',"config system\n option timezone 'UTC'\n");
assert(route_system(null,'GET','system/time',{},owner)?.data?.ntpEnabled==false,'Absent timeserver section was falsely reported enabled');success('absent_ntp_section_is_disabled');
writefile(root+'/config/system',original_for_ntp);
let weekly={mode:'2',hour:'12',minute:'34',weeks:'8'};
let wednesday={year:2026,mon:11,mday:18,wday:3,hour:12,min:34,sec:56};
let decision=schedule_due(weekly,'boot',100,1800000000,wednesday);
assert(decision.fire && decision.stamp=='2026-11-18 12:34','Wednesday schedule did not trigger');
assert(!schedule_due({...weekly,last:decision.stamp},'boot',105,1800000005,wednesday).fire,'Weekly schedule repeated in the same minute');success('weekly_weekday_and_duplicate_guard');
assert(!schedule_due(weekly,'boot',100,100,wednesday).fire,'Weekly schedule triggered before clock synchronization');success('weekly_requires_initialized_clock');
assert(!schedule_due({mode:'1',boot:'old',deadline:'1'},'new',100,1800000000,null).fire,'Countdown reused previous boot deadline');success('countdown_bound_to_boot');

let before_system=readfile(root+'/config/system'), before_custom=readfile(root+'/config/mp716_system');
let r=route_system(null,'POST','system/time',{config:{timezone:'CST-8',ntpEnabled:true,ntpServers:['one.example.org','','three.example.org']}},owner);
assert(r?.data?.taskId,'NTP slot save failed');
let time_config=route_system(null,'GET','system/time',{},owner)?.data;
assert(sprintf('%J',time_config.ntpServers)==sprintf('%J',['one.example.org','','three.example.org']),'NTP empty slot position was lost');
get_task(r.data.taskId,owner,'cancel');assert(readfile(root+'/config/system')==before_system,'NTP slots rollback changed original configuration');success('ntp_empty_slot_round_trip_and_rollback');
r=route_system(null,'POST','system/logs',{enabled:false},owner);
assert(r?.data?.taskId,'Log toggle did not create a task');
assert(route_system(null,'GET','system/logs',{},owner)?.data?.enabled==false,'Log toggle GET mismatch');
get_task(r.data.taskId,owner,'cancel');
assert(readfile(root+'/config/mp716_system')==before_custom,'Log toggle rollback changed original configuration');success('log_toggle_exact_rollback');

mkdir(root+'/vpn',0700);writefile(root+'/vpn/ca.pem','fixture-ca-original\n');chmod(root+'/vpn/ca.pem',0600);
let exported=route_system(null,'POST','system/backup/download',{},owner)?.data;
assert(exported?.contentBase64,'Native backup download failed');
let document=json(b64dec(exported.contentBase64));
assert(document.vpnFiles?.['ca.pem']?.contentBase64==b64enc('fixture-ca-original\n'),'Backup omitted CA file');
assert(document.vpnFiles?.['client.key']==null,'Backup did not record absent private key');success('backup_includes_vpn_files_and_absence');
let malicious=json(sprintf('%J',document));
malicious.vpnFiles['client.ovpn']={mode:0600,contentBase64:b64enc('client\nup /bin/reboot\n')};
r=route_system(null,'POST','system/restore',{backup:malicious},owner);
assert(r?.error,'Backup bypassed OpenVPN upload directive validation');success('backup_cannot_inject_openvpn_script');
malicious=json(sprintf('%J',document));malicious.vpnFiles['../shadow']={mode:0600,contentBase64:b64enc('bad')};
r=route_system(null,'POST','system/restore',{backup:malicious},owner);
assert(r?.error,'Unknown VPN backup path accepted');success('backup_vpn_path_allowlist');

writefile(root+'/vpn/ca.pem','fixture-ca-replaced\n');
writefile(root+'/vpn/client.key','fixture-new-key\n');chmod(root+'/vpn/client.key',0600);
r=route_system(null,'POST','system/restore',{backup:document},owner);
assert(r?.data?.taskId,'VPN native restore failed: '+sprintf('%J',r));
assert(readfile(root+'/vpn/ca.pem')=='fixture-ca-original\n' && readfile(root+'/vpn/client.key')==null,'VPN restore did not reproduce backup files');
get_task(r.data.taskId,owner,'cancel');
assert(readfile(root+'/vpn/ca.pem')=='fixture-ca-replaced\n' && readfile(root+'/vpn/client.key')=='fixture-new-key\n','VPN rollback did not restore current files');success('vpn_backup_restore_and_rollback');

if(index(document.absentConfigs,'mp716_system')>=0) {
	writefile(root+'/config/mp716_system',"config settings 'main'\n option logging '0'\n");chmod(root+'/config/mp716_system',0600);
	let custom=readfile(root+'/config/mp716_system');
	r=route_system(null,'POST','system/restore',{backup:document},owner);
	assert(r?.data?.taskId && readfile(root+'/config/mp716_system')==null,'Restore did not remove package recorded as absent');
	get_task(r.data.taskId,owner,'cancel');assert(readfile(root+'/config/mp716_system')==custom,'Rollback lost the current custom package');
	unlink(root+'/config/mp716_system');success('backup_absent_packages_round_trip');
}

let c=cursor(root+'/config',root+'/uci');
if(!c.get('mp716_system','schedule')) {
	writefile(root+'/config/mp716_system',"config schedule 'schedule'\n option mode '1'\n option remainHour '0'\n option remainMinute '10'\n option hour '0'\n option minute '0'\n option weeks '0'\n");c.load('mp716_system');
}
c.set('mp716_system','schedule','boot',trim(readfile('/proc/sys/kernel/random/boot_id')||''));
c.set('mp716_system','schedule','deadline','1');assert(c.commit('mp716_system'),'Unable to prepare isolated timer');
// The required stub records reboot instead of executing it.
tick_system();c=cursor(root+'/config',root+'/uci');assert(c.get('mp716_system','schedule','mode')=='0','Elapsed countdown was not disarmed before reboot request');success('countdown_disarmed_before_reboot');
c.set('mp716_system','schedule','mode','1');c.set('mp716_system','schedule','boot','previous-boot');c.commit('mp716_system');
assert(route_system(null,'GET','system/sche-reboot',{},owner)?.data?.mode==0,'Old boot deadline was shown as active');success('stale_countdown_not_active_after_reboot');
if(before_custom==null)unlink(root+'/config/mp716_system');else writefile(root+'/config/mp716_system',before_custom);
assert(readfile(root+'/config/system')==before_system,'System fixture baseline changed');
printf('%J\n',{passed:passed,fixture_only:true,services_stubbed:true});
