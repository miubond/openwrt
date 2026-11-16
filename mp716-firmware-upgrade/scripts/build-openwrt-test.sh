#!/bin/bash
# Build a TEST image from a dedicated Linux checkout. This script only touches build files.
set -euo pipefail

project=$(cd "$(dirname "$0")/.." && pwd -P)
pin=64900e756efa667774214f9c6b17c113222e01f7

serial_rx=0
ram_web=""
if [ "${1:-}" = --ram-web ] && [ "$#" -ge 2 ]; then
	ram_web=$(realpath -e "$2")
	serial_rx=1
	shift 2
elif [ "${1:-}" = --serial-rx ]; then
	serial_rx=1
	shift
fi
if [ "$#" -ne 3 ]; then
	echo "usage: bash $0 [--serial-rx | --ram-web WEB_INPUT_ZIP] OPENWRT_CHECKOUT DEVICE_PROFILE OUTPUT_DIR" >&2
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
if [ -n "$ram_web" ]; then
	cat "$project/integration/ram-web/ram-web.dtsi" >> target/linux/ramips/dts/mt7628an_yunxm_mp716.dts
	python3 "$project/integration/ram-web/stage.py" "$ram_web" "$tree/files"
	install -D -m 0755 "$project/integration/ram-web/03_mp716_ram_web" files/etc/board.d/03_mp716_ram_web
fi
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
CONFIG_PACKAGE_mp716-sysupgrade=y
CONFIG
if [ "$serial_rx" -eq 1 ]; then
	cat >> .config <<'CONFIG'
# CONFIG_TARGET_ROOTFS_SQUASHFS is not set
CONFIG_BUSYBOX_CUSTOM=y
CONFIG_BUSYBOX_CONFIG_RX=y
CONFIG
else
	echo CONFIG_TARGET_ROOTFS_SQUASHFS=y >> .config
fi
if [ -n "$ram_web" ]; then
	cat >> .config <<'CONFIG'
CONFIG_PACKAGE_uhttpd=y
CONFIG_PACKAGE_rpcd=y
CONFIG_PACKAGE_ucode=y
CONFIG_PACKAGE_ucode-mod-fs=y
CONFIG_PACKAGE_ucode-mod-ubus=y
CONFIG_PACKAGE_ucode-mod-uci=y
CONFIG
fi
make defconfig
required_config=(CONFIG_TARGET_ramips_mt76x8_DEVICE_yunxm_mp716 CONFIG_TARGET_ROOTFS_INITRAMFS CONFIG_PACKAGE_mp716-sysupgrade)
if [ "$serial_rx" -eq 1 ]; then
	required_config+=(CONFIG_BUSYBOX_CUSTOM CONFIG_BUSYBOX_CONFIG_RX)
	grep -Fxq '# CONFIG_TARGET_ROOTFS_SQUASHFS is not set' .config
else
	required_config+=(CONFIG_TARGET_ROOTFS_SQUASHFS)
fi
if [ -n "$ram_web" ]; then
	required_config+=(CONFIG_PACKAGE_uhttpd CONFIG_PACKAGE_rpcd CONFIG_PACKAGE_ucode
		CONFIG_PACKAGE_ucode-mod-fs CONFIG_PACKAGE_ucode-mod-ubus CONFIG_PACKAGE_ucode-mod-uci)
fi
for required in "${required_config[@]}"; do
	grep -Fxq "$required=y" .config || { echo "Missing build configuration: $required" >&2; exit 2; }
done

jobs=${JOBS:-2}
make -j"$jobs" download V=s 2>&1 | tee "$output/download.log"
make -j"$jobs" V=s 2>&1 | tee "$output/build.log"

target=bin/targets/ramips/mt76x8
shopt -s nullglob
sysupgrade=("$target"/*-yunxm_mp716-squashfs-sysupgrade.bin)
initramfs=("$target"/*-yunxm_mp716-initramfs-kernel.bin)
if [ "$serial_rx" -eq 1 ]; then
	[ "${#initramfs[@]}" -eq 1 ] && [ "${#sysupgrade[@]}" -eq 0 ] || {
		echo "Expected only the MP716 initramfs image." >&2
		exit 2
	}
	archives=(build_dir/target-*/linux-ramips_mt76x8/linux-*/usr/initramfs_data.cpio)
	[ "${#archives[@]}" -eq 1 ] || { echo "Missing MP716 initramfs CPIO archive." >&2; exit 2; }
	staging_dir/host/bin/cpio -it < "${archives[0]}" > "$output/initramfs-files.txt"
	entries=(usr/bin/rx sbin/sysupgrade usr/libexec/validate_firmware_image)
	name=openwrt-ramips-mt76x8-yunxm_mp716-initramfs-rx-kernel.bin
	if [ -n "$ram_web" ]; then
		linux_dir=${archives[0]%/usr/initramfs_data.cpio}
		"$linux_dir/scripts/dtc/dtc" -q -I dtb -O dts \
			"$linux_dir/../image-mt7628an_yunxm_mp716.dtb" > "$output/board.dts"
		python3 - "$output/board.dts" <<'PY'
import re
import sys
from pathlib import Path

board = Path(sys.argv[1]).read_text()
for node, status in (("spi@b00", "disabled"), ("ethernet@10100000", "okay"), ("esw@10110000", "okay")):
    match = re.search(rf"^\s*{node}\s*\{{([^{{}}]*)", board, re.MULTILINE)
    if not match or f'status = "{status}";' not in match[1]:
        raise SystemExit(f"Expected {node} status {status} in the RAM image")
PY
		entries+=(usr/sbin/uhttpd sbin/rpcd usr/bin/ucode
			www/mp716/index.html www/cgi-bin/mp716 usr/share/mp716/httpd.uc
			usr/share/rpcd/acl.d/mp716.json usr/sbin/mp716-package-verify
			usr/sbin/mp716-upgraded etc/mp716-upgrade/upgrade.pub etc/board.d/03_mp716_ram_web)
		name=openwrt-ramips-mt76x8-yunxm_mp716-initramfs-ram-web-kernel.bin
	fi
	for entry in "${entries[@]}"; do
		grep -Eq "^(\\./)?$entry$" "$output/initramfs-files.txt" || {
			echo "Missing initramfs entry: $entry" >&2
			exit 2
		}
	done
	cp "${initramfs[0]}" "$output/$name"
	cp .config "$output/openwrt.config"
	(cd "$output" && sha256sum "$name" > SHA256SUMS)
	exit 0
fi
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
