#!/bin/sh
# Deliberately do not source the normal DHCP client hook or change interfaces.
case "$1" in
 bound|renew)
  case "${serverid:-}" in
   ''|*[!0-9.]*) exit 1 ;;
   *) printf 'DHCP_SERVER %s\n' "$serverid" ;;
  esac
  ;;
esac
exit 0
