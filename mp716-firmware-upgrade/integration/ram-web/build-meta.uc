'use strict';
import { readfile, stat } from 'fs';

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

function stamp_from_mtime(path) {
	let info = stat(path);
	if (!info || type(info.mtime) != 'int' || info.mtime <= 0) return '';
	let t = gmtime(info.mtime);
	if (!t) return '';
	return sprintf('%04d-%02d-%02d %02d:%02d:%02d', t.year, t.mon, t.mday, t.hour, t.min, t.sec);
}

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
		for (let path in ['/etc/mp716-build.date', '/rom/etc/mp716-build.date']) {
			let stamp = parse_build_stamp(first_line(readfile(path) || ''));
			if (stamp) return stamp;
		}
		for (let path in ['/etc/mp716-build.version', '/rom/etc/mp716-build.version']) {
			for (let line in split(readfile(path) || '', '\n')) {
				let row = trim(line);
				if (index(lc(row), 'build=') != 0 && index(lc(row), 'build:') != 0)
					continue;
				let stamp = parse_build_stamp(trim(substr(row, 6)));
				if (stamp) return stamp;
			}
		}
		for (let path in ['/rom/etc/mp716-build.date', '/rom/etc/mp716-build.version', '/etc/mp716-build.version']) {
			let stamp = stamp_from_mtime(path);
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
