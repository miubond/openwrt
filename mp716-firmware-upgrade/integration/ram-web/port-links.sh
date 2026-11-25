#!/bin/sh
# One swconfig read per switch port; stdout is consumed by physical-ports.uc.
for i in 0 1 2 3 4; do
	/sbin/swconfig dev switch0 port "$i" get link 2>/dev/null || true
done