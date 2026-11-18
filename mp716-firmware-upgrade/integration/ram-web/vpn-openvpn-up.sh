#!/bin/sh
export MP716_VPN_KIND=openvpn MP716_VPN_EVENT=up MP716_VPN_PID="${daemon_pid:-$PPID}" MP716_VPN_IFACE="${dev:-$1}" MP716_VPN_LOCAL="${ifconfig_local:-}" MP716_VPN_REMOTE="${trusted_ip:-${trusted_ip6:-${ifconfig_remote:-}}}"
exec /usr/bin/ucode /usr/share/mp716/vpn-hook.uc
