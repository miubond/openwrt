#!/bin/sh
# Compatibility entry point. Never starts udhcpc, sends DHCPREQUEST, configures
# an address or sources the normal DHCP client hook.
[ "$#" -eq 1 ] || exit 2
exec /usr/sbin/mp716-dhcp-discover "$1"
