'use strict';
/**
 * MP716 固件刷写策略：development | laboratory | production
 * 禁止仅靠前端或 allow-flash-upgrade 冒充生产可刷。
 */
import { readfile, stat } from 'fs';

const POLICIES = ['development', 'laboratory', 'production'];

function trim_file(path) {
	let raw = readfile(path);
	return raw ? trim(raw) : '';
}

export function upgrade_policy() {
	let raw = lc(trim_file('/etc/mp716-upgrade/upgrade-policy'));
	if (index(POLICIES, raw) < 0)
		return 'development';
	return raw;
};

export function flash_gate_confirmed() {
	return trim_file('/etc/mp716-upgrade/flash-gate') == 'serial-recovery-verified' &&
		trim_file('/etc/mp716-upgrade/platform') == 'confirmed';
};

export function firmware_verifier_present() {
	return !!(stat('/usr/sbin/mp716-upgraded') || stat('/usr/sbin/mp716-package-verify'));
};

export function firmware_flash_allowed() {
	if (!firmware_verifier_present())
		return false;
	let policy = upgrade_policy();
	if (policy == 'production')
		return flash_gate_confirmed();
	if (policy == 'laboratory')
		return !!stat('/etc/mp716/allow-flash-upgrade') || flash_gate_confirmed();
	/* development：仅显式实验室开关 */
	return !!stat('/etc/mp716/allow-flash-upgrade');
};

export function firmware_policy_payload() {
	let policy = upgrade_policy();
	let flash = firmware_flash_allowed();
	return {
		upgradePolicy: policy,
		flashUpgradeEnabled: flash,
		validationOnly: firmware_verifier_present() && !flash,
		hardwareValidated: flash_gate_confirmed(),
		productionFlashReady: policy == 'production' && flash_gate_confirmed(),
	};
};