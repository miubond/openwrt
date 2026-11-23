#!/bin/sh
# Compare CGI GET vs ubus rpcd experiment (read-only). Requires MP716_TOKEN and deployed experiment plugin.
set -e
HOST="${MP716_HOST:-127.0.0.1}"
TOKEN="${MP716_TOKEN:-}"
N="${MP716_ROUNDS:-20}"
if [ -z "$TOKEN" ]; then echo "export MP716_TOKEN=<32-hex session>" >&2; exit 2; fi

cgi_ms() {
  path="$1"
  t0=$(cut -d. -f1 /proc/uptime)
  wget -qO /dev/null --header="Authorization: Bearer $TOKEN" \
    "http://${HOST}/cgi-bin/mp716/$path" || return 1
  t1=$(cut -d. -f1 /proc/uptime)
  echo $(( (t1 - t0) * 1000 ))
}

ubus_ms() {
  method="$1"
  t0=$(cut -d. -f1 /proc/uptime)
  ubus call mp716-native-readonly "$method" "{\"ubus_rpc_session\":\"$TOKEN\"}" >/dev/null 2>&1 || return 1
  t1=$(cut -d. -f1 /proc/uptime)
  echo $(( (t1 - t0) * 1000 ))
}

echo "=== CGI wireless/config (${N}x) ==="
i=0; sum=0; while [ $i -lt $N ]; do ms=$(cgi_ms wireless/config); sum=$((sum + ms)); i=$((i+1)); done
echo "approx avg ms: $((sum / N))"

if ubus list | grep -q '^mp716-native-readonly$'; then
  echo "=== ubus native_wireless_config (${N}x) ==="
  i=0; sum=0; while [ $i -lt $N ]; do ms=$(ubus_ms native_wireless_config); sum=$((sum + ms)); i=$((i+1)); done
  echo "approx avg ms: $((sum / N))"
else
  echo "skip ubus: mp716-native-readonly not installed (see experiment/README-rpcd-ubus.md)"
fi