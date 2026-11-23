#!/bin/sh
set -u
umask 077
stage=$1
kind=$2
shift 2
ceiling=${MP716_DIAG_TIMEOUT:-210}
case "$ceiling" in 10|210) ;; *) exit 2 ;; esac
case "$stage" in /tmp/mp716-diagnostics/*) ;; *) exit 2 ;; esac
[ -d "$stage" ] && [ ! -L "$stage" ] || exit 2
trap 'printf "143\n" > "$stage/exit"; exit 143' TERM INT
ulimit -f 128
if [ "${MP716_DIAG_ASYNC:-0}" = 1 ]; then
	# setsid may fork; report the real worker instead of trusting the launcher's $!.
	# Never probe until the controller has recorded that process identity.
	printf '%s\n' "$$" > "$stage/ready"
	for attempt in 1 2 3 4 5; do
		[ -f "$stage/authorized" ] && break
		/bin/busybox sleep 1
	done
	[ -f "$stage/authorized" ] || { printf '1\n' > "$stage/exit"; exit 1; }
fi
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
   # DISCOVER/OFFER only: never requests a lease or changes an address/route.
   /bin/busybox timeout 8 /usr/sbin/mp716-dhcp-discover "$1"
   ;;
  *) exit 2 ;;
 esac
} > "$stage/output" 2>&1
printf '%s\n' "$?" > "$stage/exit"
