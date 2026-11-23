'use strict';
import { readfile, stat, glob } from 'fs';
import { load_mapping } from '/usr/share/mp716/physical-ports.uc';
export function capabilities() {
	return {apiContract:'mp716-native/v1',routes:json(readfile('/usr/share/mp716/native-routes.json')||'[]'),
		firmwareUpgrade:!!(stat('/usr/sbin/mp716-upgraded')||stat('/usr/sbin/mp716-package-verify')),
		firmwareFlashEnabled:!!stat('/etc/mp716/allow-flash-upgrade'),wanModes:['wired'],wifiModes:['11g','11n','11bg','11bgn'],
		services:{ntp:!!stat('/etc/init.d/sysntpd'),pptp:!!stat('/usr/sbin/pppd') && !!stat('/lib/netifd/proto/ppp.sh') && !!stat('/etc/ppp/options.pptp') && length(glob('/usr/lib/pppd/*/pptp.so')||[])>0,
			pptpd:!!stat('/usr/sbin/pptpd'),l2tp:!!stat('/usr/sbin/xl2tpd'),ipsec:!!stat('/usr/lib/ipsec/starter'),openvpn:!!stat('/usr/sbin/openvpn')},
		hardware:{physicalLanOrderVerified:length(keys(load_mapping()))==5,cellularModemVerified:false},testStatus:'UNVERIFIED'};
};
