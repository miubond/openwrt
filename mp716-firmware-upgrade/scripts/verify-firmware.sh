#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec python3 packer/mp716_fwverify.py "$@"
