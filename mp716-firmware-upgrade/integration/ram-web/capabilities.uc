'use strict';
import { readfile, stat } from 'fs';
export function capabilities() {
	return {apiContract:'mp716-native/v1',routes:json(readfile('/usr/share/mp716/native-routes.json')||'[]'),
		firmwareUpgrade:false,wanModes:['wired'],wifiModes:['11g','11n','11bg','11bgn'],
		services:{ntp:!!stat('/etc/init.d/sysntpd'),pptp:!!stat('/usr/sbin/pppd') && !!stat('/lib/netifd/proto/pptp.sh'),
			pptpd:!!stat('/usr/sbin/pptpd'),l2tp:!!stat('/usr/sbin/xl2tpd'),ipsec:!!stat('/usr/lib/ipsec/starter'),openvpn:!!stat('/usr/sbin/openvpn')},
		hardware:{physicalLanOrderVerified:false,cellularModemVerified:false},testStatus:'UNVERIFIED'};
};
