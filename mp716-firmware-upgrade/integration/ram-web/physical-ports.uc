'use strict';
import { readfile } from 'fs';

// A failed switch query is unknown, never a disconnected cable. Keep physical
// labels separate from logical VLAN roles until this individual board is tested.
export function parse_switch_link(port, result) {
	let unknown={linkKnown:false,linkUp:null,speedMbps:0};
	if(type(port)!='int'||port<0||port>4||type(result)!='object'||type(result.code)!='int'||result.code!=0||type(result.output)!='string')return unknown;
	let line=trim(result.output), prefix='port:'+port+' link:';
	if(index(line,prefix)!=0||index(line,'\n')>=0||index(line,'\r')>=0)return unknown;
	let rest=trim(substr(line,length(prefix)));
	if(rest=='down')return {linkKnown:true,linkUp:false,speedMbps:0};
	let up=match(rest,/^up speed:(10|100|1000)baseT (full|half)-duplex$/);
	if(!up)return unknown;
	return {linkKnown:true,linkUp:true,speedMbps:int(up[1])};
};

export function mapping_labels(raw, board, device_mac) {
	let empty={};
	if(board!='yunxm,mp716'||!match(device_mac || '',/^([A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/))return empty;
	let cfg;try{cfg=json(raw || '{}');}catch(e){return empty;}
	if(type(cfg)!='object'||cfg.schema!='mp716-port-map/v1'||cfg.board!=board||cfg.switch!='switch0'||
		type(cfg.device_mac)!='string'||lc(cfg.device_mac)!=lc(device_mac)||type(cfg.mappings)!='array'||length(cfg.mappings)>5)return empty;
	let labels={},used={};
	for(let row in cfg.mappings) {
		if(type(row)!='object'||type(row.switch_port)!='int'||row.switch_port<0||row.switch_port>4||
			type(row.verified)!='bool'||!row.verified||type(row.label)!='string'||!match(row.label,/^(LAN[1-4]|WAN)$/)||
			labels[row.switch_port]!=null||used[row.label]||type(row.evidence)!='array'||length(row.evidence)<2)return empty;
		let hashes={};for(let hash in row.evidence){if(type(hash)!='string'||!match(hash,/^[a-f0-9]{64}$/))return empty;hashes[hash]=true;}
		if(length(keys(hashes))<2)return empty;
		labels[row.switch_port]=row.label;used[row.label]=true;
	}
	return labels;
};

export function load_mapping() {
	let board=trim(readfile('/tmp/sysinfo/board_name') || ''), identity;
	try{identity=json(readfile('/etc/board.json') || '{}');}catch(e){return {};}
	return mapping_labels(readfile('/etc/mp716-admin/port-map.json'),board,identity.network?.lan?.macaddr);
};

export function physical_ports(run, labels) {
	let ports=[];
	// BusyBox popen + inline for-loops are unreliable; use a fixed helper script.
	let batch = run('/bin/sh /usr/share/mp716/port-links.sh 2>/dev/null');
	if (type(batch) != 'object' || batch.code != 0 || !length(trim(batch.output || '')))
		batch = run('/bin/sh -c "/sbin/swconfig dev switch0 port 0 get link 2>/dev/null; /sbin/swconfig dev switch0 port 1 get link 2>/dev/null; /sbin/swconfig dev switch0 port 2 get link 2>/dev/null; /sbin/swconfig dev switch0 port 3 get link 2>/dev/null; /sbin/swconfig dev switch0 port 4 get link 2>/dev/null"');
	let out = type(batch) == 'object' ? batch.output : '';
	let code = type(batch) == 'object' && type(batch.code) == 'int' ? batch.code : 0;
	let lines = split(trim(out || ''), '\n');
	for(let i=0;i<5;i++) {
		let label=type(labels)=='object'?labels[i]:null, verified=type(label)=='string';
		let link=parse_switch_link(i,{code:code,output:trim(lines[i] || '')+'\n'});
		push(ports,{id:'port'+i,label:verified?label:'P'+i,role:verified?(label=='WAN'?'wan':'lan'):'unknown',mappingVerified:verified,...link});
	}
	return ports;
};
