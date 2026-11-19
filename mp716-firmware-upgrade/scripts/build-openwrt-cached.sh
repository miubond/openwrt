#!/bin/bash
# Use one stable OpenWrt checkout per host/ABI. Only CI owns the cache directory.
set -euo pipefail

if [ "$#" -ne 4 ]; then
	echo "usage: bash $0 --ram-web|--lan-candidate WEB_INPUT DEVICE_PROFILE OUTPUT_DIR" >&2
	exit 2
fi
case "$1" in
	--ram-web|--lan-candidate) ;;
	*) echo "Unsupported cached build mode: $1" >&2; exit 2 ;;
esac

project=$(cd "$(dirname "$0")/.." && pwd -P)
pin=$(cat "$project/config/openwrt.commit")
[[ "$pin" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid OpenWrt commit." >&2; exit 2; }

# Host-built tools can contain absolute paths and depend on the runner's libc.
# The shared target defaults come from build-openwrt-test.sh and the pinned tree.
key=$(
	{
		printf '%s\n' v1 ramips-mt76x8 "$pin"
		uname -sm
		cat /etc/os-release
		getconf GNU_LIBC_VERSION 2>/dev/null || true
		cc --version
		ld --version
		make --version
		sha256sum < "$project/scripts/build-openwrt-test.sh"
	} | sha256sum | cut -d ' ' -f1
)
runner_home=$(getent passwd "$(id -u)" | cut -d: -f6)
base=${MP716_OPENWRT_CACHE_DIR:-"${runner_home:?Cannot locate runner home}/.cache/mp716-firmware"}
umask 077
mkdir -p "$base"
base=$(cd "$base" && pwd -P)
cache="$base/$key"
mkdir -p "$cache"
if [ ! -O "$base" ] || [ ! -O "$cache" ] || [ -L "$cache" ]; then
	echo "OpenWrt cache directories must be owned by the runner." >&2
	exit 2
fi

# Both workflows can run on one runner. Keep the lock until image inspection
# finishes, so the second build cannot change the first build's files.
exec 9>"$cache/build.lock"
echo "Waiting for MP716 toolchain cache $key"
flock 9
tree="$cache/openwrt"
if [ -L "$tree" ] || { [ -e "$tree" ] && [ ! -O "$tree" ]; }; then
	echo "OpenWrt cache checkout must be owned by the runner and cannot be a symlink." >&2
	exit 2
fi
# BEGIN VERIFIED TOOLCHAIN CACHE
# Image/rootfs validation can fail after the toolchain is complete. Qualify
# only host tools and the cross toolchain, independently of target images.
# This EXIT handler still owns fd 9's flock and never changes the build status.
verify_toolchain_cache() {
	local probe compiler
	local compilers=("$tree"/staging_dir/toolchain-mipsel_*/bin/*-openwrt-linux-musl-gcc)
	[ "${#compilers[@]}" -eq 1 ] && [ -x "${compilers[0]}" ] || return 1
	command -v timeout >/dev/null && command -v readelf >/dev/null || return 1
	compiler=${compilers[0]}
	probe=$(mktemp -d "$cache/toolchain-probe.XXXXXX") || return 1
	cat > "$probe/check.c" <<'C'
#include <stdint.h>
#include <stdio.h>
int main(void) { uint32_t value = 716u; return printf("%u\n", (unsigned)value) < 0; }
C
	# Link against the cross libc/startup files; never run the target program.
	if timeout -s KILL 30s "$compiler" -std=c99 -Werror "$probe/check.c" -o "$probe/check.elf" &&
		LC_ALL=C readelf -h "$probe/check.elf" > "$probe/header" &&
		grep -Eq 'Class:[[:space:]]+ELF32' "$probe/header" &&
		grep -Eq 'Data:.*little endian' "$probe/header" &&
		grep -Eq 'Machine:.*MIPS' "$probe/header" &&
		grep -Eq 'Type:[[:space:]]+(EXEC|DYN)' "$probe/header"; then
		printf 'schema=1\ncache_key=%s\nformat=ELF32-LSB-MIPS\n' "$key" > "$cache/toolchain-verified.new" &&
			mv -f -- "$cache/toolchain-verified.new" "$cache/toolchain-verified"
	else
		rm -f -- "$cache/toolchain-verified" "$cache/toolchain-verified.new"
	fi
	rm -rf -- "$probe"
	[ -f "$cache/toolchain-verified" ]
}
finish_toolchain_cache() {
	local status=$1
	trap - EXIT
	set +e
	# An older marker must not authorize saving a newly broken toolchain.
	rm -f -- "$cache/toolchain-verified" "$cache/toolchain-verified.new"
	if verify_toolchain_cache; then
		echo "MP716 toolchain cache verified: $key (ELF32 LSB MIPS; image status $status)"
	else
		echo "MP716 toolchain cache not verified: $key (image status $status); cache save disabled" >&2
	fi
	exit "$status"
}
shopt -s nullglob
trap 'finish_toolchain_cache "$?"' EXIT
if [ -n "${GITHUB_OUTPUT:-}" ]; then
	printf 'toolchain-cache-marker=%s\n' "$cache/toolchain-verified" >> "$GITHUB_OUTPUT"
fi
# END VERIFIED TOOLCHAIN CACHE
shopt -s nullglob
compilers=("$tree"/staging_dir/toolchain-mipsel_*/bin/*-openwrt-linux-musl-gcc)
if { [ -f "$cache/toolchain-verified" ] || [ -f "$cache/validated" ]; } &&
	[ "${#compilers[@]}" -eq 1 ] && [ -x "${compilers[0]}" ]; then
	echo "MP716 toolchain cache hit: $key"
else
	echo "MP716 toolchain cache cold or incomplete: $key"
fi

umask 022
if [ ! -d "$tree/.git" ]; then
	git init -q "$tree"
fi
if ! git -C "$tree" cat-file -e "$pin^{commit}" 2>/dev/null; then
	git -C "$tree" fetch --depth 1 https://github.com/openwrt/openwrt.git "$pin"
fi
if [ "$(git -C "$tree" rev-parse HEAD 2>/dev/null || true)" != "$pin" ]; then
	git -C "$tree" checkout --detach "$pin"
fi

if [ -f "$tree/.config" ]; then
	# OpenWrt's clean keeps build_dir/host, build_dir/toolchain-*,
	# staging_dir/host and staging_dir/toolchain-*.
	make -C "$tree" clean
fi
# Drop generated profile files and host-side package state. In particular,
# never carry a previous build's public key into a new image.
rm -rf -- "$tree/files" "$tree/package/mp716-sysupgrade" \
	"$tree/bin/targets/ramips/mt76x8" "$tree/build_dir/hostpkg" "$tree/staging_dir/hostpkg"
git -C "$tree" restore -- target/linux/ramips/image/mt76x8.mk

bash "$project/scripts/build-openwrt-test.sh" "$1" "$2" "$tree" "$3" "$4"
touch "$cache/validated"
