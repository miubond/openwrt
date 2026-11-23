'use strict';
import { readfile } from 'fs';

export function firmware_version() {
	for (let path in ['/rom/etc/mp716-build.version', '/etc/mp716-build.version']) {
		let version = trim(readfile(path) || '');
		if (match(version, /^[0-9]+\.[0-9]+\.[0-9]+$/)) return version;
	}
	for (let path in ['/rom/etc/mp716-upgrade/device.profile', '/etc/mp716-upgrade/device.profile']) {
		let m = match(readfile(path) || '', /installed_custom_firmware=([^\n]+)/);
		if (m) return m[1];
	}
	return 'unknown';
};