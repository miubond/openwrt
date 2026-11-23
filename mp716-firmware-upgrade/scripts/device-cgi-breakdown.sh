#!/bin/sh
# On-device CGI phase breakdown (requires perf-diag enabled).
set -e
DIAG=/etc/mp716-admin/perf-diag
LOG=/tmp/mp716-perf.log
TOKEN="${MP716_TOKEN:-}"

if [ ! -f "$DIAG" ]; then
  touch "$DIAG"
  echo "enabled perf-diag"
fi
: >"$LOG"

if [ -z "$TOKEN" ]; then
  echo "Set MP716_TOKEN to a valid 32-hex session id" >&2
  exit 2
fi

for path in system/ping wireless/config system/info home/dashboard; do
  wget -qO- --header="Authorization: Bearer $TOKEN" \
    "http://127.0.0.1/cgi-bin/mp716/$path" >/dev/null || true
done

echo "--- perf log ---"
tail -20 "$LOG" 2>/dev/null || true

echo "--- load / mem ---"
cat /proc/loadavg
free 2>/dev/null | head -2 || true
for pid in $(pidof uhttpd 2>/dev/null); do
  echo "uhttpd RSS KB: $(awk '/VmRSS/{print $2}' /proc/$pid/status 2>/dev/null)"
done
for pid in $(pidof rpcd 2>/dev/null); do
  echo "rpcd RSS KB: $(awk '/VmRSS/{print $2}' /proc/$pid/status 2>/dev/null)"
done