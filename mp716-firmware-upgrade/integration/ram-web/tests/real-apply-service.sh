#!/bin/sh
# Test helper only. Install as private fixture/service.sh, never into an image.
set -eu
stage=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$stage" in /tmp/mp716-*/fixture) ;; *) exit 2 ;; esac
# Leave enough time for the caller to observe applying and reject confirmation.
/bin/busybox sleep 1
code=$(/bin/busybox sed -n '1p' "$stage/service-codes")
/bin/busybox sed '1d' "$stage/service-codes" > "$stage/service-codes.new"
/bin/busybox mv "$stage/service-codes.new" "$stage/service-codes"
case "$code" in 0|1) exit "$code" ;; *) exit 2 ;; esac
