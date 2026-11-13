#!/bin/sh
# Offline signed release. Does not flash, reboot, or contact a device.
set -eu
cd "$(dirname "$0")/.."
exec python3 scripts/release_preflight.py "$@"
