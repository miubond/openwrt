#!/bin/sh
case "${6:-}" in mp716-pptp) MP716_VPN_KIND=pptp ;; mp716-l2tp) MP716_VPN_KIND=l2tp ;; *) exit 1 ;; esac
export MP716_VPN_KIND MP716_VPN_EVENT=up MP716_VPN_PID="${PPPD_PID:-$PPID}" MP716_VPN_IFACE="$1" MP716_VPN_LOCAL="$4" MP716_VPN_REMOTE="$5"
exec /usr/bin/ucode /usr/share/mp716/vpn-hook.uc
