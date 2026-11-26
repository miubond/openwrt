'use strict';
/**
 * 两阶段固件任务：落盘 /tmp（不写 overlay），验签后返回 job_id；apply 仅在刷写门开启时异步提交。
 * 对外状态：UPLOADING | VERIFIED | SUBMITTED | APPLYING | REBOOTING | BOOT_CONFIRMED | FAILED | UNKNOWN
 */
import { popen, stdin, writefile, unlink, chmod, stat, readfile, mkdir } from 'fs';

export const FIRMWARE_MAX_BYTES = 8060928;
export const STREAM_CHUNK = 65536;
const JOB_ROOT = '/tmp/mp716-upgrade';
const JOB_DIR = JOB_ROOT + '/jobs';
const JOB_LOCK = JOB_ROOT + '/job.lock';
const ACTIVE_JOB = JOB_ROOT + '/active-job.json';
/** payload + 解压 staging 预算（与 packer.image_format.UPLOAD_RESERVE_BYTES 对齐） */
const MEM_NEED_EXTRA_KB = 8 * 1024;
const TMP_MIN_EXTRA_KB = 512;
const BUSY_PHASES = ['uploading', 'verified', 'submitted', 'applying', 'rebooting'];

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
	if (device_state == 'SUCCESS') return 'BOOT_CONFIRMED';
	if (device_state == 'FAILED') return 'FAILED';
	if (index(['REBOOT_REQUIRED', 'BOOT_VERIFYING'], device_state) >= 0) return 'REBOOTING';
	return upper_state(phase);
};

function read_device_upgrade_state() {
	let raw = readfile('/etc/mp716-upgrade/state') || '';
	let name = '';
	for (let line in split(raw, '\n')) {
		let m = match(line, /^state=([A-Z_]+)/);
		if (m) name = m[1];
	}
	return name;
}

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

export function firmware_capacity_check(file_bytes) {
	let mem = mem_available_kb();
	let tmp = tmp_free_kb();
	let need_mem = int((file_bytes + 1023) / 1024) + MEM_NEED_EXTRA_KB;
	let need_tmp = int((file_bytes + 1023) / 1024) + TMP_MIN_EXTRA_KB;
	if (file_bytes <= 0 || file_bytes > FIRMWARE_MAX_BYTES)
		return { ok: false, code: 'VALIDATION', message: '固件文件不能超过 8M', memAvailableKb: mem, tmpFreeKb: tmp };
	if (tmp < need_tmp)
		return { ok: false, code: 'LOW_TMP', message: 'tmpfs 空间不足', needTmpKb: need_tmp, tmpFreeKb: tmp, memAvailableKb: mem };
	if (mem < need_mem)
		return { ok: false, code: 'LOW_MEMORY', message: '系统可用内存不足', needMemKb: need_mem, memAvailableKb: mem, tmpFreeKb: tmp };
	return { ok: true, memAvailableKb: mem, tmpFreeKb: tmp, needMemKb: need_mem, needTmpKb: need_tmp };
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
	writefile(job_meta_path(job.job_id), sprintf('%J\n', job));
	chmod(job_meta_path(job.job_id), 0600);
	writefile(ACTIVE_JOB, sprintf('%J\n', { job_id: job.job_id, updated: time() }));
	chmod(ACTIVE_JOB, 0600);
}

function load_active_job() {
	let row = load_json(ACTIVE_JOB);
	if (type(row) != 'object' || !row?.job_id) return null;
	return load_json(job_meta_path(row.job_id));
}

export function job_get(id) {
	if (!match(id || '', /^[0-9a-f]{16}$/)) return null;
	return load_json(job_meta_path(id));
};

function with_job_lock(callback) {
	ensure_dirs();
	let lock = popen('/bin/sh -c ' + shellquote('mkdir ' + JOB_LOCK + ' 2>/dev/null'), 'r');
	if (lock) lock.close();
	if (!stat(JOB_LOCK))
		return { error: { code: 'DEVICE_BUSY', message: '升级任务忙' } };
	let result = callback();
	let rd = popen('/bin/sh -c ' + shellquote('rmdir ' + JOB_LOCK + ' 2>/dev/null'), 'r');
	if (rd) rd.close();
	return result;
}

function busy_job_conflict() {
	let active = load_active_job();
	if (!active) return null;
	let state = job_public_phase(active.phase || '', read_device_upgrade_state());
	if (index(['UPLOADING', 'VERIFIED', 'SUBMITTED', 'APPLYING', 'REBOOTING'], state) >= 0)
		return active;
	return null;
}

export function job_cleanup(id, reason) {
	let job = id ? job_get(id) : load_active_job();
	if (!job) return;
	id = job.job_id;
	let pub = job_public_phase(job.phase, read_device_upgrade_state());
	if (index(['APPLYING', 'REBOOTING'], pub) >= 0)
		return;
	if (stat(job_image_path(id)))
		unlink(job_image_path(id));
	if (stat(job_meta_path(id)))
		unlink(job_meta_path(id));
	if (stat(ACTIVE_JOB)) {
		let row = load_json(ACTIVE_JOB);
		if (row?.job_id == id) unlink(ACTIVE_JOB);
	}
	if (reason)
		writefile(JOB_ROOT + '/last-cleanup.log', sprintf('%s %s\n', time(), reason));
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
	let cap = firmware_capacity_check(size);
	if (!cap.ok) return { error: cap };
	return with_job_lock(() => {
		let busy = busy_job_conflict();
		if (busy)
			return { error: { code: 'DEVICE_BUSY', message: '已有进行中的升级任务', job_id: busy.job_id } };
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
		let after = firmware_capacity_check(size);
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
	let dev = read_device_upgrade_state();
	if (!job) {
		return {
			state: job_public_phase('', dev),
			message: length(dev) ? 'device state ' + dev : 'no active job',
			deviceState: dev || null,
		};
	}
	let state = job_public_phase(job.phase, dev);
	let msg = '验签完成';
	if (state == 'SUBMITTED') msg = '升级已提交';
	if (state == 'APPLYING') msg = '正在刷写';
	if (state == 'REBOOTING') msg = '设备重启核验中';
	if (state == 'BOOT_CONFIRMED') msg = '新版本已确认';
	if (state == 'FAILED') msg = job.message || '升级失败';
	return {
		state: state,
		taskId: job.job_id,
		job_id: job.job_id,
		message: msg,
		ts: job.updated_at || job.created_at,
		deviceState: dev || null,
		verification: job.verify_report || null,
	};
};

export function job_mark_phase(id, phase, extra) {
	let job = job_get(id);
	if (!job) return false;
	job.phase = phase;
	job.updated_at = time();
	if (type(extra) == 'object')
		for (let k, v in extra)
			job[k] = v;
	store_job(job);
	return true;
};

export function job_mark_boot_confirmed() {
	let active = load_active_job();
	if (active) {
		active.phase = 'boot_confirmed';
		active.updated_at = time();
		store_job(active);
	}
};
