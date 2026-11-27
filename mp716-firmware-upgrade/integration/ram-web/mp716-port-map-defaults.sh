#!/bin/sh
# 缺省外壳网口标注（恢复出厂后 overlay 丢失时重装）。幂等。
. /lib/functions.sh
[ "$(board_name)" = yunxm,mp716 ] || exit 0
[ -f /etc/mp716-admin/port-map.json ] && exit 0
tpl=/usr/share/mp716/port-map-chassis-default.json
[ -r "$tpl" ] || exit 0
mac=$(jsonfilter -i /etc/board.json -e '@.network.lan.macaddr' 2>/dev/null) || exit 0
case "$mac" in
	""|00:00:00:00:00:00|ff:ff:ff:ff:ff:ff) exit 0 ;;
esac
mkdir -p /etc/mp716-admin
sed "s/__LAN_MAC__/$mac/g" "$tpl" > /etc/mp716-admin/port-map.json
chmod 600 /etc/mp716-admin/port-map.json
exit 0