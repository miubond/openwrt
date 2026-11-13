#!/bin/sh
# Copy the upgrade worker into tmpfs and execute it. This script does not
# erase flash. apply without --backend fake is refused by the worker.
set -eu
if [ ! -x /usr/sbin/mp716-upgraded ]; then
  echo "mp716-upgraded is not installed" >&2
  exit 1
fi
mkdir -p /tmp/mp716-upgrade
cp /usr/sbin/mp716-upgraded /tmp/mp716-upgraded
exec /tmp/mp716-upgraded "$@"
