#!/bin/bash
# Build a TEST image from a dedicated Linux checkout. This script only touches build files.
set -euo pipefail

project=$(cd "$(dirname "$0")/.." && pwd -P)
pin=$(cat "$project/config/openwrt.commit")

serial_rx=0
web_input=""
lan_candidate=0
test_public_key=${MP716_TEST_PUBLIC_KEY:-${MP716_RAM_TEST_PUBLIC_KEY:-}}
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
if [ -n "$web_input" ]; then
	./scripts/feeds install pptpd xl2tpd openvpn-mbedtls strongswan-isakmp wireguard-tools
	python3 "$project/scripts/prepare-native-services.py" "$tree"
	export MP716_DISABLED_SERVICES='pptpd xl2tpd openvpn ipsec'
fi

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
	if [ "$lan_candidate" -eq 1 ] && [ -z "$test_public_key" ]; then
		[ ! -e files/etc/mp716-upgrade/upgrade.pub ] || { echo "Use a checkout without a staged test key." >&2; exit 2; }
		stage_args+=(--no-test-key)
	else
		if [ "$lan_candidate" -eq 0 ]; then
			cat "$project/integration/ram-web/ram-web.dtsi" >> target/linux/ramips/dts/mt7628an_yunxm_mp716.dts
		fi
		if [ -n "$test_public_key" ]; then
			stage_args+=(--test-public-key "$test_public_key")
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
CONFIG_BUSYBOX_CUSTOM=y
CONFIG_BUSYBOX_CONFIG_SETSID=y
CONFIG_BUSYBOX_CONFIG_TIMEOUT=y
CONFIG_BUSYBOX_CONFIG_PING=y
CONFIG_BUSYBOX_CONFIG_FEATURE_FANCY_PING=y
CONFIG_BUSYBOX_CONFIG_TRACEROUTE=y
CONFIG_BUSYBOX_CONFIG_NSLOOKUP=y
CONFIG_PACKAGE_ppp=y
CONFIG_PACKAGE_ppp-mod-pptp=y
CONFIG_PACKAGE_ppp-mod-pppoe=y
CONFIG_PACKAGE_pptpd=y
CONFIG_PACKAGE_xl2tpd=y
CONFIG_PACKAGE_openvpn-mbedtls=y
CONFIG_PACKAGE_strongswan=y
CONFIG_PACKAGE_strongswan-isakmp=y
CONFIG_PACKAGE_strongswan-mod-kdf=y
CONFIG_PACKAGE_strongswan-mod-sha2=y
CONFIG_PACKAGE_kmod-nft-xfrm=y
CONFIG_PACKAGE_kmod-wireguard=m
CONFIG_PACKAGE_wireguard-tools=m
CONFIG
fi
make defconfig 2>&1 | tee "$output/defconfig.log"
# Preserve the resolved configuration even if a required dependency was dropped.
cp .config "$output/openwrt.config"
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
		CONFIG_PACKAGE_ucode-mod-fs CONFIG_PACKAGE_ucode-mod-ubus CONFIG_PACKAGE_ucode-mod-uci
		CONFIG_BUSYBOX_CONFIG_SETSID CONFIG_BUSYBOX_CONFIG_TIMEOUT CONFIG_BUSYBOX_CONFIG_TRACEROUTE
		CONFIG_BUSYBOX_CONFIG_PING CONFIG_BUSYBOX_CONFIG_FEATURE_FANCY_PING CONFIG_BUSYBOX_CONFIG_NSLOOKUP
		CONFIG_PACKAGE_ppp CONFIG_PACKAGE_ppp-mod-pptp CONFIG_PACKAGE_ppp-mod-pppoe CONFIG_PACKAGE_ppp-mod-pppol2tp
		CONFIG_PACKAGE_pptpd CONFIG_PACKAGE_xl2tpd CONFIG_PACKAGE_openvpn-mbedtls
		CONFIG_PACKAGE_strongswan CONFIG_PACKAGE_strongswan-isakmp CONFIG_PACKAGE_strongswan-mod-kdf CONFIG_PACKAGE_strongswan-mod-sha2
		CONFIG_PACKAGE_strongswan-charon CONFIG_PACKAGE_strongswan-ipsec CONFIG_PACKAGE_strongswan-mod-stroke
		CONFIG_PACKAGE_kmod-ppp CONFIG_PACKAGE_kmod-pptp CONFIG_PACKAGE_kmod-pppoe
		CONFIG_PACKAGE_kmod-pppol2tp CONFIG_PACKAGE_kmod-mppe CONFIG_PACKAGE_kmod-tun
		CONFIG_PACKAGE_kmod-ipsec CONFIG_PACKAGE_kmod-ipsec4 CONFIG_PACKAGE_kmod-nft-xfrm)
fi
for required in "${required_config[@]}"; do
	grep -Fxq "$required=y" .config || { echo "Missing build configuration: $required" >&2; exit 2; }
done
for required in CONFIG_PACKAGE_kmod-wireguard CONFIG_PACKAGE_wireguard-tools; do
	grep -Fxq "$required=m" .config || { echo "Missing build configuration: $required=m" >&2; exit 2; }
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
# BEGIN NATIVE ROOTFS CLOSURE
# Inspect the final CPIO and SquashFS with the same dependency contract. Package
# selection alone cannot prove that an overlay, plugin or rc.d policy was shipped.
native_entries=(usr/sbin/uhttpd sbin/rpcd usr/bin/ucode usr/bin/jsonfilter
	usr/lib/ucode/fs.so usr/lib/ucode/ubus.so usr/lib/ucode/uci.so
	www/mp716/index.html www/cgi-bin/mp716
	etc/init.d/mp716-admin etc/init.d/mp716-vpn
	etc/rc.d/S18mp716-admin etc/rc.d/S59mp716-vpn
	etc/uci-defaults/98-mp716-admin etc/mp716-build.version
	lib/upgrade/keep.d/mp716-admin usr/share/rpcd/acl.d/mp716.json
	usr/sbin/mp716-package-verify usr/sbin/mp716-upgraded usr/sbin/mp716-dhcp-discover
	etc/board.d/03_mp716_ram_web
	usr/sbin/pppd usr/sbin/pptpd usr/sbin/pptpctrl usr/sbin/xl2tpd usr/sbin/xl2tpd-control
	usr/sbin/openvpn usr/lib/ipsec/starter usr/lib/ipsec/charon usr/lib/ipsec/stroke
	lib/netifd/proto/ppp.sh lib/netifd/proto/l2tp.sh
	lib/netifd/ppp-up lib/netifd/ppp-down etc/ppp/options.pptp etc/ppp/chap-secrets)
for module in httpd admin admin-state admin-tick apply-task network-values system-values dispatch capabilities \
	system-admin system-apply diagnostics vpn vpn-config vpn-runtime vpn-render vpn-hook vpn-services vpn-health; do
	native_entries+=("usr/share/mp716/$module.uc")
done
native_entries+=(usr/share/mp716/native-routes.json)
for hook in diagnostic-worker vpn-ppp-up vpn-ppp-down vpn-openvpn-up vpn-openvpn-down; do
	native_entries+=("usr/share/mp716/$hook.sh")
done
native_patterns=()
for plugin in pptp pppoe pppol2tp; do
	native_patterns+=("usr/lib/pppd/[^/]+/$plugin\\.so")
done
# strongswan-isakmp's dependency closure plus the explicitly selected KDF/SHA2.
for plugin in nonce aes des gmpdh hmac kdf kernel-netlink md5 mgf1 pubkey random sha1 sha2 socket-default stroke updown; do
	native_entries+=("usr/lib/ipsec/plugins/libstrongswan-$plugin.so" "etc/strongswan.d/charon/$plugin.conf")
done
for module in ppp_generic ppp_async pppox pppoe pptp ppp_mppe gre ip_gre \
	l2tp_core l2tp_netlink l2tp_ppp tun xfrm_user esp4 nft_xfrm; do
	native_patterns+=("lib/modules/[^/]+/$module\\.ko(\\.(xz|zst|gz))?")
done
check_native_rootfs() {
	local listing="$1" prefix="$2" entry pattern
	for entry in "${native_entries[@]}"; do
		grep -Fxq "$prefix$entry" "$listing" || {
			echo "Missing native rootfs entry: $entry" >&2; return 2;
		}
	done
	for pattern in "${native_patterns[@]}"; do
		grep -Eq "^$prefix$pattern$" "$listing" || {
			echo "Missing native rootfs dependency: $pattern" >&2; return 2;
		}
	done
	if grep -Eq "^${prefix}etc/rc.d/[SK][0-9]+(pptpd|xl2tpd|openvpn|ipsec)$" "$listing"; then
		echo 'Stock VPN service autostart conflicts with mp716-vpn ownership.' >&2; return 2
	fi
}
# END NATIVE ROOTFS CLOSURE
# WireGuard is built as packages (=m) so the images stay unchanged. Its files are
# exported as a RAM-only bundle for scripts/wg-ram-overlay.sh on a running image
# of the same kernel; nothing from it is written to flash.
stage_ko() {
	local src=$1 dest=$2
	case "$src" in
		*.ko) cp "$src" "$dest" ;;
		*.ko.xz) xz -dc "$src" >"$dest" ;;
		*.ko.zst) zstd -dc "$src" >"$dest" ;;
		*.ko.gz) gzip -dc "$src" >"$dest" ;;
		*) return 1 ;;
	esac
}
export_wireguard_ram_bundle() {
	local target_dir linux_dir kver stage name file
	target_dir=$(find build_dir -maxdepth 1 -type d -name 'target-*' 2>/dev/null | LC_ALL=C sort | head -n1)
	[ -n "$target_dir" ] || { echo "Missing target build directory." >&2; return 2; }
	linux_dir=$(find "$target_dir/linux-ramips_mt76x8" -maxdepth 1 -type d -name 'linux-*' 2>/dev/null | LC_ALL=C sort | head -n1)
	[ -n "$linux_dir" ] || { echo "Missing kernel build directory under $target_dir/linux-ramips_mt76x8." >&2; return 2; }
	kver=$(sed -n 's/^# Linux\/mips \([^ ]*\) Kernel Configuration$/\1/p' "$linux_dir/.config")
	[ -n "$kver" ] || kver=$(basename "$linux_dir" | sed 's/^linux-//')
	stage="$output/wireguard-ram"
	rm -rf "$stage" && mkdir -p "$stage/modules"
	file=$(find "$target_dir" -type f \( \
		-path '*/.pkgdir/kmod-wireguard*/lib/modules/*' -o \
		-path '*/ipkg-*/kmod-wireguard/lib/modules/*' \) \
		\( -name wireguard.ko -o -name wireguard.ko.xz -o -name wireguard.ko.zst -o -name wireguard.ko.gz \) \
		2>/dev/null | head -n1)
	[ -n "$file" ] && stage_ko "$file" "$stage/modules/wireguard.ko" || {
		echo "Missing packaged wireguard.ko (searched under $target_dir)." >&2; return 2; }
	for name in libcurve25519-generic chacha20poly1305 libchacha20poly1305 poly1305-mips chacha-mips \
		udp_tunnel ip6_udp_tunnel blake2s-generic; do
		file=$(find "$target_dir" -type f -path "*/lib/modules/$kver/$name.ko" 2>/dev/null | head -n1)
		[ -z "$file" ] && file=$(find "$target_dir" -type f \
			\( -path "*/lib/modules/$kver/$name.ko.xz" -o -path "*/lib/modules/$kver/$name.ko.zst" \
			-o -path "*/lib/modules/$kver/$name.ko.gz" \) 2>/dev/null | head -n1)
		[ -z "$file" ] && continue
		[ -f "$stage/modules/$name.ko" ] || stage_ko "$file" "$stage/modules/$name.ko" || true
	done
	file=$(find "$target_dir" -type f \( \
		-path '*/.pkgdir/wireguard-tools/usr/bin/wg' -o \
		-path '*/ipkg-*/wireguard-tools/usr/bin/wg' -o \
		-path '*/.pkgdir/wireguard-tools/usr/sbin/wg' \) 2>/dev/null | head -n1)
	[ -n "$file" ] && cp "$file" "$stage/wg" || { echo "Missing packaged /usr/bin/wg." >&2; return 2; }
	file=$(find "$target_dir" -type f \( \
		-path '*/.pkgdir/wireguard-tools/lib/netifd/proto/wireguard.sh' -o \
		-path '*/.pkgdir/wireguard-tools-*/lib/netifd/proto/wireguard.sh' -o \
		-path '*/ipkg-*/wireguard-tools/lib/netifd/proto/wireguard.sh' \) 2>/dev/null | head -n1)
	[ -n "$file" ] && cp "$file" "$stage/wireguard.sh" || { echo "Missing packaged wireguard.sh." >&2; return 2; }
	grep -E '^CONFIG_[A-Z0-9_]+=y$' "$linux_dir/.config" | LC_ALL=C sort > "$stage/kernel-builtin.config"
	{
		echo "kernel=$kver"
		if command -v modinfo >/dev/null 2>&1; then
			echo "vermagic=$(modinfo "$stage/modules/wireguard.ko" | sed -n 's/^vermagic:[[:space:]]*//p' | sed 's/[[:space:]]*$//')"
		else
			echo "vermagic=$(grep -ao 'vermagic=[^[:cntrl:]]*' "$stage/modules/wireguard.ko" | head -n1 | cut -d= -f2-)"
		fi
		echo "builtin_config_sha256=$(sha256sum < "$stage/kernel-builtin.config" | cut -d' ' -f1)"
		echo "modules=$(cd "$stage/modules" && ls -1 | tr '\n' ' ')"
	} > "$stage/manifest"
	tar -C "$output" -czf "$output/wireguard-ram-$kver.tgz" wireguard-ram
	rm -rf "$stage"
}
export_wireguard_ram_bundle || { echo "WireGuard RAM bundle export failed." >&2; exit 2; }
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
		entries+=(etc/mp716-upgrade/upgrade.pub)
		name=openwrt-ramips-mt76x8-yunxm_mp716-initramfs-ram-web-kernel.bin
	fi
	for entry in "${entries[@]}"; do
		grep -Eq "^(\\./)?$entry$" "$output/initramfs-files.txt" || {
			echo "Missing initramfs entry: $entry" >&2
			exit 2
		}
	done
	if [ -n "$web_input" ]; then
		# CPIO implementations may prefix relative entries with ./.
		sed 's@^\./@@' "$output/initramfs-files.txt" > "$output/native-rootfs-files.txt"
		check_native_rootfs "$output/native-rootfs-files.txt" ''
	fi
	if [ -n "$web_input" ] && [ -n "$test_public_key" ]; then
		staging_dir/host/bin/cpio -i --to-stdout 'etc/mp716-upgrade/upgrade.pub' './etc/mp716-upgrade/upgrade.pub' \
			< "${archives[0]}" > "$output/ram-upgrade.pub"
		if ! cmp -s "$test_public_key" "$output/ram-upgrade.pub"; then
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
	check_native_rootfs "$output/rootfs-files.txt" 'squashfs-root/'
	if [ -n "$test_public_key" ]; then
		entries+=(etc/mp716-upgrade/upgrade.pub)
		"$unsquashfs" -offset "$offset" -cat "${sysupgrade[0]}" etc/mp716-upgrade/upgrade.pub > "$output/sysupgrade-upgrade.pub"
		cmp "$test_public_key" "$output/sysupgrade-upgrade.pub"
	elif grep -Fxq 'squashfs-root/etc/mp716-upgrade/upgrade.pub' "$output/rootfs-files.txt"; then
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
