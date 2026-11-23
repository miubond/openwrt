#!/bin/sh
# 串口救砖演练通过后执行；见 docs/release-hardware-closed-loop.md
set -e
G=/etc/mp716-upgrade/flash-gate
P=/etc/mp716-upgrade/platform
if [ "$(cat "$G" 2>/dev/null)" = 'serial-recovery-verified' ] && [ "$(cat "$P" 2>/dev/null)" = 'confirmed' ]; then
	echo 'gate already open'
	exit 0
fi
echo 'serial-recovery-verified' > "$G"
echo 'confirmed' > "$P"
chmod 644 "$G" "$P"
rm -f /etc/mp716/allow-flash-upgrade
echo 'OK production flash gate open'