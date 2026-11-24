'use strict';
import { tick } from '/usr/share/mp716/admin-state.uc';
import { tick_system } from '/usr/share/mp716/system-admin.uc';
import { connect } from 'ubus';
import { stat } from 'fs';
import { warm_api_cache } from '/usr/share/mp716/admin.uc';

// 仅在管理页面近期有访问、且缓存将过期时预热，避免单核 CPU 每 5s 空跑 shell 采集
const UI_ACTIVE_MARK = '/tmp/mp716-ui-active';
const UI_ACTIVE_SEC = 60;
const WARM_MIN_AGE_SEC = 7;

function should_warm() {
	let mark = stat(UI_ACTIVE_MARK);
	if (!mark || time() - mark.mtime > UI_ACTIVE_SEC) return false;
	let hosts = stat('/tmp/mp716-api-cache/hosts.json');
	return !hosts || time() - hosts.mtime >= WARM_MIN_AGE_SEC;
}

tick();
tick_system();
try {
	if (should_warm()) {
		let bus = connect();
		if (bus != null) warm_api_cache(bus);
	}
} catch (e) {
}
