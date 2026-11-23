'use strict';
import { readfile, mkdir, unlink, stat } from 'fs';
import { cursor } from 'uci';
import { store, load, command } from '/usr/share/mp716/admin-state.uc';
import { session_addresses } from '/usr/share/mp716/vpn-config.uc';
import { read_models, VPN_RUNTIME } from '/usr/share/mp716/vpn-runtime.uc';

function quote(s) {return "'"+replace(s,"'","'\\''")+"'";}
let kind=getenv('MP716_VPN_KIND'), event=getenv('MP716_VPN_EVENT'), pid=getenv('MP716_VPN_PID');
if(index(['pptp','l2tp','openvpn'],kind)<0||index(['up','down'],event)<0||!match(pid || '',/^[1-9][0-9]{0,7}$/))exit(1);
let iface=getenv('MP716_VPN_IFACE');
if(!match(iface || '',/^[A-Za-z0-9_.-]{1,15}$/))exit(1);
let path=kind=='openvpn'?VPN_RUNTIME+'/openvpn-up.json':VPN_RUNTIME+'/sessions/'+pid+'.json';
if(event=='down') {
	let row=load(path);
	if(row?.pid!=pid || row.iface!=iface)exit(0);
	for(let route in row.routes || [])command('/sbin/ip -4 route del '+quote(route)+' dev '+quote(iface)+' 2>/dev/null');
	unlink(path);exit(0);
}
let proc=readfile('/proc/'+pid+'/stat') || '', fields=split(substr(proc,index(proc,') ')+2),' '), cmd=readfile('/proc/'+pid+'/cmdline') || '';
if(length(fields)<=19 || fields[0]=='Z' || index(cmd,VPN_RUNTIME+'/')<0 || index(cmd,kind=='openvpn'?'openvpn':'pppd')<0)exit(1);
let remote=getenv('MP716_VPN_REMOTE') || '', local=getenv('MP716_VPN_LOCAL') || '';
// OpenVPN subnet topology need not expose an IPv4 remote tunnel endpoint;
// its authenticated transport peer can also be IPv6. Only PPP server peer
// addresses are required to be IPv4 for the managed address pools.
if(!stat('/sys/class/net/'+iface))exit(1);
let addresses;
try {addresses=session_addresses(kind,local,remote,getenv('CALLER_ID') || '');} catch(e) {exit(1);}
mkdir(VPN_RUNTIME,0700);mkdir(VPN_RUNTIME+'/sessions',0700);
let username=getenv('PEERNAME') || '', routes=[];
if(kind!='openvpn') {
	let m=read_models(cursor()), user=filter(m.users.users,(u)=>u.username==username && (u.type=='all'||u.type==kind))[0];
	if(user)for(let route in filter(split(user.routes,';'),(r)=>length(r)>0))
		if(command('/sbin/ip -4 route add '+quote(route)+' dev '+quote(iface)+' 2>/dev/null').code==0)push(routes,route);
}
let now=localtime();
store(path,{pid:pid,started:fields[19],iface:iface,type:kind,username:username,...addresses,
	joinedAt:sprintf('%04d-%02d-%02d %02d:%02d:%02d',now.year,now.mon,now.mday,now.hour,now.min,now.sec),routes:routes});
