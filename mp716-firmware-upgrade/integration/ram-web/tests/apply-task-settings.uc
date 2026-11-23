// Run only after redirecting configuration and state paths to the private fixture,
// copying apply-task.uc, and replacing command() with async-command-stub.uc.
import { begin, applied, pending, get_task, run_worker, expire, store, uptime } from '../admin-state.uc';
import { readfile, writefile } from 'fs';
let root=getenv('MP716_ASYNC_FIXTURE') || getenv('MP716_ADVANCED_FIXTURE');
function assert(ok,message){if(!ok)die(message);}
assert(match(root || '',/^\/tmp\/mp716-[A-Za-z0-9.-]+\/fixture$/),'Expected isolated asynchronous fixture');
let source=readfile(root+'/admin-state.uc') || '';
assert(index(source,root+'/config/')>=0 && index(source,'MP716_TEST_COMMAND_STUB')>=0,'Refusing unisolated state module');
let owner='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', other='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',passed=[];
let original="config system\n option timezone 'UTC'\n";
function control(codes,cancelAt){store(root+'/service-control.json',{codes:codes || [],cancelAt:cancelAt || 0,calls:0});}
function prepare(codes,cancelAt){
	assert(!pending(),'Previous asynchronous task remains');
	writefile(root+'/config/system',original);control(codes,cancelAt);
	let t=begin(owner,['system'],'system',90);
	writefile(root+'/config/system',"config system\n option timezone 'CST-8'\n");
	let result=applied(t);assert(result.phase=='applying','Save did not expose applying phase');return result;
}
function rejected(name,fn){let failed=false;try{fn();}catch(e){failed=true;}assert(failed,name);push(passed,name);}
function restored(){assert(readfile(root+'/config/system')==original,'Original configuration not restored exactly');}
let t=prepare([]);
rejected('confirm_blocked_before_service_apply',()=>get_task(t.taskId,owner,'confirm'));
assert(run_worker(t.taskId),'Apply worker failed');
assert(get_task(t.taskId,owner,null).phase=='applied','Successful service apply not recorded');
assert(get_task(t.taskId,owner,'confirm').state=='confirmed'&&!pending(),'Confirmation did not close successful task');push(passed,'confirm_requires_successful_service_apply');

t=prepare([1,0]);run_worker(t.taskId);
let status=get_task(t.taskId,owner,null);restored();
assert(status.state=='rolled_back' && length(status.applyError)>0 && index(sprintf('%J',status),'private fixture')<0,
	'Apply failure was reported as success or leaked output: '+sprintf('%J',{status:status,control:json(readfile(root+'/service-control.json')||'{}'),pendingPhase:pending()?.phase}));push(passed,'apply_failure_restores_files_and_service');

t=prepare([1,2]);assert(!run_worker(t.taskId),'Failed rollback reported success');restored();
status=get_task(t.taskId,owner,null);
assert(status.state=='failed' && length(status.rollbackError)>0 && pending()?.files?.system==original,'Failed restoration lost the recovery snapshot');
rejected('failed_restore_blocks_new_configuration',()=>begin(owner,['system'],'system',90));
control([0]);status=get_task(t.taskId,owner,'cancel');assert(status.phase=='rolling_back' && status.state=='pending','Retry did not enter asynchronous restoration');
run_worker(t.taskId);assert(get_task(t.taskId,owner,null).state=='rolled_back'&&!pending(),'Explicit rollback retry did not finish');push(passed,'failed_restore_retains_snapshot_and_can_retry');

t=prepare([0]);let stale=pending().workerToken;
status=get_task(t.taskId,owner,'cancel');restored();
assert(status.phase=='rolling_back' && status.state=='pending','Cancellation falsely claimed services already restored');
assert(!run_worker(t.taskId,stale),'Superseded worker generation was executed');
assert(get_task(t.taskId,owner,null).phase=='rolling_back','Stale worker changed task state');
run_worker(t.taskId);assert(get_task(t.taskId,owner,null).state=='rolled_back','Cancellation worker failed');push(passed,'cancel_waits_for_service_restore_and_fences_stale_worker');

t=prepare([0,0],1);run_worker(t.taskId);restored();
assert(get_task(t.taskId,owner,null).state=='rolled_back','Cancellation during service apply was lost');push(passed,'inflight_apply_cancellation_restores_after_apply_finishes');

t=prepare([0]);let p=pending();p.deadline=uptime()-1;store(root+'/state/pending.json',p);expire();
assert(pending().phase=='rolling_back','Expired task did not begin restoration');run_worker(t.taskId);restored();push(passed,'deadline_expiry_restores_without_confirmation');

t=prepare([0]);p=pending();p.boot='previous-boot';store(root+'/state/pending.json',p);expire();
assert(pending().phase=='rolling_back','Prior-boot pending task was retained');run_worker(t.taskId);restored();push(passed,'previous_boot_pending_configuration_restored');

t=prepare([0]);p=pending();p.worker={pid:999999,started:'missing'};p.workerQueuedAt=uptime()-11;store(root+'/state/pending.json',p);expire();
assert(pending().phase=='rolling_back','Dead apply worker was ignored');run_worker(t.taskId);restored();push(passed,'dead_worker_triggers_recovery');

t=prepare([]);rejected('other_session_cannot_confirm',()=>get_task(t.taskId,other,'confirm'));
rejected('other_session_cannot_cancel',()=>get_task(t.taskId,other,'cancel'));
get_task(t.taskId,owner,'cancel');run_worker(t.taskId);restored();
writefile(root+'/config/system',original);
printf('%J\n',{passed:passed,fixture_only:true,service_commands_stubbed:true});
