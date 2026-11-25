#!/bin/sh
# Without an RTC the clock boots at the newest /etc mtime, which can be far in
# the past. The WireGuard peer then drops our handshakes (timestamp older than
# the last accepted one), while NTP and DNS are routed into that dead tunnel.
# Sync the clock once over WAN with temporary /32 routes to break the deadlock.

WG=mp716wgc
STAMP=/etc/mp716-admin/.clock
NTP_HOSTS="ntp.aliyun.com ntp.tencent.com pool.ntp.org"
GRACE=30
RETRY=300

log() { logger -t mp716-timefix "$*"; }

tunnel_stuck() {
	local hs up
	hs=$(wg show "$WG" latest-handshakes 2>/dev/null | awk 'NR==1{print $2}')
	[ -n "$hs" ] || return 1
	up=$(ifstatus "$WG" 2>/dev/null | jsonfilter -e '@.uptime' 2>/dev/null)
	[ -n "$up" ] && [ "$up" -ge "$GRACE" ] || return 1
	[ "$hs" = 0 ] && return 0
	[ $(( $(date +%s) - hs )) -gt 180 ]
}

sync_via_wan() {
	local st dev gw dns d h ip ips added rc
	st=$(ifstatus wan 2>/dev/null) || return 1
	dev=$(echo "$st" | jsonfilter -e '@.l3_device')
	gw=$(echo "$st" | jsonfilter -e "@.route[@.target='0.0.0.0'].nexthop" | head -n1)
	[ -n "$dev" ] && [ -n "$gw" ] || return 1
	dns=$(echo "$st" | jsonfilter -e '@["dns-server"][*]' -e '@.inactive["dns-server"][*]' 2>/dev/null)
	dns="$dns $gw"
	added=
	for d in $dns; do
		ip route add "$d/32" via "$gw" dev "$dev" 2>/dev/null && added="$added $d"
	done
	ips=
	for h in $NTP_HOSTS; do
		for d in $dns; do
			ip=$(timeout 5 nslookup "$h" "$d" 2>/dev/null | sed -n 's/^Address:[[:space:]]*\([0-9.]*\)$/\1/p' | head -n2)
			[ -n "$ip" ] && break
		done
		ips="$ips $ip"
	done
	set -- $ips
	rc=1
	if [ $# -gt 0 ]; then
		for ip in "$@"; do
			ip route add "$ip/32" via "$gw" dev "$dev" 2>/dev/null && added="$added $ip"
		done
		args=
		for ip in "$@"; do args="$args -p $ip"; done
		timeout 20 ntpd -n -q $args >/dev/null 2>&1 && rc=0
	fi
	for d in $added; do ip route del "$d/32" via "$gw" dev "$dev" 2>/dev/null; done
	if [ $rc = 0 ]; then
		touch "$STAMP"
		log "clock synced over WAN: $(date)"
	else
		log "WAN clock sync failed"
	fi
	return $rc
}

case "$1" in
	save)
		mkdir -p "${STAMP%/*}" && touch "$STAMP"
		;;
	once)
		sync_via_wan
		;;
	*)
		while sleep 15; do
			if tunnel_stuck; then
				sync_via_wan
				sleep "$RETRY"
			fi
		done
		;;
esac
