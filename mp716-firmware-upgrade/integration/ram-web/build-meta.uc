'use strict';
import { readfile, writefile, chmod, mkdir, stat } from 'fs';

function first_line(raw) {
	let text = raw || '';
	let n = index(text, '\n');
	return trim(n >= 0 ? substr(text, 0, n) : text);
}

function parse_build_stamp(raw) {
	let text = trim(raw || '');
	if (!length(text)) return '';
	if (match(text, /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/))
		return text;
	let iso = match(text, /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})Z$/);
	if (iso) return iso[1] + ' ' + iso[2];
	if (match(text, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/))
		return text;
	return '';
}

function format_local(unix) {
	if (type(unix) != 'int' || unix <= 0) return '';
	let t = localtime(unix);
	if (!t) return '';
	return sprintf('%04d-%02d-%02d %02d:%02d:%02d', t.year, t.mon, t.mday, t.hour, t.min, t.sec);
}

function stamp_from_mtime(path) {
	let info = stat(path);
	if (!info || type(info.mtime) != 'int' || info.mtime <= 0) return '';
	return format_local(info.mtime);
}

function stamp_from_history() {
	let last = '';
	for (let line in split(readfile('/etc/mp716-upgrade/history.log') || '', '\n')) {
		line = trim(line);
		if (!length(line)) continue;
		try {
			let row = json(line);
			if (type(row) != 'object') continue;
			let ok = row.state == 'SUCCESS' || row.upgraded == true || row.flash_write == true;
			if (ok && type(row.at) == 'int' && row.at > 0)
				last = format_local(row.at);
		} catch (e) { }
	}
	return last;
}

export function record_firmware_installed() {
	mkdir('/etc/mp716-upgrade', 0755);
	let stamp = format_local(time());
	if (!stamp) return '';
	writefile('/etc/mp716-upgrade/installed.at', stamp + '\n');
	chmod('/etc/mp716-upgrade/installed.at', 0644);
	return stamp;
};

export function firmware_version() {
	for (let path in ['/rom/etc/mp716-build.version', '/etc/mp716-build.version']) {
		let version = first_line(readfile(path) || '');
		if (match(version, /^[0-9]+\.[0-9]+\.[0-9]+$/)) return version;
	}
	for (let path in ['/rom/etc/mp716-upgrade/device.profile', '/etc/mp716-upgrade/device.profile']) {
		let m = match(readfile(path) || '', /installed_custom_firmware=([^\n]+)/);
		if (m) return m[1];
	}
	return 'unknown';
};

export function firmware_build_date() {
	try {
		let installed = parse_build_stamp(first_line(readfile('/etc/mp716-upgrade/installed.at') || ''));
		if (installed) return installed;
		let history = stamp_from_history();
		if (history) return history;
		for (let path in ['/etc/mp716-build.date', '/rom/etc/mp716-build.date', '/rom/etc/mp716-build.version', '/etc/mp716-build.version']) {
			let stamp = stamp_from_mtime(path);
			if (stamp) return stamp;
		}
		for (let path in ['/etc/mp716-build.date', '/rom/etc/mp716-build.date']) {
			let stamp = parse_build_stamp(first_line(readfile(path) || ''));
			if (stamp) return stamp;
		}
	} catch (e) { }
	return '';
};

export function webui_version() {
	for (let path in [
		'/etc/mp716-web.version',
		'/rom/etc/mp716-web.version',
		'/www/mp716/WEB_VERSION.txt',
	]) {
		let v = trim(readfile(path) || '');
		if (length(v) > 0 && length(v) < 64 && index(v, '\x00') < 0)
			return v;
	}
	return '';
};
