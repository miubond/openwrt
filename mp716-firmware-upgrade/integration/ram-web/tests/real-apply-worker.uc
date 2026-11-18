// REAL child-process/timeout/IPC validation with FAKE service commands only.
// The host MUST replace every reload command with private service.sh, rewrite
// every configuration/state path, copy apply-task.uc and add the marker below.
import { begin, applied, pending, get_task, store, uptime, acquire, release, command } from '../admin-state.uc';
import { readfile, writefile } from 'fs';
let root=getenv('MP716_REAL_SERVICE_FIXTURE') || getenv('MP716_ADVANCED_FIXTURE');
function assert(ok,message){if(!ok)die(message);}
assert(match(root || '',/^\/tmp\/mp716-[A-Za-z0-9.-]+\/fixture$/),'Expected isolated real-worker fixture');
let source=readfile(root+'/admin-state.uc') || '';
assert(index(source,'MP716_REAL_SERVICE_TEST')>=0 && index(source,root+'/config/')>=0,'Refusing an unisolated real worker');
for(let unsafe in ['/bin/ubus call network reload','/sbin/wifi reload','/etc/init.d/dnsmasq reload','/etc/init.d/mp716-vpn reload','/etc/init.d/firewall reload'])
	assert(index(source,unsafe)<0,'Real device service remained in test module');
assert(index(source,root+'/service.sh')>=0 && index(source,'MP716_TEST_COMMAND_STUB')<0,'Expected real command/launcher and private service only');
let owner='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',other='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',passed=[];
let original="config system\n option timezone 'UTC'\n";
function lock(){let deadline=uptime()+8;while(!acquire()){if(uptime()>=deadline)die('Timed out waiting for test request lock');command('/bin/busybox sleep 1');}}
function task(id,action,token){lock();let result;try{result=get_task(id,token || owner,action);}catch(e){release();die(e);}release();return result;}
function prepare(codes){
	assert(!pending(),'Previous real worker task remains');
	writefile(root+'/service-codes',join('\n',map(codes,(n)=>sprintf('%d',n)))+'\n');
	writefile(root+'/config/system',original);
	lock();let result;
	try {
		let t=begin(owner,['system'],'system',90);
		writefile(root+'/config/system',"config system\n option timezone 'CST-8'\n");
		result=applied(t);
	}catch(e){release();die(e);}
	release();return result;
}
function wait_for(id,phase,terminal){
	let deadline=uptime()+20;
	while(uptime()<deadline) {
		let result=task(id,null);
		if(terminal?result.state!='pending':result.phase==phase)return result;
		if(!terminal && result.state!='pending')die('Worker terminated unexpectedly: '+sprintf('%J',result));
		command('/bin/busybox sleep 1');
	}
	die('Timed out waiting for real worker: '+sprintf('%J',task(id,null)));
}
function rejected(name,fn){let failed=false;try{fn();}catch(e){failed=true;}assert(failed,name);push(passed,name);}
let t=prepare([0]);
rejected('real_early_confirm_blocked',()=>task(t.taskId,'confirm'));
assert(wait_for(t.taskId,'applied',false).phase=='applied','Real worker never became ready');
assert(task(t.taskId,'confirm').state=='confirmed'&&!pending(),'Real applied task did not confirm');push(passed,'real_apply_child_completes_before_confirmation');

t=prepare([1,0]);let result=wait_for(t.taskId,null,true);
assert(result.state=='rolled_back' && length(result.applyError)>0,'Real nonzero exit did not trigger rollback: '+sprintf('%J',result));
assert(readfile(root+'/config/system')==original,'Real apply failure did not restore exact configuration');push(passed,'real_apply_failure_restores_configuration_and_services');

t=prepare([1,1]);result=wait_for(t.taskId,null,true);
assert(result.state=='failed' && length(result.rollbackError)>0 && pending()?.files?.system==original,'Real failed rollback lost its recovery snapshot');
rejected('real_failed_rollback_blocks_new_task',()=>begin(owner,['system'],'system',90));
rejected('real_other_session_cannot_retry',()=>task(t.taskId,'cancel',other));
writefile(root+'/service-codes','0\n');
result=task(t.taskId,'cancel');assert(result.state=='pending'&&result.phase=='rolling_back','Rollback retry was falsely reported complete');
result=wait_for(t.taskId,null,true);
assert(result.state=='rolled_back'&&!pending()&&readfile(root+'/config/system')==original,'Real rollback retry did not restore the original state');push(passed,'real_failed_rollback_can_retry_and_finish');
writefile(root+'/config/system',original);
printf('%J\n',{passed:passed,fixture_only:true,real_worker_processes:true,production_services_called:false});
