'use strict';
import { route_admin } from '/usr/share/mp716/admin.uc';
import { route_system } from '/usr/share/mp716/system-admin.uc';
import { route_vpn } from '/usr/share/mp716/vpn.uc';
import { route_diagnostics } from '/usr/share/mp716/diagnostics.uc';
import { route_firewall } from '/usr/share/mp716/firewall-admin.uc';
import { route_network_services } from '/usr/share/mp716/network-services.uc';
import { route_network_routes } from '/usr/share/mp716/network-routes.uc';
import { route_network_qos } from '/usr/share/mp716/network-qos.uc';

function handler_chain(path) {
	if (match(path, /^vpn\//)) return [route_vpn, route_admin];
	if (match(path, /^tools\//)) return [route_diagnostics, route_admin];
	if (match(path, /^firewall\//)) return [route_firewall, route_admin];
	if (path == 'network/ddns' || path == 'network/upnp' || path == 'network/cellular')
		return [route_network_services, route_admin];
	if (path == 'network/qos/capability' || path == 'network/qos/config')
		return [route_network_qos, route_admin];
	if (path == 'network/static-routes')
		return [route_network_routes, route_admin];
	if (match(path, /^system\//) || match(path, /^wizard\//))
		return [route_system, route_admin];
	if (match(path, /^(home|hosts|network|wireless)\//))
		return [route_admin];
	return [route_system, route_vpn, route_diagnostics, route_firewall, route_network_services, route_network_qos, route_network_routes, route_admin];
}

export function route_native(bus, method, path, body, owner) {
	for (let handler in handler_chain(path)) {
		let result = handler(bus, method, path, body, owner);
		if (result != null) return result;
	}
	return null;
};