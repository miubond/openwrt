#!/bin/sh
# 为 OpenWrt 镜像设置未验收设备的默认升级策略。
# 用法: write-release-upgrade-policy-overlay.sh /path/to/staging/root
set -eu
ROOT=${1:?missing staging root}
mkdir -p "$ROOT/etc/mp716-upgrade"
printf '%s\n' production >"$ROOT/etc/mp716-upgrade/upgrade-policy"
printf '%s\n' closed >"$ROOT/etc/mp716-upgrade/flash-gate"
printf '%s\n' unconfirmed >"$ROOT/etc/mp716-upgrade/platform"
chmod 644 "$ROOT/etc/mp716-upgrade/upgrade-policy" \
	"$ROOT/etc/mp716-upgrade/flash-gate" "$ROOT/etc/mp716-upgrade/platform"
echo "release upgrade-policy overlay written"
