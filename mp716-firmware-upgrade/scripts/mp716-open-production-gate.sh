#!/bin/sh
# 串口救砖演练通过后，在设备上执行以打开量产刷写门（须先人工确认 recovery-plan.md）
set -e
G=/etc/mp716-upgrade/flash-gate
P=/etc/mp716-upgrade/platform
if [ "$(cat "$G" 2>/dev/null)" = 'serial-recovery-verified' ] && [ "$(cat "$P" 2>/dev/null)" = 'confirmed' ]; then
	echo 'gate already open'
	exit 0
fi
echo 'serial-recovery-verified' > "$G"
echo 'confirmed' > "$P"
echo 'production' > /etc/mp716-upgrade/upgrade-policy
chmod 644 "$G" "$P" /etc/mp716-upgrade/upgrade-policy
rm -f /etc/mp716/allow-flash-upgrade
echo 'OK production flash gate open (upgrade-policy=production)'