'use strict';
import { readfile, mkdir, chmod, rmdir, stat } from 'fs';
import { load, store } from '/usr/share/mp716/admin-state.uc';
export function address(n) {
	let parts=[];for(let shift in [24,16,8,0])push(parts,sprintf('%d',int(n/(1<<shift))%256));
	return join('.',parts);
};
export function pool_bounds(ip,bits) {
	let size=1;for(let i=bits;i<32;i++)size*=2;
	let value=0;for(let part in split(ip,'.'))value=value*256+int(part);
	let base=int(value/size)*size;
	return {base:base,size:size,router:value-base,first:address(base+1),last:address(base+size-2)};
};
export function rate_delta(previous,current) {
	let delta=current.ms-(previous?.ms || 0);
	if(!previous || previous.boot!=current.boot || previous.device!=current.device || delta<500 || delta>30000 || current.rx<previous.rx || current.tx<previous.tx)
		return {rxRateBps:0,txRateBps:0,ratesReady:false};
	return {rxRateBps:int((current.rx-previous.rx)*1000/delta),txRateBps:int((current.tx-previous.tx)*1000/delta),ratesReady:true};
};
export function sample_rates(name,device,rx,tx) {
	if(index(['lan','wan'],name)<0)return {rxRateBps:0,txRateBps:0,ratesReady:false};
	let root='/tmp/mp716-rates';mkdir(root,0700);chmod(root,0700);
	let file=root+'/'+name+'.json', old=load(file);
	let current={ms:int(+(split(readfile('/proc/uptime')||'0',' ')[0])*1000),boot:trim(readfile('/proc/sys/kernel/random/boot_id')||''),device:device,rx:rx,tx:tx};
	if(old && old.boot==current.boot && old.device==device && current.ms-old.ms<500)return old.rates || {rxRateBps:0,txRateBps:0,ratesReady:false};
	let lock=root+'/'+name+'.lock';
	if(stat(lock) && time()-stat(lock).mtime>5)rmdir(lock);
	if(!mkdir(lock,0700))return old?.rates || {rxRateBps:0,txRateBps:0,ratesReady:false};
	let rates=rate_delta(old,current);
	try {store(file,{...current,rates:rates});}catch(e){rmdir(lock);die(e);}
	rmdir(lock);return rates;
};
