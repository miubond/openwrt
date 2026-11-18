#!/bin/sh
case "${6:-}" in mp716-pptp) MP716_VPN_KIND=pptp ;; mp716-l2tp) MP716_VPN_KIND=l2tp ;; *) exit 1 ;; esac
export MP716_VPN_KIND MP716_VPN_EVENT=down MP716_VPN_PID="${PPPD_PID:-$PPID}" MP716_VPN_IFACE="$1"
exec /usr/bin/ucode /usr/share/mp716/vpn-hook.uc
