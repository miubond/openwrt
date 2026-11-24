#!/bin/sh
# Lab-only: run WireGuard on an MP716 image built without it, entirely from RAM.
# Uses the wireguard-ram-<kver>.tgz bundle exported by build-openwrt-test.sh from
# a build of the same kernel. Nothing is written to flash; a reboot undoes it.
#   wg-ram-overlay.sh load /tmp/wireguard-ram-<kver>.tgz
#   wg-ram-overlay.sh unload
#   wg-ram-overlay.sh status
set -e
B=/tmp/wgram
S=$B/wireguard-ram

die() { echo "wg-ram: $*" >&2; exit 1; }
mounted() { grep -q " $1 overlay " /proc/mounts; }
vermagic() { modinfo "$1" 2>/dev/null | sed -n 's/^vermagic:[[:space:]]*//p' | sed 's/[[:space:]]*$//'; }

overlay() {
	dir=$1 name=$2 file=$3
	mounted "$dir" && return 0
	mkdir -p "$B/ov/$name/upper" "$B/ov/$name/work"
	cp "$file" "$B/ov/$name/upper/"
	chmod 0755 "$B/ov/$name/upper/${file##*/}"
	mount -t overlay overlay -o "lowerdir=$dir,upperdir=$B/ov/$name/upper,workdir=$B/ov/$name/work" "$dir"
}

load() {
	[ -f "$1" ] || die "bundle not found: $1"
	kver=$(uname -r)
	rm -rf "$S" && mkdir -p "$B" && tar -C "$B" -xzf "$1"
	[ "$(sed -n 's/^kernel=//p' "$S/manifest")" = "$kver" ] || die "bundle kernel does not match $kver"
	want=$(sed -n 's/^vermagic=//p' "$S/manifest" | sed 's/[[:space:]]*$//')
	have=$(vermagic "/lib/modules/$kver/udp_tunnel.ko")
	[ -n "$have" ] && [ "$want" = "$have" ] || die "vermagic mismatch: bundle '$want', device '$have'"
	[ "$(vermagic "$S/modules/wireguard.ko")" = "$have" ] || die "wireguard.ko vermagic mismatch"

	: > "$B/loaded"
	if [ ! -d /sys/module/wireguard ]; then
		for pass in 1 2 3 4; do
			for ko in "$S"/modules/*.ko; do
				f=${ko##*/}; m=$(echo "${f%.ko}" | tr - _)
				[ "$m" = wireguard ] && continue
				[ -d "/sys/module/$m" ] && continue
				if [ -f "/lib/modules/$kver/$f" ]; then insmod "/lib/modules/$kver/$f" 2>/dev/null || continue
				else insmod "$ko" 2>/dev/null || continue; fi
				echo "$m" >> "$B/loaded"
			done
		done
		insmod "$S/modules/wireguard.ko" || die "insmod wireguard.ko failed (see dmesg)"
		echo wireguard >> "$B/loaded"
	fi

	overlay /usr/bin bin "$S/wg"
	overlay /lib/netifd/proto proto "$S/wireguard.sh"
	/usr/bin/wg --version >/dev/null || die "wg binary does not run"
	# netifd registers proto handlers only at startup.
	( sleep 1; /etc/init.d/network restart ) >/dev/null 2>&1 &
	echo "wg-ram: loaded; network restarting in background"
}

unload() {
	[ -z "$(uci -q get network.mp716wgc)" ] || die "disable the WireGuard client in the web UI first"
	for dir in /lib/netifd/proto /usr/bin; do
		mounted "$dir" && umount "$dir"
	done
	if [ -f "$B/loaded" ]; then
		for m in $(sed '1!G;h;$!d' "$B/loaded"); do rmmod "$m" 2>/dev/null || echo "wg-ram: keep $m (in use)"; done
	fi
	rm -rf "$B"
	( sleep 1; /etc/init.d/network restart ) >/dev/null 2>&1 &
	echo "wg-ram: unloaded; network restarting in background"
}

status() {
	echo "kernel: $(uname -r)"
	[ -d /sys/module/wireguard ] && echo "module: loaded" || echo "module: absent"
	for dir in /usr/bin /lib/netifd/proto; do mounted "$dir" && echo "overlay: $dir"; done
	[ -x /usr/bin/wg ] && /usr/bin/wg show interfaces 2>/dev/null | sed 's/^/interfaces: /' || true
}

case "$1" in
	load) load "$2" ;;
	unload) unload ;;
	status) status ;;
	*) echo "usage: $0 load BUNDLE.tgz | unload | status" >&2; exit 2 ;;
esac
