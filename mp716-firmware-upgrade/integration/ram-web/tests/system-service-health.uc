// Pure procd result checks. No live service call, configuration write or process.
import { system_service_health } from '../system-admin.uc';
let passed=[];
function assert(ok,name){if(!ok)die(name);push(passed,name);}
function bus(ntp,log){return {call:(object,method,args)=>args.name=='sysntpd'?ntp:log};}
let off=bus({},{}),expected={ntp:false,logging:false};
assert(system_service_health(off,expected).ready,'disabled_services_are_not_required');
let active=bus({sysntpd:{instances:{instance1:{running:true,pid:123}}}},{log:{instances:{logd:{running:true,pid:456}}}});
assert(system_service_health(active,{ntp:true,logging:true}).ready,'real_running_processes_are_ready');
let pending=bus({sysntpd:{instances:{instance1:{running:false}}}},{log:{instances:{logd:{running:true,pid:456}}}});
assert(!system_service_health(pending,{ntp:true,logging:true}).ready,'registered_but_not_running_is_not_ready');
let fake=bus({sysntpd:{instances:{instance1:{running:true,pid:0}}}},{log:{instances:{logd:{running:true,pid:456}}}});
assert(!system_service_health(fake,{ntp:true,logging:true}).ready,'running_without_real_pid_is_not_ready');
assert(!system_service_health(active,{ntp:false,logging:false}).ready,'disabled_service_still_running_is_not_ready');
let logread=bus({},{log:{instances:{logread:{running:true,pid:789}}}});
assert(!system_service_health(logread,{ntp:false,logging:true}).ready,'logread_without_logd_is_not_ready');
assert(!system_service_health(bus(null,null),expected).ready,'unavailable_service_manager_is_not_reported_ready');
printf('%J\n',{passed:passed,fixture_only:true,service_commands:false});
