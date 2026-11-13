#!/bin/sh
# Offline container build. Arguments are passed to mp716-fwpack pack.
set -eu
cd "$(dirname "$0")/.."
exec python3 packer/mp716_fwpack.py pack "$@"
