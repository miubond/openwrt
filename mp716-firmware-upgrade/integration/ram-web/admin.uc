'use strict';
import { cursor } from 'uci';
import { readfile, writefile, stat } from 'fs';
import { address, pool_bounds, sample_rates } from '/usr/share/mp716/network-values.uc';
import { sample_cpu } from '/usr/share/mp716/system-values.uc';
import { physical_ports, load_mapping } from '/usr/share/mp716/physical-ports.uc';
import { command, ensure_dirs, acquire, release, expire, pending, begin, applied, rollback,
	get_task, access_list, apply_access, store, STATE } from '/usr/share/mp716/admin-state.uc';
import { firmware_version } from '/usr/share/mp716/build-meta.uc';

function reject(message, code) { return { error: code || 'VALIDATION', message: message }; }
function string(value) { return sprintf('%s', value); }
function any(rows, predicate) { for (let row in rows) if (predicate(row)) return true; return false; }
function power2(exponent) { let n = 1; for (let i=0;i<exponent;i++) n *= 2; return n; }
function ipv4(value) {
	if (type(value) != 'string' || !match(value, /^([0-9]{1,3}\.){3}[0-9]{1,3}$/)) return false;
	for (let octet in split(value, '.')) if (int(octet) < 0 || int(octet) > 255) return false;
	return true;
};
function ipnum(value) { let n = 0; for (let octet in split(value, '.')) n = n * 256 + int(octet); return n; }
function netmask(bits) {
	let result = [];
	for (let i = 0; i < 4; i++) { let take = min(8, max(0, bits - i * 8)); push(result, 256 - (1 << (8 - take))); }
	return join('.', result);
};
function maskbits(mask) {
	if (!ipv4(mask)) return null;
	for (let i = 1; i <= 30; i++) if (netmask(i) == mask) return i;
	return null;
};
function mac(value) { return type(value) == 'string' && match(value, /^([A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$/); }
function unicast(value) { return mac(value) && index('02468aAcCeE',substr(value,1,1))>=0 && lc(value) != '00:00:00:00:00:00'; }
export function factory_wan_mac(raw) {
	try {let board=json(raw || '{}'), value=board.network?.wan?.macaddr;return unicast(value)?uc(value):'';}catch(e){return '';}
};
function integer(value, low, high) { return type(value) == 'int' && value >= low && value <= high; }
function text(value, limit) { return type(value) == 'string' && length(value) <= limit && index(value,'\x00')<0 && !match(value, /[[:cntrl:]]/); }
function list(value) { return type(value) == 'array' ? value : (value ? [value] : []); }
function lan(c) {
	let address = list(c.get('network', 'lan', 'ipaddr'))[0] || '192.168.1.1/24';
	let parts = split(address, '/');
	let mask = c.get('network', 'lan', 'netmask') || netmask(int(parts[1] || 24));
	return { ipv4: parts[0], netmask: mask, dhcpRelay: false };
};
function radio(c) {
	let result = 'radio0';
	c.foreach('wireless', 'wifi-device', (s) => { if (s.type == 'mac80211') result = s['.name']; });
	return result;
};
function ap(c) {
	let result = null;
	c.foreach('wireless', 'wifi-iface', (s) => { if (!result && s.mode == 'ap' && s.network == 'lan') result = s['.name']; });
	return result || 'default_radio0';
};
function wifi_interfaces(bus) {
	let result = [];
	let radios = bus.call('network.wireless', 'status', {}) || {};
	for (let name, status in radios) for (let iface in status.interfaces || []) {
		if (iface.config?.mode == 'ap' && match(iface.ifname || '', /^[A-Za-z0-9_.-]{1,24}$/))
			push(result, { ifname: iface.ifname, up: status.up == true, radio: name });
	}
	return result;
};
function stations(bus, c, detail) {
	let result = [];
	let full = detail == true;
	for (let iface in wifi_interfaces(bus)) {
		let entries = bus.call('hostapd.' + iface.ifname, 'get_clients', {})?.clients || {};
		let stats = {}, current = null;
		if (full) {
			let dump = command('/usr/sbin/iw dev ' + iface.ifname + ' station dump 2>/dev/null').output;
			for (let line in split(dump, '\n')) {
				let found = match(line, /^Station ([A-Fa-f0-9:]{17}) /);
				if (found) { current = uc(found[1]); stats[current] = {}; continue; }
				if (!current) continue;
				for (let field, pattern in { rssi: /signal:[[:space:]]*(-?[0-9]+)/, rxRateMbps: /rx bitrate:[[:space:]]*([0-9.]+)/,
					txRateMbps: /tx bitrate:[[:space:]]*([0-9.]+)/, connectedSec: /connected time:[[:space:]]*([0-9]+)/,
					rxBytes: /rx bytes:[[:space:]]*([0-9]+)/, txBytes: /tx bytes:[[:space:]]*([0-9]+)/ }) {
					let capture = match(line, pattern);
					if (capture) stats[current][field] = +capture[1];
				}
			}
		}
		for (let address, data in entries) if (mac(address) && (data.assoc || data.authorized)) {
			let values = stats[uc(address)] || {};
			push(result, { mac: uc(address), hostname: '', ssid: c.get('wireless', ap(c), 'ssid') || '',
				interface: iface.ifname, rssi: values.rssi ?? data.signal ?? 0,
				rxRateMbps: values.rxRateMbps || 0, txRateMbps: values.txRateMbps || 0,
				connectedSec: values.connectedSec || 0, rxBytes: values.rxBytes || 0, txBytes: values.txBytes || 0 });
		}
	}
	return result;
};
function leases() {
	let result = [];
	for (let line in split(trim(readfile('/tmp/dhcp.leases') || ''), '\n')) {
		let fields = split(trim(line), /[[:space:]]+/);
		if (length(fields) < 4 || !mac(fields[1]) || !ipv4(fields[2])) continue;
		push(result, { hostname: fields[3] == '*' ? '' : fields[3], mac: uc(fields[1]), ipv4: fields[2],
			expiresSec: int(fields[0]) == 0 ? 0 : max(0, int(fields[0]) - time()) });
	}
	return result;
};
function hosts(bus, c) {
	let result = {}, blocked = {};
	for (let row in access_list()) blocked[uc(row.mac)] = true;
	let wifi = stations(bus, c, false);
	for (let row in leases()) result[row.mac] = { id: row.mac, mac: row.mac, ipv4: row.ipv4,
		hostname: row.hostname || row.mac, interface: 'br-lan', wired: true, online: false,
		rxBytes: 0, txBytes: 0, lastSeen: '', blocked: blocked[row.mac] == true };
	let neighbors = command('/sbin/ip -4 neigh show dev br-lan 2>/dev/null').output;
	for (let line in split(neighbors, '\n')) {
		let m = match(line, /^([^[:space:]]+).*lladdr ([A-Fa-f0-9:]{17})[[:space:]]+.*(REACHABLE|STALE|DELAY|PROBE|PERMANENT)[[:space:]]*$/);
		if (!m || !ipv4(m[1])) continue;
		let address = uc(m[2]);
		result[address] ??= { id: address, mac: address, hostname: address, ipv4: m[1], interface: 'br-lan', wired: true,
			rxBytes: 0, txBytes: 0, blocked: blocked[address] == true };
		result[address].ipv4 = m[1];
		result[address].online = true; result[address].lastSeen = string(time());
	}
	for (let row in wifi) {
		let address = row.mac;
		result[address] ??= { id: address, mac: address, hostname: address, ipv4: '', blocked: blocked[address] == true };
		result[address].wired = false; result[address].online = true; result[address].interface = row.interface;
		result[address].rxBytes = row.rxBytes; result[address].txBytes = row.txBytes; result[address].lastSeen = string(time());
	}
	let rows = [];
	for (let name, row in result) if (row.online) push(rows, row);
	return rows;
};

const API_CACHE_DIR = '/tmp/mp716-api-cache';
const API_CACHE_SEC = 8;
const API_CACHE_TTL = {
	hosts: 5,
	physical_ports: 5,
	home_dashboard: 5,
	system_info: 3,
	system_status: 3,
	wireless_clients: 4,
};

function read_api_cache(key) {
	if (!stat(API_CACHE_DIR)) return null;
	let path = API_CACHE_DIR + '/' + key + '.json';
	if (!stat(path)) return null;
	let ttl = API_CACHE_TTL[key] ?? API_CACHE_SEC;
	try {
		let row = json(readfile(path) || '{}');
		if (type(row.at) != 'int' || row.data == null) return null;
		if (time() - row.at > ttl) return null;
		return row.data;
	} catch (e) { return null; }
}

function write_api_cache(key, data) {
	command('mkdir -p ' + API_CACHE_DIR);
	writefile(API_CACHE_DIR + '/' + key + '.json', sprintf('%J', { at: time(), data: data }));
}

function clear_api_cache() {
	if (stat(API_CACHE_DIR)) command('rm -rf ' + API_CACHE_DIR);
}

function hosts_cached(bus, c) {
	let hit = read_api_cache('hosts');
	if (hit != null) return hit;
	let data = hosts(bus, c);
	write_api_cache('hosts', data);
	return data;
}

function physical_ports_cached(run, labels) {
	let hit = read_api_cache('physical_ports');
	if (hit != null) return hit;
	let data = physical_ports(run, labels);
	write_api_cache('physical_ports', data);
	return data;
}

function iface_status(bus, c, name) {
	let status = bus.call('network.interface.' + name, 'status', {}) || {};
	let device = status.l3_device || status.device || '';
	let ip = (status['ipv4-address'] || [])[0];
	let device_status = device ? bus.call('network.device', 'status', { name: device }) || {} : {};
	let actual_mtu = match(device,/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/)
		? int(trim(readfile('/sys/class/net/' + device + '/mtu') || '')) : 0;
	let gateway = '';
	for (let route in status.route || []) if (route.target == '0.0.0.0') gateway = route.nexthop;
	let counters=device_status.statistics || {}, rates=sample_rates(name,device,counters.rx_bytes || 0,counters.tx_bytes || 0);
	return { name: name, label: uc(name), up: status.up == true, connected: status.up == true,
		proto: status.proto || c.get('network', name, 'proto') || '', ipv4: ip?.address || '',
		netmask: ip ? netmask(ip.mask) : '', gateway: gateway, dns: status['dns-server'] || [],
		mac: device_status.macaddr || trim(readfile('/sys/class/net/' + device + '/address') || ''),
		mtu: actual_mtu || device_status.mtu || int(c.get('network', name, 'mtu') || 1500), uptimeSec: status.uptime || 0,
		rxBytes: device_status.statistics?.rx_bytes || 0, txBytes: device_status.statistics?.tx_bytes || 0,
		...rates, dhcpEnabled: c.get('dhcp', 'lan', 'ignore') != '1' };
};
function system_info(bus, c) {
	let info = bus.call('system', 'info', {}) || {};
	let free = command("df -k /overlay | tail -n 1 | awk '{print $4}'").output;
	let zone=c.get('system','@system[0]','timezone') || 'UTC';
	if(!match(zone,/^[A-Za-z0-9<>+,:.\/-]{1,100}$/))zone='UTC';
	return { model: 'MP716', hostname: c.get('system', '@system[0]', 'hostname') || 'MP716', firmware: firmware_version(),
		kernel: trim(readfile('/proc/sys/kernel/osrelease') || ''), uptimeSec: int(info.uptime || 0),
		localTime: trim(command("TZ='"+zone+"' /bin/busybox date '+%Y-%m-%d %H:%M:%S'").output), timezone:zone,
		cpuLoad: map(info.load || [0,0,0], (n) => n / 65536.0),
		memTotalKb: int((info.memory?.total || 0) / 1024), memFreeKb: int((info.memory?.available || info.memory?.free || 0) / 1024),
		flashTotalKb: 8192, flashFreeKb: int(trim(free) || 0) };
};
function system_info_cached(bus, c) {
	let hit = read_api_cache('system_info');
	if (hit != null) return hit;
	let data = system_info(bus, c);
	write_api_cache('system_info', data);
	return data;
};
function system_status_payload(bus, c) {
	let info = system_info_cached(bus, c), clients = hosts_cached(bus, c);
	return { ...sample_cpu(), memoryPercent: info.memTotalKb ? int(100 - info.memFreeKb * 100 / info.memTotalKb) : 0,
		uptimeSec: info.uptimeSec, interfaces: [iface_status(bus, c, 'lan'), iface_status(bus, c, 'wan')],
		wirelessClients: length(filter(clients, (x) => x.wired == false)), wiredClients: length(filter(clients, (x) => x.wired == true)) };
};
function system_status_cached(bus, c) {
	let hit = read_api_cache('system_status');
	if (hit != null) return hit;
	let data = system_status_payload(bus, c);
	write_api_cache('system_status', data);
	return data;
};
function wifi_config(c) {
	let a = ap(c), r = radio(c);
	let enc = c.get('wireless', a, 'encryption') || 'none';
	let base=split(enc,'+')[0];
	let security = {none:'none',psk:'wpa-psk',psk2:'wpa2-psk','psk-mixed':'wpa-wpa2-psk',sae:'wpa3-sae','sae-mixed':'wpa2-wpa3'}[base] || 'unsupported';
	let tkip=index(enc,'tkip')>=0,ccmp=index(enc,'ccmp')>=0 || index(enc,'aes')>=0;
	let htmode=c.get('wireless',r,'htmode') || 'HT20',legacy=c.get('wireless',r,'legacy_rates')=='1';
	let hwmode=c.get('wireless',r,'hwmode');
	let mode=htmode=='NOHT' ? (hwmode=='11b' || hwmode=='b' ? '11b' : legacy?'11bg':'11g') : c.get('wireless',r,'require_mode')=='n'?'11n':legacy?'11bgn':'11gn';
	let power = c.get('wireless', r, 'txpower');
	let percent = power == null || int(power)>=20 ? 100 : int(power)>=19 ? 75 : int(power)>=17 ? 50 : int(power)>=14 ? 25 : int(power)>=11 ? 12 : 0;
	return { enabled: c.get('wireless', r, 'disabled') != '1' && c.get('wireless', a, 'disabled') != '1',
		ssid: c.get('wireless', a, 'ssid') || '', password: c.get('wireless', a, 'key') ? '********' : '',
		hidden: c.get('wireless', a, 'hidden') == '1', channel: c.get('wireless', r, 'channel') == 'auto' ? 'auto' : int(c.get('wireless', r, 'channel') || 6),
		txPower: percent, txpowerPercent: percent, security: security, rawEncryption:enc, cipher: tkip ? (ccmp?'tkipaes':'tkip') : 'aes',
		mode: mode, supportedModes:['11g','11n','11bg','11bgn'], htmode: htmode=='NOHT'?'HT20':substr(htmode,0,4)=='HT40'?'HT40':htmode, maxClients: int(c.get('wireless', a, 'max_num_sta') || 32),
		isolate: c.get('wireless', a, 'isolate') == '1', macfilter: c.get('wireless', a, 'macfilter') || 'disable',
		maclist: list(c.get('wireless', a, 'maclist')) };
};
function wifi_status(bus, c, client_count) {
	let cfg=wifi_config(c),ifaces=wifi_interfaces(bus), dev=ifaces[0]?.ifname;
	let clients = type(client_count) == 'int' ? client_count : length(stations(bus,c));
	return {iface:dev||'',band:'2.4GHz',enabled:any(ifaces,(i)=>i.up),ssid:cfg.ssid,channel:cfg.channel=='auto'?0:cfg.channel,autoChannel:cfg.channel=='auto',txPower:cfg.txPower,clients:clients,security:cfg.security,mode:cfg.mode,mac:dev?trim(readfile('/sys/class/net/'+dev+'/address')||''):''};
};

function home_dashboard(bus, c) {
	let labels = load_mapping();
	let client_list = hosts_cached(bus, c);
	let wireless_clients = length(filter(client_list, (row) => row.wired == false));
	return { system: system_info_cached(bus,c), wan: iface_status(bus,c,'wan'),
		wifi: wifi_status(bus, c, wireless_clients), physicalPorts: physical_ports_cached(command, labels),
		devices: client_list };
};

function home_dashboard_cached(bus, c) {
	let hit = read_api_cache('home_dashboard');
	if (hit != null) return hit;
	let data = home_dashboard(bus, c);
	write_api_cache('home_dashboard', data);
	return data;
};

function dhcp_config(c) {
	let config = lan(c), pool=pool_bounds(config.ipv4,maskbits(config.netmask));
	let start = int(c.get('dhcp', 'lan', 'start') || 100), count = int(c.get('dhcp', 'lan', 'limit') || 150);
	let bindings = [];
	c.foreach('dhcp', 'host', (s) => { if (s.ip && s.mac) push(bindings, { ipv4: s.ip, mac: uc(join(' ', list(s.mac))), hostname: s.name || '' }); });
	return { enabled: c.get('dhcp', 'lan', 'ignore') != '1', start: start, limit: count,
		leasetime: c.get('dhcp', 'lan', 'leasetime') || '12h', gateway: config.ipv4, dns: [], leases: leases(),
		startIp: address(pool.base+start), endIp: address(pool.base+start+count-1), minIp: pool.first, maxIp: pool.last, staticBindings: bindings };
};
function updates(c, path, cfg) {
	let writes = [], sections = [], packages, kind;
	function set(pkg, section, option, value) { push(writes, [pkg, section, option, value]); }
	if (path == 'network/wan/config') {
		packages = ['network']; kind = 'network';
		if (index(['dhcp','static','pppoe'], cfg.proto) < 0) die('不支持的 WAN 连接类型');
		if (cfg.proto == 'pppoe' && !stat('/lib/netifd/proto/ppp.sh')) die('当前固件未启用 PPPoE');
		if (cfg.wanMode && cfg.wanMode != 'wired') die('当前设备仅支持有线 WAN');
		let mtu = cfg.proto == 'pppoe' ? cfg.pppMtu || 1492 : cfg.mtu;
		if (!integer(mtu, 576, cfg.proto == 'pppoe' ? 1492 : 1500)) die('MTU 超出允许范围');
		if (cfg.macaddr && !unicast(cfg.macaddr)) die('MAC 地址无效');
		if (!text(cfg.hostname || '', 63)) die('主机名无效');
		set('network','wan','proto',cfg.proto); set('network','wan','mtu',string(mtu));
		if (index(['dhcp','static','pppoe'],cfg.proto)>=0) {
			// Modern netifd applies link MTU on the device section. Keep the
			// interface value for API compatibility and back up both in one task.
			let device = c.get('network','wan','device'), matches = [];
			if (type(device) != 'string' || !match(device,/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/) || device == c.get('network','lan','device'))
				die('WAN 设备无效或与 LAN 共享');
			c.foreach('network','device',(s) => { if (s.name == device) push(matches,s['.name']); });
			if (length(matches) > 1) die('WAN 设备配置重复');
			let section = matches[0] || 'mp716_wan_device';
			if (!length(matches)) {
				if (c.get('network',section) != null) die('WAN 设备配置名称冲突');
				push(sections,['network',section,'device']);
				set('network',section,'name',device);
			}
			set('network',section,'mtu',string(cfg.proto=='pppoe'?1500:mtu));
		}
		if (cfg.hostname) set('network','wan','hostname',cfg.hostname);
		if (cfg.macaddr) set('network','wan','macaddr',lc(cfg.macaddr));
		if (type(cfg.dns) != 'array' || length(cfg.dns) > 3) die('DNS 地址无效');
		for (let ip in cfg.dns) if (!ipv4(ip)) die('DNS 地址无效');
		set('network','wan','dns',length(cfg.dns) ? cfg.dns : null);
		set('network','wan','peerdns',length(cfg.dns) ? '0' : '1');
		if (cfg.proto == 'static') {
			if (!ipv4(cfg.ipv4) || maskbits(cfg.netmask) == null || !ipv4(cfg.gateway)) die('静态 WAN 地址无效');
			let bits = maskbits(cfg.netmask), divisor = power2(32 - bits);
			if (int(ipnum(cfg.ipv4) / divisor) != int(ipnum(cfg.gateway) / divisor)) die('网关必须位于 WAN 子网内');
			let l=lan(c), lsize=power2(32-maskbits(l.netmask));
			let wstart=int(ipnum(cfg.ipv4)/divisor)*divisor, lstart=int(ipnum(l.ipv4)/lsize)*lsize;
			if(wstart<=lstart+lsize-1 && lstart<=wstart+divisor-1)die('WAN 与 LAN 网段不能重叠');
			set('network','wan','ipaddr',cfg.ipv4); set('network','wan','netmask',cfg.netmask); set('network','wan','gateway',cfg.gateway);
		}
		if (cfg.proto == 'pppoe') {
			if (!text(cfg.username || '', 128)) die('PPPoE 用户名无效');
			if (!text(cfg.ac || '',128) || !text(cfg.service || '',128)) die('PPPoE 接入集中器或服务名称无效');
			set('network','wan','username',cfg.username || '');
			set('network','wan','ac',cfg.ac || null); set('network','wan','service',cfg.service || null);
			if (cfg.password && cfg.password != '********') { if (!text(cfg.password,128)) die('密码无效'); set('network','wan','password',cfg.password); }
		}
	} else if (path == 'network/lan/config') {
		packages = ['network','dhcp']; kind = 'network-dhcp';
		let bits = maskbits(cfg.netmask);
		if (!ipv4(cfg.ipv4) || bits == null || bits < 16 || bits > 30) die('LAN 地址或子网掩码无效');
		let divisor = power2(32-bits), host = ipnum(cfg.ipv4) % divisor;
		if (host == 0 || host == divisor-1) die('不能使用网络地址或广播地址');
		set('network','lan','ipaddr',cfg.ipv4 + '/' + bits); set('network','lan','netmask',null);
		let pool=pool_bounds(cfg.ipv4,bits), start=int(c.get('dhcp','lan','start')||100), count=int(c.get('dhcp','lan','limit')||150);
		if(!c.get('dhcp','lan'))die('LAN DHCP 配置缺失');
		if(start<1 || count<1 || start+count>pool.size-1 || start<=pool.router && pool.router<start+count) {
			let after=pool.size-2-pool.router, before=pool.router-1;
			start=after>=before?pool.router+1:1;count=min(150,max(after,before));
			if(count<1)die('LAN 子网没有可分配的 DHCP 地址');
			set('dhcp','lan','start',string(start));set('dhcp','lan','limit',string(count));
		}
		c.foreach('dhcp','host',(s)=>{
			if(!s.ip)return;
			let value=ipnum(s.ip)-pool.base;
			if(!ipv4(s.ip)||value<1||value>=pool.size-1||value==pool.router)die('新 LAN 子网与现有静态租约冲突，请先调整或移除冲突租约');
		});
	} else if (path == 'network/dns/config') {
		packages = ['network']; kind = 'network';
		if (index(['auto','manual'],cfg.mode) < 0 || type(cfg.servers) != 'array' || length(cfg.servers)>3) die('DNS 配置无效');
		if (cfg.mode == 'manual' && !length(cfg.servers)) die('请输入 DNS 服务器');
		for (let ip in cfg.servers) if (!ipv4(ip)) die('DNS 地址无效');
		set('network','wan','dns',cfg.mode == 'manual' ? cfg.servers : null); set('network','wan','peerdns',cfg.mode == 'manual' ? '0' : '1');
	} else if (path == 'network/dhcp/config') {
		packages = ['dhcp']; kind = 'dhcp';
		let config = lan(c), pool=pool_bounds(config.ipv4,maskbits(config.netmask));
		let start = cfg.start, count = cfg.limit;
		if (cfg.startIp || cfg.endIp) {
			if (!ipv4(cfg.startIp) || !ipv4(cfg.endIp)) die('DHCP 地址池必须位于 LAN 网段');
			start = ipnum(cfg.startIp)-pool.base; count = ipnum(cfg.endIp) - ipnum(cfg.startIp) + 1;
		}
		let router = pool.router;
		if (type(cfg.enabled) != 'bool' || !integer(start,1,pool.size-2) || !integer(count,1,pool.size-2) || start+count-1>pool.size-2 || (start<=router && router<start+count)) die('DHCP 地址池无效或包含路由器地址');
		if (!match(cfg.leasetime || '', /^[1-9][0-9]{0,6}[smhdw]?$/)) die('租期无效');
		set('dhcp','lan','ignore',cfg.enabled ? '0':'1'); set('dhcp','lan','start',string(start)); set('dhcp','lan','limit',string(count)); set('dhcp','lan','leasetime',cfg.leasetime);
	} else if (path == 'wireless/config') {
		packages = ['wireless']; kind = 'wireless';
		let a = ap(c), r = radio(c), old = wifi_config(c);
		if (type(cfg.enabled) != 'bool' || !text(cfg.ssid,32) || !length(cfg.ssid)) die('Wi-Fi 名称无效');
		if (cfg.channel != 'auto' && !integer(cfg.channel,1,13)) die('信道无效');
		let editable=index(['none','wpa-psk','wpa2-psk','wpa-wpa2-psk'],cfg.security)>=0;
		let same_encryption=cfg.security==old.security && (cfg.cipher || 'aes')==old.cipher;
		let secret_changed=cfg.password && cfg.password!='********';
		let keep_encryption=same_encryption && !secret_changed;
		if ((!editable && !same_encryption) || index(['aes','tkip','tkipaes'],cfg.cipher || 'aes')<0) die('不支持的加密设置');
		if(!editable && secret_changed)die('此加密方式仅支持保持现有设置；更改密码前请选择支持的加密方式');
		let secret = cfg.password && cfg.password != '********' ? cfg.password : c.get('wireless',a,'key') || '';
		if (!keep_encryption && cfg.security != 'none' && !(text(secret,63) && length(secret)>=8) && !match(secret,/^[a-fA-F0-9]{64}$/)) die('Wi-Fi 密码必须为 8–63 字符或 64 位十六进制');
		if (!integer(cfg.maxClients ?? 32,1,32)) die('终端数量超出范围');
		if (cfg.mode && cfg.mode!=old.mode && index(old.supportedModes,cfg.mode)<0) die('不支持的无线模式');
		if (cfg.htmode && index(['HT20','HT40','AUTO'],cfg.htmode)<0) die('带宽设置无效');
		let encryption = keep_encryption ? c.get('wireless',a,'encryption') : { none:'none', 'wpa-psk':'psk', 'wpa2-psk':'psk2', 'wpa-wpa2-psk':'psk-mixed' }[cfg.security];
		if (!keep_encryption && encryption != 'none') encryption += '+' + ({aes:'ccmp',tkip:'tkip',tkipaes:'tkip+ccmp'}[cfg.cipher || 'aes']);
		set('wireless',a,'ssid',cfg.ssid); set('wireless',a,'disabled',cfg.enabled?'0':'1'); set('wireless',r,'disabled',cfg.enabled?'0':'1');
		set('wireless',a,'hidden',cfg.hidden?'1':'0'); set('wireless',a,'isolate',cfg.isolate?'1':'0');
		set('wireless',a,'encryption',encryption);
		if (cfg.password && cfg.password != '********') set('wireless',a,'key',secret);
		set('wireless',r,'channel',string(cfg.channel)); set('wireless',a,'max_num_sta',string(cfg.maxClients || 32));
		// Pinned wifi-scripts hostapd.sh supports legacy_rates/require_mode;
		// mac80211.sh maps NOHT to 802.11n disabled. Preserve an existing mode
		// exactly unless the user selects a supported replacement.
		if(cfg.mode && cfg.mode!=old.mode) {
			set('wireless',r,'hwmode','11g');set('wireless',r,'band','2g');
			set('wireless',r,'legacy_rates',index(['11bg','11bgn'],cfg.mode)>=0?'1':'0');
			set('wireless',r,'require_mode',cfg.mode=='11n'?'n':null);
			set('wireless',r,'htmode',index(['11g','11bg'],cfg.mode)>=0?'NOHT':cfg.htmode=='AUTO'?'HT40':cfg.htmode || 'HT20');
		} else if (cfg.htmode && cfg.htmode != old.htmode && index(['11n','11bgn','11gn'],old.mode)>=0) set('wireless',r,'htmode',cfg.htmode=='AUTO'?'HT40':cfg.htmode);
		let power = cfg.txpowerPercent ?? cfg.txPower ?? 100;
		if (power != old.txPower) {
			let dbm = { '100':null,'75':'19','50':'17','25':'14','12':'11','0':'0' }[string(power)];
			if (dbm == null && power != 100) die('发射功率无效');
			set('wireless',r,'txpower',dbm);
		}
	} else if (path == 'wireless/acl') {
		packages = ['wireless']; kind = 'wireless';
		if (index(['disable','allow','deny'],cfg.mode)<0 || type(cfg.entries)!='array' || length(cfg.entries)>64) die('访问控制表无效');
		let addresses = [];
		for (let row in cfg.entries) { if (!unicast(row.mac)) die('MAC 地址无效'); push(addresses,lc(row.mac)); }
		if (cfg.mode == 'allow' && !length(addresses)) die('白名单不能为空');
		set('wireless',ap(c),'macfilter',cfg.mode); set('wireless',ap(c),'maclist',length(addresses)?addresses:null);
	} else if (path == 'wireless/advanced') {
		packages = ['wireless']; kind = 'wireless';
		if (!integer(cfg.beacon,20,1024) || !integer(cfg.dtim,1,255) || !integer(cfg.rtsThreshold,1,2347) || !integer(cfg.fragThreshold,256,2346)) die('无线高级参数超出范围');
		if (cfg.bgprotectMode != 0 || cfg.txBurst != 1 || cfg.txPreamble != 1) die('当前固件不支持修改这些兼容参数');
		// Pinned mac80211.sh passes wifi-iface.dtim_period to hostapd.
		set('wireless',ap(c),'dtim_period',string(cfg.dtim));
		set('wireless',radio(c),'beacon_int',string(cfg.beacon));
		set('wireless',radio(c),'rts',string(cfg.rtsThreshold)); set('wireless',radio(c),'frag',string(cfg.fragThreshold)); set('wireless',ap(c),'wmm',cfg.wmm?'1':'0');
	} else die('配置入口无效');
	return { writes:writes, sections:sections, packages:packages, kind:kind };
};
function apply_config(c, path, cfg, token, timeout) {
	let plan = updates(c,path,cfg); // Validate everything before changing UCI or creating a task.
	let changed = filter(plan.writes, (w) => sprintf('%J',c.get(w[0],w[1],w[2])) != sprintf('%J',w[3]));
	if (!length(changed) && !length(plan.sections)) return { accepted:true,rollbackSec:0 };
	let task = begin(token,plan.packages,plan.kind,timeout);
	try {
		for (let s in plan.sections) if (!c.set(s[0],s[1],s[2])) die('无法创建 WAN 设备配置');
		for (let w in changed) {
			let success = w[3] == null ? c.delete(w[0],w[1],w[2]) : c.set(w[0],w[1],w[2],w[3]);
			if (!success && w[3] != null) die('无法写入配置');
		}
		for (let name in plan.packages) if (!c.commit(name)) die('无法保存配置');
		return applied(task);
	} catch (e) { rollback(task); die(e); }
};

function apply_static(c, rows, token, timeout) {
	if(type(rows)!='array'||length(rows)>64)die('静态租约列表无效');
	let config=lan(c), divisor=power2(32-maskbits(config.netmask)), used_mac={},used_ip={};
	for(let row in rows){
		if(!ipv4(row.ipv4)||!unicast(row.mac)||!text(row.hostname||'',63))die('静态租约内容无效');
		let host=ipnum(row.ipv4)%divisor;
		if(int(ipnum(row.ipv4)/divisor)!=int(ipnum(config.ipv4)/divisor)||host==0||host==divisor-1||row.ipv4==config.ipv4)die('静态租约必须位于 LAN 可用地址范围');
		if(used_mac[uc(row.mac)]||used_ip[row.ipv4])die('静态租约地址重复');
		used_mac[uc(row.mac)]=true;used_ip[row.ipv4]=true;
	}
	if(sprintf('%J',rows)==sprintf('%J',dhcp_config(c).staticBindings))return{accepted:true,rollbackSec:0};
	let existing={};c.foreach('dhcp','host',(s)=>{existing[uc(join(' ',list(s.mac)))]=s;});
	let t=begin(token,['dhcp'],'dhcp',timeout);
	try{
		for(let address,s in existing)if(!used_mac[address])c.delete('dhcp',s['.name']);
		for(let row in rows){
			let s=existing[uc(row.mac)],name=s?s['.name']:c.add('dhcp','host');
			if(!name||!c.set('dhcp',name,'ip',row.ipv4)||!c.set('dhcp',name,'mac',lc(row.mac)))die('无法保存静态租约');
			if(row.hostname)c.set('dhcp',name,'name',row.hostname);else c.delete('dhcp',name,'name');
		}
		if(!c.commit('dhcp'))die('无法提交静态租约');
		return applied(t);
	}catch(e){rollback(t);die(e);}
};

export function warm_api_cache(bus) {
	let c = cursor();
	let labels = load_mapping();
	write_api_cache('hosts', hosts(bus, c));
	write_api_cache('physical_ports', physical_ports(command, labels));
};

export function route_admin(bus, method, path, body, token) {
	let c = cursor();
	if (method == 'GET') {
		if (path == 'wizard/quick') {
			let w=wifi_config(c), n=route_admin(bus,'GET','network/wan/config',{},token).data;
			return {data:{firstBoot:c.get('system','@system[0]','mp716_wizard_complete')=='0'?1:0,
				wan:{wanType:'wired',proto:n.proto,hostName:n.hostname,ipAddr:n.ipv4,subnetMask:n.netmask,gateway:n.gateway,dns:n.dns,username:n.username,password:n.password,ac:n.ac,service:n.service},
				wifi:{ssid2g:w.ssid,encry2g:w.security=='none'?0:1,passphrase2g:w.password}}};
		}
		if (path == 'system/info') return { data:system_info_cached(bus,c) };
		if (path == 'system/device') return { data:{ productName:'MP716',productModel:'MP716',softwareVersion:firmware_version(),webuiVersion:'',lanMac:iface_status(bus,c,'lan').mac,wanIp:iface_status(bus,c,'wan').ipv4 } };
		if (path == 'system/status') return { data:system_status_cached(bus,c) };
		if (path == 'network/wan/status') return { data:iface_status(bus,c,'wan') };
		if (path == 'network/lan/status') { let value=iface_status(bus,c,'lan');value.clientCount=length(hosts_cached(bus,c));return { data:value }; }
		if (path == 'network/lan/config') return { data:lan(c) };
		if (path == 'network/wan/config') { let v=iface_status(bus,c,'wan'), client=filter(hosts_cached(bus,c),(h)=>h.ipv4==getenv('REMOTE_ADDR'))[0],proto=c.get('network','wan','proto')||'dhcp'; return { data:{ proto:proto,ipv4:c.get('network','wan','ipaddr')||'',netmask:c.get('network','wan','netmask')||'',gateway:c.get('network','wan','gateway')||'',dns:list(c.get('network','wan','dns')),mtu:int(c.get('network','wan','mtu')||1500),pppMtu:proto=='pppoe'?int(c.get('network','wan','mtu')||1492):1492,hostname:c.get('network','wan','hostname')||'',macaddr:c.get('network','wan','macaddr')||v.mac,defaultMac:factory_wan_mac(readfile('/etc/board.json')),clientMac:client?.mac || '',username:c.get('network','wan','username')||'',password:c.get('network','wan','password')?'********':'',ac:c.get('network','wan','ac')||'',service:c.get('network','wan','service')||'',wanMode:'wired' } }; }
		if (path == 'network/dhcp/config') return { data:dhcp_config(c) };
		if (path == 'network/dns/config') return { data:{ mode:c.get('network','wan','peerdns')=='0'?'manual':'auto',servers:list(c.get('network','wan','dns')) } };
		if (path == 'wireless/config') return { data:wifi_config(c) };
		if (path == 'wireless/status') return { data: wifi_status(bus, c) };
		if (path == 'wireless/clients') {
			let hit = read_api_cache('wireless_clients');
			if (hit != null) return { data: hit };
			let data = stations(bus, c, true);
			write_api_cache('wireless_clients', data);
			return { data: data };
		}
		if (path == 'wireless/advanced') return { data:{supportsLegacyOptions:false,supportsDtim:true,radioOn:wifi_config(c).enabled,bgprotectMode:0,beacon:int(c.get('wireless',radio(c),'beacon_int')||100),dtim:int(c.get('wireless',ap(c),'dtim_period')||2),rtsThreshold:int(c.get('wireless',radio(c),'rts')||2347),fragThreshold:int(c.get('wireless',radio(c),'frag')||2346),txBurst:1,txPreamble:1,wmm:c.get('wireless',ap(c),'wmm')=='0'?0:1} };
		if (path == 'wireless/acl') { let cfg=wifi_config(c);return { data:{mode:cfg.macfilter,entries:map(cfg.maclist,(m)=>({id:uc(m),mac:uc(m),policy:cfg.macfilter=='allow'?'allow':'deny'}))} }; }
		if (path == 'hosts/connected') return { data:hosts_cached(bus,c) };
		if (path == 'hosts/device-acl') return { data:access_list() };
		if (path == 'hosts/overview') return { data:{ connected:hosts_cached(bus,c), acl:access_list() } };
		if (path == 'home/dashboard') return { data: home_dashboard_cached(bus, c) };
		if (path == 'home/physical-ports') return { data:physical_ports_cached(command, load_mapping()) };
		if (path == 'network/qos/capability') return { data:{supported:false,backend:'none',reason:'当前固件未启用 QoS'} };
		if (path == 'system/logs') return { data:{enabled:true,content:command('logread -l 100').output} };
	}
	let task_match = match(path,/^system\/config-task\/([a-f0-9]{32})$/);
	let task_action = path == 'system/config-task/confirm' ? 'confirm' : path == 'system/config-task/cancel' ? 'cancel' : null;
	let write_config = method == 'POST' && index(['network/wan/config','network/lan/config','network/dns/config','network/dhcp/config','network/dhcp/static','wireless/config','wireless/advanced','wireless/acl'],path)>=0;
	let access = method == 'POST' && path == 'hosts/device-acl';
	let wizard = method == 'POST' && index(['wizard/quick','wizard/complete'],path)>=0;
	let disconnect = method == 'POST' && path=='hosts/disconnect';
	if (!task_match && !task_action && !write_config && !access && !wizard && !disconnect) return null;
	if (!acquire()) return reject('另一个配置操作正在执行','DEVICE_BUSY');
	clear_api_cache();
	let result;
	try {
		result = (function() {
		expire();
		if (task_match && method == 'GET') return { data:get_task(task_match[1],token,null) };
		if (task_action && method == 'POST') return { data:get_task(body.taskId,token,task_action) };
		if (pending()) return reject('请先确认或撤销当前配置','DEVICE_BUSY');
		if (wizard) {
			if (path=='wizard/complete') {
				let t=begin(token,['system'],'none',90);
				try {
					if(!c.set('system','@system[0]','mp716_wizard_complete','1')||!c.commit('system'))die('无法完成设置向导');
					applied(t);get_task(t.id,token,'confirm');return {data:null};
				}catch(e){rollback(t);die(e);}
			}
			let w=body.wan, f=body.wifi;
			if(type(w)!='object'||type(f)!='object'||w.wanType!='wired'||index([0,1],f.encry2g)<0)die('向导设置无效或缺少蜂窝模块支持');
			let old=route_admin(bus,'GET','network/wan/config',{},token).data;
			let plans=[updates(c,'network/wan/config',{...old,proto:w.proto,wanMode:w.wanType,hostname:w.hostName||'',ipv4:w.ipAddr,netmask:w.subnetMask,gateway:w.gateway,dns:w.dns,username:w.username,password:w.password,ac:w.ac,service:w.service}),
				updates(c,'wireless/config',{...wifi_config(c),ssid:f.ssid2g,security:f.encry2g?'wpa2-psk':'none',cipher:'aes',password:f.passphrase2g})];
			let t=begin(token,['network','wireless'],'network-wireless',90);
			try {
				for(let plan in plans) {
					for(let s in plan.sections)if(!c.set(s[0],s[1],s[2]))die('无法创建向导配置');
					for(let v in plan.writes)if(v[3]==null)c.delete(v[0],v[1],v[2]);else if(!c.set(v[0],v[1],v[2],v[3]))die('无法写入向导配置');
				}
				if(!c.commit('network')||!c.commit('wireless'))die('无法保存向导配置');
				return {data:{...applied(t),progressSec:0,reconnect:false,reconnectIp:lan(c).ipv4}};
			}catch(e){rollback(t);die(e);}
		}
		if (disconnect) {
			let row=filter(hosts_cached(bus,c),(h)=>h.id==body.deviceId)[0];
			if(!row || row.wired)die('仅能暂时断开当前无线终端；有线终端请使用访问控制');
			if(row.ipv4==getenv('REMOTE_ADDR'))die('不能断开当前管理终端');
			let response=bus.call('hostapd.'+row.interface,'del_client',{addr:lc(row.mac),reason:5,deauth:true,ban_time:0});
			if(response==null)die('无法断开无线终端');return {data:null};
		}
		if (write_config) {
			let seconds = body.confirmTimeoutSec == null ? 90 : body.confirmTimeoutSec;
			if (!integer(seconds,30,180)) return reject('确认时间必须在 30–180 秒内');
			if(path=='network/dhcp/static')return{data:apply_static(c,body.bindings,token,seconds)};
			return { data:apply_config(c,path,body.config||body,token,seconds) };
		}
		if (access) {
			if (!unicast(body.mac) || index(['add','remove'],body.action)<0) return reject('终端 MAC 或操作无效');
			let address=uc(body.mac), entries=access_list(), old=entries;
			if (body.action=='add') {
				let origin=getenv('REMOTE_ADDR');
				if(any(hosts(bus,c),(h)=>h.mac==address&&h.ipv4==origin))return reject('不能禁止当前管理终端，请使用另一条连接操作');
				if(!any(entries,(e)=>uc(e.mac)==address)) { entries=map(entries,(e)=>e);push(entries,{mac:address}); }
			} else entries=filter(entries,(e)=>uc(e.mac)!=address);
			ensure_dirs();store(STATE+'/access.json',entries);
			try { apply_access(); } catch(e) { store(STATE+'/access.json',old);apply_access();die(e); }
			return { data:null };
		}
		return reject('请求方法不支持');
		})();
	} catch(e) { result = reject(e.message || string(e)); }
	release();
	return result;
};
