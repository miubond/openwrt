'use strict';
// Post-apply check for WireGuard interfaces. Prints only interface names and
// states; never keys, endpoints or parsed UCI data.
import { connect } from 'ubus';
import { cursor } from 'uci';
import { wg_models, WG_CLIENT_IF } from '/usr/share/mp716/wireguard.uc';
import { uptime } from '/usr/share/mp716/admin-state.uc';

function check(bus,m) {
	let report={ready:true,interfaces:{}};
	for(let row in [[WG_CLIENT_IF,m.wgclient.enabled]]) {
		let s=bus.call('network.interface.'+row[0],'status',{}), up=s?.up==true;
		let state=row[1]?(up?'up':length(s?.errors || [])?'error':'pending'):(up?'still-up':'down');
		report.interfaces[row[0]]=state;
		if(state!='up' && state!='down')report.ready=false;
	}
	return report;
}

let bus=connect(), report={ready:false,error:'service-bus-unavailable'};
if(!bus){printf('%J\n',report);exit(1);}
try {
	let m=wg_models(cursor()), deadline=uptime()+12;
	while(true) {
		report=check(bus,m);
		if(report.ready || uptime()>=deadline)break;
		sleep(1000);
	}
} catch(e) {
	report={ready:false,error:'configuration-or-service-query-failed'};
}
printf('%J\n',report);
exit(report.ready?0:1);
