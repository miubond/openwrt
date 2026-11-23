'use strict';
/**
 * Phase-3 experiment: rpcd-mod-ucode plugin (persistent worker).
 * Exposes read-only methods that delegate to route_admin — same JSON shapes as CGI.
 * Enable uhttpd ubus + session ACL; do not expose write methods here.
 */
import { connect } from 'ubus';
import { route_admin } from '/usr/share/mp716/admin.uc';

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

function route_get(token, path) {
	let bus = connect();
	if (!bus || !authorized(bus, token)) return { error: 'UNAUTHORIZED', message: '会话无效或已过期' };
	let result = route_admin(bus, 'GET', path, {}, token);
	if (result?.error) return { error: result.error, message: result.message };
	if (result == null) return { error: 'NOT_IMPLEMENTED', message: '未实现' };
	return { ok: true, data: result.data, ts: time() };
}

return {
	ping: {
		call: () => ({ latencyMs: 0 }),
	},
	native_system_info: {
		args: { ubus_rpc_session: '' },
		call: (req) => route_get(req?.ubus_rpc_session, 'system/info'),
	},
	native_wireless_config: {
		args: { ubus_rpc_session: '' },
		call: (req) => route_get(req?.ubus_rpc_session, 'wireless/config'),
	},
};