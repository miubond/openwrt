'use strict';
/**
 * Experiment: rpcd-mod-ucode plugin reusing wireguard.uc directly (no CGI code path).
 * Read-only and masked; writes must keep going through route_vpn so the config-task
 * lock, confirm and rollback apply. Client-only product scope.
 */
import { connect } from 'ubus';
import { cursor } from 'uci';
import { wg_models, wg_service_info, client_view, wg_status, wg_context, wg_reserved_list } from '/usr/share/mp716/wireguard.uc';

function authorized(bus, token) {
	if (!match(token || '', /^[0-9a-f]{32}$/)) return false;
	let access = bus.call('session', 'access', {
		ubus_rpc_session: token,
		scope: 'ubus',
		object: 'mp716',
		function: '*',
	});
	return access?.access == true;
}

function with_models(token, fn) {
	let bus = connect();
	if (!bus || !authorized(bus, token)) return { error: 'UNAUTHORIZED', message: '会话无效或已过期' };
	try {
		let wg = wg_models(cursor());
		return { ok: true, data: fn(bus, wg), ts: time() };
	} catch (e) {
		return { error: 'INTERNAL', message: e.message };
	}
}

return {
	mp716_wireguard_client: {
		args: { ubus_rpc_session: '' },
		call: (req) => with_models(req?.ubus_rpc_session, (bus, wg) => {
			let view = wg_service_info(client_view(wg.wgclient));
			view.reservedNets = wg_reserved_list(wg_context(cursor(), bus, { wg: wg }, 'wgclient'));
			return view;
		}),
	},
	mp716_wireguard_status: {
		args: { ubus_rpc_session: '' },
		call: (req) => with_models(req?.ubus_rpc_session, (bus, wg) => wg_status(bus, wg)),
	},
};