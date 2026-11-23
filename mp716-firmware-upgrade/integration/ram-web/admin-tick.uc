'use strict';
import { tick } from '/usr/share/mp716/admin-state.uc';
import { tick_system } from '/usr/share/mp716/system-admin.uc';
import { connect } from 'ubus';
import { warm_api_cache } from '/usr/share/mp716/admin.uc';

tick();
tick_system();
try {
	let bus = connect();
	if (bus != null) warm_api_cache(bus);
} catch (e) {
}