#!/bin/bash
# Compile the deployed entry points with the interpreter and imports in the image.
set -euo pipefail

image_type=$1
extractor=$(realpath -e "$2")
image=$(realpath -e "$3")
emulator=$(command -v qemu-mipsel-static)
sandbox=$(mktemp -d)
trap 'chmod -R u+rwX "$sandbox"; rm -rf -- "$sandbox"' EXIT
root="$sandbox/root"

# Only extract the compiler, its libraries, and the shipped scripts.
# Both root filesystems can contain device nodes that need privileged extraction.
compiler_paths=(lib usr/lib usr/bin/ucode usr/share/mp716)
case "$image_type" in
	initramfs)
		mkdir "$root"
		patterns=()
		for path in "${compiler_paths[@]}"; do
			patterns+=("$path" "$path/*" "./$path" "./$path/*")
		done
		(cd "$root" && "$extractor" -id --no-absolute-filenames "${patterns[@]}" < "$image")
		;;
	sysupgrade)
		"$extractor" -no-progress -d "$root" -offset "$4" "$image" "${compiler_paths[@]}"
		;;
	*)
		echo "Unknown MP716 image type: $image_type" >&2
		exit 2
		;;
esac

# Keep the emulator and bytecode inside the disposable extraction. chroot
# lets the target compiler resolve absolute imports and load its own musl.
install -d -m 755 "$root/mp716-ci"
install -m 755 "$emulator" "$root/mp716-ci/qemu-mipsel-static"
install -d -m 777 "$root/mp716-ci/output"
entrypoints=(
	httpd admin-tick firmware-boot-confirm apply-task system-apply
	vpn-render vpn-hook vpn-health wg-health
)
for entry in "${entrypoints[@]}"; do
	echo "Compile $image_type /usr/share/mp716/$entry.uc"
	sudo chroot --userspec=65534:65534 "$root" /mp716-ci/qemu-mipsel-static /usr/bin/ucode \
		-c -s -o "/mp716-ci/output/$entry.ucb" "/usr/share/mp716/$entry.uc"
	test -s "$root/mp716-ci/output/$entry.ucb"
done
echo "ucode compile passed ($image_type, ${#entrypoints[@]} entry points)"
