#!/bin/bash
# Build and validate both MP716 images on the same CI runner.
set -euo pipefail
mkdir -p build/target-images build/ram-images build/ci-logs
FIRMWARE_VERSION=$(cat config/firmware.version)
WEB_VERSION=$(node -p 'require("./web/package.json").version')
sed -e "s/^installed_custom_firmware=.*/installed_custom_firmware=$FIRMWARE_VERSION/" \
  -e "s/^web_ui=.*/web_ui=$WEB_VERSION/" config/test-device.profile > build/target-device.profile
sed "s/^web_ui=.*/web_ui=$WEB_VERSION/" config/test-device.profile > build/ram-device.profile
npm ci --prefix web --no-audit --no-fund 2>&1 | tee build/ci-logs/npm-ci.log
npm test --prefix web 2>&1 | tee build/ci-logs/vue-tests.log
npm run --prefix web build:openwrt -- --outDir dist 2>&1 | tee build/ci-logs/vue-build.log
python3 scripts/prepare-ci-test-key.py
trap 'rm -f build/ci-release/ci-test.priv' EXIT
TIMEFORMAT='LAN sysupgrade elapsed: %3R s'
{ time MP716_TEST_PUBLIC_KEY="$PWD/build/ci-release/upgrade.pub" \
  bash scripts/build-openwrt-cached.sh --lan-candidate web/dist \
  build/target-device.profile build/target-images; } 2>&1 | tee build/ci-logs/sysupgrade.log
(cd build/target-images && sha256sum -c SHA256SUMS)
TIMEFORMAT='RAM initramfs elapsed: %3R s'
{ time MP716_TEST_PUBLIC_KEY="$PWD/build/ci-release/upgrade.pub" \
  bash scripts/build-openwrt-cached.sh --ram-web web/dist \
  build/ram-device.profile build/ram-images; } 2>&1 | tee build/ci-logs/initramfs.log
(cd build/ram-images && sha256sum -c SHA256SUMS)
set -- build/target-images/*-yunxm_mp716-squashfs-sysupgrade.bin
test "$#" -eq 1
cp "$1" build/payload.bin
trap - EXIT
