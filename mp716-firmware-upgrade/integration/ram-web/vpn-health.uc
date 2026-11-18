'use strict';
import { connect } from 'ubus';
import { cursor } from 'uci';
import { read_models } from '/usr/share/mp716/vpn-runtime.uc';
import { vpn_service_health } from '/usr/share/mp716/vpn-services.uc';
import { uptime } from '/usr/share/mp716/admin-state.uc';

let bus=connect(), report={ready:false,error:'service-bus-unavailable'};
if(!bus){printf('%J\n',report);exit(1);}
try {
	let m=read_models(cursor()), deadline=uptime()+15;
	while(true) {
		report=vpn_service_health(bus,m);
		if(report.ready){printf('%J\n',report);exit(0);}
		if(uptime()>=deadline)break;
		sleep(1000);
	}
} catch(e) {
	// Do not echo parsed UCI data or exceptions that might include credentials.
	report={ready:false,error:'configuration-or-service-query-failed'};
}
printf('%J\n',report);
exit(1);
