#!/bin/sh
set -u
umask 077
stage=$1
kind=$2
shift 2
ceiling=${MP716_DIAG_TIMEOUT:-210}
case "$ceiling" in 10|210) ;; *) exit 2 ;; esac
case "$stage" in /tmp/mp716-diagnostics/*) ;; *) exit 2 ;; esac
trap 'printf "143\n" > "$stage/exit"; exit 143' TERM INT
ulimit -f 128
{
 case "$kind" in
  ping)
   target=$1; count=$2; source=$3
   set -- /bin/busybox ping -c "$count" -W 2 -w 205
   [ -z "$source" ] || set -- "$@" -I "$source"
   /bin/busybox timeout "$ceiling" "$@" "$target"
   ;;
  traceroute) /bin/busybox timeout "$ceiling" /bin/busybox traceroute -n -q 1 -m "$2" -w "$3" "$1" ;;
  dns) /bin/busybox timeout "$ceiling" /bin/busybox nslookup "$1" ;;
  dhcp)
   # This hook only reports the offer. It never configures an address or route.
   /bin/busybox timeout 12 /bin/busybox udhcpc -f -n -q -R -t 3 -T 2 -i br-lan -s /usr/share/mp716/dhcp-probe.sh
   ;;
  *) exit 2 ;;
 esac
} > "$stage/output" 2>&1
printf '%s\n' "$?" > "$stage/exit"
