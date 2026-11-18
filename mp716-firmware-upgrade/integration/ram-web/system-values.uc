'use strict';
import { readfile, mkdir, chmod, rmdir, stat } from 'fs';
import { load, store } from '/usr/share/mp716/admin-state.uc';

// Linux includes guest/guest_nice in user/nice already. Count only the first
// eight fields; load averages measure runnable work, not CPU utilization.
export function cpu_counters(contents) {
	let line=match(contents || '', /^cpu[ \t]+([^\n]+)/);
	if(!line)return null;
	let fields=split(trim(line[1]), /[ \t]+/);
	if(length(fields)<4)return null;
	let total=0,idle=0,counters=[];
	for(let i=0;i<min(length(fields),8);i++) {
		if(!match(fields[i],/^[0-9]+$/))return null;
		let value=int(fields[i]);push(counters,value);total+=value;
		if(i==3 || i==4)idle+=value;
	}
	return {total:total,idle:idle,counters:counters};
};
export function cpu_delta(previous,current) {
	let empty={cpuPercent:null,cpuSampled:false};
	if(!previous || !current || !current.boot || previous.boot!=current.boot || current.ms-previous.ms<500 || current.ms-previous.ms>30000 || !previous.values || !current.values)return empty;
	let old=previous.values,next=current.values;
	if(length(old.counters)!=length(next.counters))return empty;
	for(let i=0;i<length(old.counters);i++)if(next.counters[i]<old.counters[i])return empty;
	let total=next.total-old.total,idle=next.idle-old.idle;
	if(total<=0 || idle<0 || idle>total)return empty;
	return {cpuPercent:int((total-idle)*100/total),cpuSampled:true};
};
export function sample_cpu() {
	let root='/tmp/mp716-cpu',empty={cpuPercent:null,cpuSampled:false};
	mkdir(root,0700);chmod(root,0700);
	let file=root+'/sample.json',old=load(file);
	let current={ms:int(+(split(readfile('/proc/uptime')||'0',' ')[0])*1000),boot:trim(readfile('/proc/sys/kernel/random/boot_id')||''),values:cpu_counters(readfile('/proc/stat'))};
	let cached=old && current.boot && old.boot==current.boot && current.ms>=old.ms && current.ms-old.ms<=30000 ? old.sample || empty : empty;
	if(old && old.boot==current.boot && current.ms>=old.ms && current.ms-old.ms<500)return cached;
	let lock=root+'/sample.lock',locked=stat(lock);
	if(locked && time()-locked.mtime>5)rmdir(lock);
	if(!mkdir(lock,0700))return cached;
	let sample=cpu_delta(old,current);
	try {store(file,{...current,sample:sample});}catch(e){rmdir(lock);return empty;}
	rmdir(lock);return sample;
};
