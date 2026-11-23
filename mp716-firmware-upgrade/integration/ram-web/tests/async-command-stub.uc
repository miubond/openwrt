// Test-only command implementation for apply-task-settings.uc. Never installed.
// The host harness substitutes this export for admin-state.command().
import { readfile, writefile } from 'fs';
export function test_command(text) {
	let root=getenv('MP716_ASYNC_FIXTURE') || getenv('MP716_ADVANCED_FIXTURE');
	if(!match(root || '',/^\/tmp\/mp716-[A-Za-z0-9.-]+\/fixture$/))die('Expected isolated asynchronous fixture');
	if(index(text,'apply-task.uc ')>=0 && index(text,'/bin/busybox timeout')<0)return {code:0,output:'999999\n'};
	if(index(text,'/bin/busybox timeout -s KILL 25 ')==0) {
		let control=json(readfile(root+'/service-control.json') || '{}');
		control.calls=(control.calls || 0)+1;
		let code=length(control.codes || [])?shift(control.codes):0;
		if(control.cancelAt==control.calls) {
			let path=root+'/state/pending.json',t=json(readfile(path));
			t.cancelRequested=true;writefile(path,sprintf('%J',t));
		}
		writefile(root+'/service-control.json',sprintf('%J',control));
		return {code:code,output:code?'private fixture service detail':''};
	}
	return {code:0,output:''};
};
