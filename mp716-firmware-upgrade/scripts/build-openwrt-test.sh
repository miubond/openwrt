#!/bin/bash
# Build a TEST image from a dedicated Linux checkout. This script only touches build files.
set -euo pipefail

project=$(cd "$(dirname "$0")/.." && pwd -P)
pin=64900e756efa667774214f9c6b17c113222e01f7

if [ "$#" -ne 3 ]; then
	echo "usage: bash $0 OPENWRT_CHECKOUT DEVICE_PROFILE OUTPUT_DIR" >&2
	exit 2
fi
if [ "$(uname -s)" != Linux ]; then
	echo "Use a Linux build host with a case-sensitive filesystem." >&2
	exit 2
fi
tree=$(cd "$1" && pwd -P)
profile=$(realpath "$2")
mkdir -p "$3"
output=$(cd "$3" && pwd -P)
for path in "$tree" "$project" "$profile"; do
	case "$path" in
		*[[:space:]]*) echo "OpenWrt build paths cannot contain whitespace: $path" >&2; exit 2 ;;
	esac
done
[ -f "$profile" ] || { echo "Missing device profile: $profile" >&2; exit 2; }
python3 - "$project" "$profile" <<'PY'
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from packer.manifest import parse_semver

fields = dict(
    line.split("=", 1)
    for line in Path(sys.argv[2]).read_text(encoding="ascii").splitlines()
    if line and not line.startswith("#") and "=" in line
)
if fields.get("product") != "MP716":
    raise SystemExit("The image profile must declare product=MP716")
parse_semver(fields.get("installed_custom_firmware", ""))
PY
[ "$(git -C "$tree" rev-parse HEAD)" = "$pin" ] || {
	echo "Use a dedicated checkout of OpenWrt $pin." >&2
	exit 2
}
[ "$tree" != "$project" ]
cd "$tree"

overlay="$project/openwrt-overlay/target/linux/ramips"
cp "$overlay/dts/mt7628an_yunxm_mp716.dts" target/linux/ramips/dts/
cp "$overlay/image/yunxm_mp716.mk" target/linux/ramips/image/
include='include ./yunxm_mp716.mk'
grep -Fxq "$include" target/linux/ramips/image/mt76x8.mk ||
	printf '\n%s\n' "$include" >> target/linux/ramips/image/mt76x8.mk

package="$tree/package/mp716-sysupgrade"
mkdir -p "$package"
cp -R "$project/integration/openwrt-package/." "$package/"
sed -i 's/\r$//' "$package/Makefile" "$package/files/usr/sbin/mp716-sysupgrade" \
	"$package/files/etc/init.d/mp716-sysupgrade"
export MP716_SOURCE_DIR="$project"
export MP716_IMAGE_PROFILE="$profile"

cat > .config <<'CONFIG'
CONFIG_DEVEL=y
CONFIG_BROKEN=y
CONFIG_TARGET_ramips=y
CONFIG_TARGET_ramips_mt76x8=y
CONFIG_TARGET_ramips_mt76x8_DEVICE_yunxm_mp716=y
CONFIG_TARGET_ROOTFS_INITRAMFS=y
CONFIG_TARGET_ROOTFS_SQUASHFS=y
CONFIG_PACKAGE_mp716-sysupgrade=y
CONFIG
make defconfig
for required in CONFIG_TARGET_ramips_mt76x8_DEVICE_yunxm_mp716 CONFIG_TARGET_ROOTFS_INITRAMFS CONFIG_TARGET_ROOTFS_SQUASHFS CONFIG_PACKAGE_mp716-sysupgrade; do
	grep -Fxq "$required=y" .config || { echo "Missing build configuration: $required" >&2; exit 2; }
done

jobs=${JOBS:-2}
make -j"$jobs" download V=s 2>&1 | tee "$output/download.log"
make -j"$jobs" V=s 2>&1 | tee "$output/build.log"

target=bin/targets/ramips/mt76x8
shopt -s nullglob
sysupgrade=("$target"/*-yunxm_mp716-squashfs-sysupgrade.bin)
initramfs=("$target"/*-yunxm_mp716-initramfs-kernel.bin)
[ "${#sysupgrade[@]}" -eq 1 ] && [ "${#initramfs[@]}" -eq 1 ] || {
	echo "Expected one MP716 sysupgrade image and one MP716 initramfs image." >&2
	exit 2
}
[ "$(wc -c < "${sysupgrade[0]}")" -le 8060928 ] || {
	echo "Final sysupgrade image exceeds the firmware partition." >&2
	exit 2
}
metadata="$output/sysupgrade-metadata.json"
staging_dir/host/bin/fwtool -i "$metadata" "${sysupgrade[0]}"
offset=$(python3 - "$project" "$metadata" "${sysupgrade[0]}" <<'PY'
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
from packer.image_format import inspect_payload

with open(sys.argv[2], encoding="utf-8") as stream:
    metadata = json.load(stream)
if "yunxm,mp716" not in metadata.get("supported_devices", []):
    raise SystemExit("MP716 is missing from sysupgrade metadata")
print(inspect_payload(Path(sys.argv[3]).read_bytes()).squashfs_offset)
PY
)
unsquashfs=staging_dir/host/bin/unsquashfs4
"$unsquashfs" -offset "$offset" -cat "${sysupgrade[0]}" etc/mp716-upgrade/device.profile |
	cmp - "$profile"
"$unsquashfs" -offset "$offset" -ls "${sysupgrade[0]}" > "$output/rootfs-files.txt"
for entry in usr/sbin/mp716-upgraded usr/sbin/mp716-sysupgrade etc/rc.d/S95mp716-sysupgrade; do
	grep -Fxq "squashfs-root/$entry" "$output/rootfs-files.txt"
done
cp "${sysupgrade[0]}" "${initramfs[0]}" "$output/"
cp .config "$output/openwrt.config"
(
	cd "$output"
	sha256sum "$(basename "${sysupgrade[0]}")" "$(basename "${initramfs[0]}")" > SHA256SUMS
)
