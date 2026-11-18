#!/bin/sh
export MP716_VPN_KIND=openvpn MP716_VPN_EVENT=down MP716_VPN_PID="${daemon_pid:-$PPID}" MP716_VPN_IFACE="${dev:-$1}"
exec /usr/bin/ucode /usr/share/mp716/vpn-hook.uc
