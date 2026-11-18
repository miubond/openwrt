'use strict';
import { route_admin } from '/usr/share/mp716/admin.uc';
import { route_system } from '/usr/share/mp716/system-admin.uc';
import { route_vpn } from '/usr/share/mp716/vpn.uc';
import { route_diagnostics } from '/usr/share/mp716/diagnostics.uc';

export function route_native(bus, method, path, body, owner) {
	// Specific handlers precede legacy read-only fallbacks such as system/logs.
	for (let handler in [route_system, route_vpn, route_diagnostics, route_admin]) {
		let result = handler(bus,method,path,body,owner);
		if (result != null) return result;
	}
	return null;
};
