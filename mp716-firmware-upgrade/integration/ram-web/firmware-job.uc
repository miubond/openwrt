'use strict';
/**
 * 两阶段固件任务：落盘 /tmp（不写 overlay），验签后返回 job_id；apply 仅在刷写门开启时异步提交。
 * 对外状态：UPLOADING | VERIFIED | SUBMITTED | APPLYING | REBOOTING | BOOT_CONFIRMED | FAILED | UNKNOWN
 */
import { popen, stdin, writefile, unlink, chmod, stat, readfile, mkdir, open, rename, glob } from 'fs';

export const FIRMWARE_MAX_BYTES = 8060928;
export const STREAM_CHUNK = 65536;
const JOB_ROOT = '/tmp/mp716-upgrade';
const JOB_DIR = JOB_ROOT + '/jobs';
const JOB_LOCK = JOB_ROOT + '/jobs.lock';
const ACTIVE_JOB = JOB_ROOT + '/active-job.json';
const APPLY_RESULT = JOB_ROOT + '/apply-result.json';
/** 仅验签落盘（与 VERIFY_RESERVE 2MiB 对齐，避免 64MB 机在常态内存下无法上传）；apply 分支只以它防 OOM */
const MEM_VERIFY_EXTRA_KB = 2 * 1024;
const TMP_MIN_EXTRA_KB = 512;
const VERIFIED_TTL = 30 * 60;

function shellquote(v) {
	return "'" + replace(v, "'", "'\\''") + "'";
}

function upper_state(name) {
	name = lc(trim(name || ''));
	if (name == 'uploading') return 'UPLOADING';
	if (name == 'verified') return 'VERIFIED';
	if (name == 'submitted') return 'SUBMITTED';
	if (name == 'applying') return 'APPLYING';
	if (name == 'rebooting') return 'REBOOTING';
	if (name == 'boot_confirmed') return 'BOOT_CONFIRMED';
	if (name == 'failed') return 'FAILED';
	return 'UNKNOWN';
}

export function job_public_phase(phase, device_state) {
	/* 设备 state 记录的是上一次刷写；正在刷写/已提交的任务以其自身 phase 为准，避免旧 SUCCESS 误报 BOOT_CONFIRMED */
	if (index(['submitted', 'applying'], phase || '') >= 0)
		return upper_state(phase);
	if (index(['', 'rebooting'], phase || '') < 0)
		return upper_state(phase);
	if (device_state == 'SUCCESS') return 'BOOT_CONFIRMED';
	if (device_state == 'FAILED') return 'FAILED';
	if (index(['REBOOT_REQUIRED', 'BOOT_VERIFYING'], device_state) >= 0) return 'REBOOTING';
	return upper_state(phase);
};

function device_failure_message() {
	let raw = readfile('/etc/mp716-upgrade/state') || '';
	let error = '', expected = '';
	for (let line in split(raw, '\n')) {
		let m = match(line, /^error=(.*)$/);
		if (m) error = m[1];
		m = match(line, /^expected_custom_firmware=(.*)$/);
		if (m) expected = m[1];
	}
	if (error == 'version')
		return '上次升级未生效：新镜像启动后的版本与升级包不符' +
			(length(expected) ? '（升级包 ' + expected + '）' : '') + '，设备继续运行当前版本';
	return '上次升级未生效' + (length(error) ? '（' + error + '）' : '') + '，设备继续运行当前版本';
}

export function firmware_boot_result() {
	let raw = readfile('/etc/mp716-upgrade/state') || '';
	let result = {};
	for (let line in split(raw, '\n')) {
		let m = match(line, /^(state|expected_custom_firmware)=(.*)$/);
		if (m) result[m[1]] = m[2];
	}
	return { state: result.state || '', expectedVersion: result.expected_custom_firmware || '' };
};

function mem_available_kb() {
	let child = popen('awk \'/^MemAvailable:/ {print $2}\' /proc/meminfo 2>/dev/null', 'r');
	if (!child) return 0;
	let kb = int(trim(child.read('all') || '0'));
	child.close();
	return kb > 0 ? kb : 0;
}

function tmp_free_kb() {
	let child = popen('df -k /tmp 2>/dev/null | awk \'NR==2 {print $4}\'', 'r');
	if (!child) return 0;
	let kb = int(trim(child.read('all') || '0'));
	child.close();
	return kb > 0 ? kb : 0;
}

export function firmware_capacity_check(file_bytes, phase) {
	phase = lc(trim(phase || 'upload'));
	let mem = mem_available_kb();
	let tmp = tmp_free_kb();
	let need_mem;
	if (phase == 'apply') {
		/* 容器已在 /tmp；HTTP 层仅防 OOM。完整 payload+8MiB 预算由 mp716-sysupgrade 停服后判定。 */
		need_mem = MEM_VERIFY_EXTRA_KB;
	} else {
		let mem_extra = MEM_VERIFY_EXTRA_KB;
		need_mem = int((file_bytes + 1023) / 1024) + mem_extra;
	}
	let need_tmp = int((file_bytes + 1023) / 1024) + TMP_MIN_EXTRA_KB;
	if (file_bytes <= 0 || file_bytes > FIRMWARE_MAX_BYTES)
		return { ok: false, code: 'VALIDATION', message: '固件文件不能超过 8M', memAvailableKb: mem, tmpFreeKb: tmp };
	if (tmp < need_tmp)
		return { ok: false, code: 'LOW_TMP', message: 'tmpfs 空间不足', needTmpKb: need_tmp, tmpFreeKb: tmp, memAvailableKb: mem };
	if (mem < need_mem)
		return { ok: false, code: 'LOW_MEMORY', message: '系统可用内存不足', needMemKb: need_mem, memAvailableKb: mem, tmpFreeKb: tmp };
	return { ok: true, memAvailableKb: mem, tmpFreeKb: tmp, needMemKb: need_mem, needTmpKb: need_tmp, phase: phase };
};

function ensure_dirs() {
	mkdir(JOB_ROOT, 0700);
	mkdir(JOB_DIR, 0700);
}

function new_job_id() {
	let child = popen('hexdump -n 8 -e \'1/1 "%02x"\' /dev/urandom 2>/dev/null', 'r');
	let hex = child ? trim(child.read('all') || '') : '';
	child?.close();
	if (!match(hex, /^[0-9a-f]{16}$/))
		hex = sprintf('%016x', time());
	return hex;
}

function job_meta_path(id) {
	return JOB_DIR + '/' + id + '.json';
}

function job_image_path(id) {
	return JOB_DIR + '/' + id + '.mp716upd';
}

function load_json(path) {
	try {
		return json(readfile(path) || '{}');
	} catch (e) {
		return null;
	}
}

function store_job(job) {
	store_json(job_meta_path(job.job_id), job);
	store_json(ACTIVE_JOB, { job_id: job.job_id, updated: time() });
}

function store_json(path, row) {
	let temporary = path + '.new';
	if (writefile(temporary, sprintf('%J\n', row)) == null ||
	    !chmod(temporary, 0600) || !rename(temporary, path)) {
		unlink(temporary);
		die('无法保存固件任务');
	}
}

/* mp716-sysupgrade 在 CGI 返回 submitted 之后才失败，结果只能经此文件回传 */
function reconcile_apply_result(job) {
	if (!job || index(['submitted', 'applying'], job.phase) < 0 || !stat(APPLY_RESULT))
		return job;
	let row = load_json(APPLY_RESULT);
	if (type(row) != 'object' || !row?.error)
		return job;
	job.phase = 'failed';
	job.updated_at = time();
	job.apply_report = row;
	job.message = '升级失败：' + (row?.detail || row?.error || '刷写失败');
	return job;
}

function load_active_job() {
	let row = load_json(ACTIVE_JOB);
	if (type(row) != 'object' || !row?.job_id) return null;
	return reconcile_apply_result(load_json(job_meta_path(row.job_id)));
}

export function job_get(id) {
	if (!match(id || '', /^[0-9a-f]{16}$/)) return null;
	let job = load_active_job();
	return job?.job_id == id ? job : null;
};

export function job_clear_apply_result() {
	if (stat(APPLY_RESULT)) unlink(APPLY_RESULT);
};

export function with_job_lock(callback) {
	ensure_dirs();
	/* O_CLOEXEC prevents the detached apply worker from inheriting the lock. */
	let lock = open(JOB_LOCK, 'ae', 0600);
	if (!lock)
		return { error: { code: 'INTERNAL', message: '无法打开升级任务锁' } };
	if (!lock.lock('xn')) {
		lock.close();
		return { error: { code: 'DEVICE_BUSY', message: '升级任务忙' } };
	}
	let result;
	try { result = callback(); }
	catch (e) { lock.close(); die(e); }
	lock.close();
	return result;
};

export function job_can_apply(job) {
	return job?.phase == 'verified' && time() - job.created_at < VERIFIED_TTL;
};

function cleanup_job(job) {
	if (!job) return;
	unlink(ACTIVE_JOB);
	unlink(job_image_path(job.job_id));
	unlink(job_meta_path(job.job_id));
}

export function job_cleanup(id) {
	return with_job_lock(() => {
		let job = id ? job_get(id) : load_active_job();
		if (job && index(['submitted', 'applying', 'rebooting'], job.phase) < 0)
			cleanup_job(job);
	});
};

function parse_verify_report(raw, status, require_no_flash) {
	let report;
	try {
		report = json(raw || '');
	} catch (e) {
		return { error: '固件校验器返回无效结果' };
	}
	if (status != 0 || report?.ok != true || report?.signature_checked != true)
		return { error: report?.detail || report?.error || '固件校验失败', report: report };
	if (require_no_flash && report?.flash_write != false)
		return { error: '验证模式不得刷写 Flash', report: report };
	return { report: report };
}

function run_check(path, require_no_flash) {
	let child = popen('/usr/sbin/mp716-upgraded check --image ' + shellquote(path) +
		' --meminfo /proc/meminfo --require-memory', 'r');
	if (child) {
		let raw = child.read('all');
		let status = child.close();
		try {
			json(raw || '');
			return parse_verify_report(raw, status, require_no_flash);
		} catch (e) { }
	}
	child = popen('sh -c "/usr/sbin/mp716-package-verify < ' + path + '"', 'r');
	if (!child) return { error: '无法启动固件校验器' };
	return parse_verify_report(child.read('all'), child.close(), require_no_flash);
}

export function reverify_job_image(job) {
	if (!job?.job_id || !stat(job.path))
		return { error: '任务镜像不存在' };
	let info = stat(job.path);
	if (type(info.size) == 'int' && job.size > 0 && info.size != job.size)
		return { error: '镜像已被替换或截断' };
	let check = run_check(job.path, true);
	if (check.error) return check;
	let sig = check.report?.payload_sha256 || check.report?.sha256 || '';
	if (length(job.payload_sha256) && sig && job.payload_sha256 != sig)
		return { error: '镜像摘要不匹配' };
	return check;
};

export function stream_firmware_upload(size) {
	return with_job_lock(() => {
		let active = load_active_job();
		if (active && index(['uploading', 'submitted', 'applying', 'rebooting'], active.phase) >= 0)
			return { error: { code: 'DEVICE_BUSY', message: '已有进行中的升级任务', job_id: active.job_id } };
		/* 新上传替换闲置镜像，先释放旧包占用的 tmpfs。 */
		cleanup_job(active);
		for (let orphan in glob(JOB_DIR + '/*.mp716upd') || [])
			unlink(orphan);
		let cap = firmware_capacity_check(size, 'upload');
		if (!cap.ok) return { error: cap };
		let id = new_job_id();
		let path = job_image_path(id);
		let writer = popen('/bin/sh -c ' + shellquote('cat > ' + path), 'w');
		if (!writer) return { error: { message: '无法保存固件文件' } };
		let got = 0;
		while (got < size) {
			let n = size - got;
			if (n > STREAM_CHUNK) n = STREAM_CHUNK;
			let chunk = stdin.read(n);
			if (type(chunk) != 'string' || !length(chunk)) {
				writer.close();
				unlink(path);
				return { error: { message: '固件上传不完整' } };
			}
			writer.write(chunk);
			got += length(chunk);
		}
		if (writer.close() != 0) {
			unlink(path);
			return { error: { message: '无法保存固件文件' } };
		}
		chmod(path, 0600);
		let after = firmware_capacity_check(size, 'verify');
		let check = run_check(path, true);
		if (check.error) {
			unlink(path);
			return { error: { message: check.error, details: check.report, capacity: after } };
		}
		let job = {
			job_id: id,
			phase: 'verified',
			path: path,
			size: size,
			payload_sha256: check.report?.payload_sha256 || check.report?.sha256 || '',
			created_at: time(),
			verify_report: check.report,
			capacity: { before: cap, after: after },
		};
		store_job(job);
		return { job: job, report: check.report };
	});
};

export function job_status_payload(id) {
	let job = id ? job_get(id) : load_active_job();
	let dev = firmware_boot_result().state;
	if (!job) {
		return {
			state: id ? 'UNKNOWN' : job_public_phase('', dev),
			message: dev == 'FAILED' ? device_failure_message() : (length(dev) ? 'device state ' + dev : 'no active job'),
			deviceState: dev || null,
		};
	}
	let expired = job.phase == 'verified' && !job_can_apply(job);
	let state = expired ? 'FAILED' : job_public_phase(job.phase, dev);
	let msg = '验签完成';
	if (state == 'SUBMITTED') msg = '升级已提交';
	if (state == 'APPLYING') msg = '正在刷写';
	if (state == 'REBOOTING') msg = '设备重启核验中';
	if (state == 'BOOT_CONFIRMED') msg = '新版本已确认';
	if (state == 'FAILED') msg = expired ? '验签任务已过期，请重新上传' :
		job.message || (dev == 'FAILED' ? device_failure_message() : '升级失败');
	return {
		state: state,
		taskId: job.job_id,
		job_id: job.job_id,
		message: msg,
		ts: job.updated_at || job.created_at,
		deviceState: dev || null,
		verification: job.verify_report || null,
		applyReport: job.apply_report || null,
	};
};

export function job_mark_phase(id, phase, extra) {
	/* Mutations run under the lock. Ignore the worker result here; status reconciles it separately. */
	let job = load_json(job_meta_path(id));
	if (job?.job_id != id) return false;
	job.phase = phase;
	job.updated_at = time();
	if (type(extra) == 'object')
		for (let k, v in extra)
			job[k] = v;
	store_job(job);
	return true;
};

export function job_mark_boot_confirmed() {
	return with_job_lock(() => {
		let active = load_active_job();
		if (active?.phase == 'rebooting')
			job_mark_phase(active.job_id, 'boot_confirmed');
	});
};
