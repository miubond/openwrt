#!/usr/bin/env ucode
'use strict';
import { popen } from 'fs';
import { record_firmware_installed } from '/usr/share/mp716/build-meta.uc';
import { job_mark_boot_confirmed, job_cleanup } from '/usr/share/mp716/firmware-job.uc';

function device_state_name() {
	let child = popen('grep -E "^state=" /etc/mp716-upgrade/state 2>/dev/null | head -1', 'r');
	if (!child) return '';
	let line = trim(child.read('all') || '');
	child.close();
	let m = match(line, /^state=([A-Z_]+)/);
	return m ? m[1] : '';
}

let st = device_state_name();
if (st == 'SUCCESS') {
	record_firmware_installed();
	job_mark_boot_confirmed();
} else if (st == 'FAILED') {
	job_cleanup('');
}
