#!/bin/sh
# 写入 OpenWrt overlay 文件树：正式发布固件默认 Web 可刷（需 RELEASE 签名公钥与验收记录）。
# 用法: write-release-upgrade-policy-overlay.sh /path/to/staging/root
set -eu
ROOT=${1:?missing staging root}
mkdir -p "$ROOT/etc/mp716-upgrade"
printf '%s\n' production >"$ROOT/etc/mp716-upgrade/upgrade-policy"
printf '%s\n' serial-recovery-verified >"$ROOT/etc/mp716-upgrade/flash-gate"
printf '%s\n' confirmed >"$ROOT/etc/mp716-upgrade/platform"
chmod 644 "$ROOT/etc/mp716-upgrade/upgrade-policy" \
	"$ROOT/etc/mp716-upgrade/flash-gate" "$ROOT/etc/mp716-upgrade/platform"
echo "release upgrade-policy overlay written"