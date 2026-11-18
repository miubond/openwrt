#!/bin/bash
# Build a TEST image from a dedicated Linux checkout. This script only touches build files.
set -euo pipefail

project=$(cd "$(dirname "$0")/.." && pwd -P)
pin=$(cat "$project/config/openwrt.commit")

serial_rx=0
web_input=""
lan_candidate=0
case "${1:-}" in
	--ram-web|--lan-candidate)
		web_input=$(realpath -e "${2:?Missing Web input}")
		if [ "$1" = --ram-web ]; then
			serial_rx=1
		else
			lan_candidate=1
		fi
		shift 2
		;;
	--serial-rx) serial_rx=1; shift ;;
esac
if [ "$#" -ne 3 ]; then
	echo "usage: bash $0 [--serial-rx | --ram-web WEB_INPUT | --lan-candidate WEB_INPUT] OPENWRT_CHECKOUT DEVICE_PROFILE OUTPUT_DIR" >&2
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

# The release pins packages in feeds.conf.default. Never follow a moving feed.
packages_pin=093d551675b1119a06ef224d419905e8d6b2af1a
grep -Fxq "src-git packages https://git.openwrt.org/feed/packages.git^$packages_pin" feeds.conf.default
[ ! -e feeds.conf ] || { echo "Custom feed overrides are not allowed." >&2; exit 2; }
./scripts/feeds update packages
[ "$(git -C feeds/packages rev-parse HEAD)" = "$packages_pin" ] || {
	echo "Unexpected packages feed commit." >&2; exit 2;
}
./scripts/feeds install miniupnpd-nftables

overlay="$project/openwrt-overlay/target/linux/ramips"
cp "$overlay/dts/mt7628an_yunxm_mp716.dts" target/linux/ramips/dts/
cp "$overlay/image/yunxm_mp716.mk" target/linux/ramips/image/
if [ -n "$web_input" ]; then
	cat "$overlay/dts/mt7628an_yunxm_mp716-lan-test.dtsi" >> target/linux/ramips/dts/mt7628an_yunxm_mp716.dts
	stage_args=()
	if [ -d "$web_input" ]; then
		stage_args+=(--web-dist "$web_input")
		web_input="$project/integration/ram-web/web-input.zip"
	fi
	if [ "$lan_candidate" -eq 1 ]; then
		[ ! -e files/etc/mp716-upgrade/upgrade.pub ] || { echo "Use a checkout without a staged test key." >&2; exit 2; }
		stage_args+=(--no-test-key)
	else
		cat "$project/integration/ram-web/ram-web.dtsi" >> target/linux/ramips/dts/mt7628an_yunxm_mp716.dts
		if [ -n "${MP716_RAM_TEST_PUBLIC_KEY:-}" ]; then
			stage_args+=(--test-public-key "$MP716_RAM_TEST_PUBLIC_KEY")
		fi
	fi
	python3 "$project/integration/ram-web/stage.py" "$web_input" "$tree/files" "${stage_args[@]}"
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
CONFIG_PACKAGE_mp716-sysupgrade=y
CONFIG
if [ "$lan_candidate" -eq 0 ]; then
	echo CONFIG_TARGET_ROOTFS_INITRAMFS=y >> .config
else
	echo '# CONFIG_TARGET_ROOTFS_INITRAMFS is not set' >> .config
fi
if [ "$serial_rx" -eq 1 ]; then
	cat >> .config <<'CONFIG'
# CONFIG_TARGET_ROOTFS_SQUASHFS is not set
CONFIG_BUSYBOX_CUSTOM=y
CONFIG_BUSYBOX_CONFIG_RX=y
CONFIG
else
	echo CONFIG_TARGET_ROOTFS_SQUASHFS=y >> .config
fi
if [ -n "$web_input" ]; then
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
required_config=(CONFIG_TARGET_ramips_mt76x8_DEVICE_yunxm_mp716 CONFIG_PACKAGE_mp716-sysupgrade
	CONFIG_PACKAGE_kmod-mt7603 CONFIG_PACKAGE_wpad-basic-mbedtls
	CONFIG_PACKAGE_firewall4 CONFIG_PACKAGE_miniupnpd-nftables CONFIG_PACKAGE_swconfig
	CONFIG_PACKAGE_dnsmasq)
if [ "$lan_candidate" -eq 0 ]; then
	required_config+=(CONFIG_TARGET_ROOTFS_INITRAMFS)
elif ! grep -Fxq '# CONFIG_TARGET_ROOTFS_INITRAMFS is not set' .config; then
	echo "LAN candidate requires initramfs to be disabled after make defconfig." >&2
	exit 2
fi
if [ "$serial_rx" -eq 1 ]; then
	required_config+=(CONFIG_BUSYBOX_CUSTOM CONFIG_BUSYBOX_CONFIG_RX)
	grep -Fxq '# CONFIG_TARGET_ROOTFS_SQUASHFS is not set' .config
else
	required_config+=(CONFIG_TARGET_ROOTFS_SQUASHFS)
fi
if [ -n "$web_input" ]; then
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
wireless_entries=(usr/sbin/wpad lib/firmware/mt7628_e1.bin lib/firmware/mt7628_e2.bin)
network_entries=(sbin/swconfig sbin/fw4 usr/sbin/nft usr/sbin/dnsmasq
	usr/sbin/miniupnpd etc/init.d/miniupnpd etc/config/firewall etc/config/upnpd)
if [ -n "$web_input" ]; then
	compilers=(build_dir/target-*/linux-ramips_mt76x8/linux-*/scripts/dtc/dtc)
	[ "${#compilers[@]}" -eq 1 ] || { echo "Missing kernel device tree compiler." >&2; exit 2; }
	linux_dir=${compilers[0]%/scripts/dtc/dtc}
	"${compilers[0]}" -q -I dtb -O dts \
		"$linux_dir/../image-mt7628an_yunxm_mp716.dtb" > "$output/board.dts"
	python3 "$project/scripts/check-test-dts.py" "$output/board.dts" "$lan_candidate"
fi
if [ "$serial_rx" -eq 1 ]; then
	[ "${#initramfs[@]}" -eq 1 ] && [ "${#sysupgrade[@]}" -eq 0 ] || {
		echo "Expected only the MP716 initramfs image." >&2
		exit 2
	}
	archives=(build_dir/target-*/linux-ramips_mt76x8/linux-*/usr/initramfs_data.cpio)
	[ "${#archives[@]}" -eq 1 ] || { echo "Missing MP716 initramfs CPIO archive." >&2; exit 2; }
	staging_dir/host/bin/cpio -it < "${archives[0]}" > "$output/initramfs-files.txt"
	entries=(usr/bin/rx sbin/sysupgrade usr/libexec/validate_firmware_image "${wireless_entries[@]}" "${network_entries[@]}")
	grep -Eq '^(\./)?lib/modules/[^/]+/mt7603e\.ko(\.(xz|zst|gz))?$' "$output/initramfs-files.txt"
	name=openwrt-ramips-mt76x8-yunxm_mp716-initramfs-rx-kernel.bin
	if [ -n "$web_input" ]; then
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
	if [ -n "$web_input" ] && [ -n "${MP716_RAM_TEST_PUBLIC_KEY:-}" ]; then
		staging_dir/host/bin/cpio -i --to-stdout 'etc/mp716-upgrade/upgrade.pub' './etc/mp716-upgrade/upgrade.pub' \
			< "${archives[0]}" > "$output/ram-upgrade.pub"
		if ! cmp -s "$MP716_RAM_TEST_PUBLIC_KEY" "$output/ram-upgrade.pub"; then
			echo "The compiled RAM image has the wrong CI test public key." >&2
			exit 2
		fi
	fi
	cp "${initramfs[0]}" "$output/$name"
	cp .config "$output/openwrt.config"
	(cd "$output" && sha256sum "$name" > SHA256SUMS)
	python3 "$project/scripts/record-test-build.py" "$output" "$pin" initramfs
	exit 0
fi
[ "${#sysupgrade[@]}" -eq 1 ] && [ "${#initramfs[@]}" -eq "$((1 - lan_candidate))" ] || {
	echo "Unexpected set of MP716 target images." >&2
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
for gate in flash-gate:closed platform:unconfirmed; do
	"$unsquashfs" -offset "$offset" -cat "${sysupgrade[0]}" "etc/mp716-upgrade/${gate%:*}" |
		grep -Fxq "${gate#*:}"
done
"$unsquashfs" -offset "$offset" -ls "${sysupgrade[0]}" > "$output/rootfs-files.txt"
entries=(usr/sbin/mp716-upgraded usr/sbin/mp716-sysupgrade etc/rc.d/S95mp716-sysupgrade "${wireless_entries[@]}" "${network_entries[@]}")
grep -Eq '^squashfs-root/lib/modules/[^/]+/mt7603e\.ko(\.(xz|zst|gz))?$' "$output/rootfs-files.txt"
if [ "$lan_candidate" -eq 1 ]; then
	entries+=(etc/board.d/03_mp716_ram_web www/mp716/index.html www/cgi-bin/mp716 usr/share/mp716/httpd.uc)
	if grep -Fxq 'squashfs-root/etc/mp716-upgrade/upgrade.pub' "$output/rootfs-files.txt"; then
		echo "Unexpected test public key in the sysupgrade candidate." >&2
		exit 2
	fi
fi
for entry in "${entries[@]}"; do
	grep -Fxq "squashfs-root/$entry" "$output/rootfs-files.txt"
done
images=("${sysupgrade[@]}" "${initramfs[@]}")
cp "${images[@]}" "$output/"
cp .config "$output/openwrt.config"
names=("${images[@]##*/}")
(cd "$output" && sha256sum "${names[@]}" > SHA256SUMS)
python3 "$project/scripts/record-test-build.py" "$output" "$pin" sysupgrade
