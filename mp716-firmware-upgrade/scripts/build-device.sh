#!/bin/sh
# Compile for the vendor userspace. This script does not upload or flash.
set -eu
cd "$(dirname "$0")/.."
if [ -z "${CROSS_COMPILE:-}" ]; then
  echo "CROSS_COMPILE is not set; refusing to guess a toolchain" >&2
  exit 2
fi
make -C device clean all CC="${CROSS_COMPILE}gcc"
echo "cross compile finished; binary was not executed and flash was not written"
