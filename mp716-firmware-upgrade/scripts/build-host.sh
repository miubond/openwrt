#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 scripts/build_host.py
