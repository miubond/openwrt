#!/bin/bash
# Sign and verify a CI-only container using a disposable test key.
set -euo pipefail
ARTIFACT_DIR=${1:?Missing absolute CI artifact directory}
mkdir -p "$ARTIFACT_DIR" build/ci-logs
verify_report() {
  local report=$1 status
  shift
  if "$@" > "$report"; then
    cat "$report"
  else
    status=$?
    cat "$report" >&2
    return "$status"
  fi
}
if [ -d build/ram-images ]; then
  trap 'rm -f build/ci-release/ci-test.priv' EXIT
  if [ ! -f build/payload.bin ] || [ ! -f build/ci-release/ci-test.priv ] ||
     ! cmp -s build/ram-images/ram-upgrade.pub build/ci-release/upgrade.pub ||
     ! cmp -s build/target-images/sysupgrade-upgrade.pub build/ci-release/upgrade.pub; then
    echo "Missing CI payload or signing key pair matching both compiled images." >&2
    exit 2
  fi
else
  python3 scripts/prepare-ci-test-key.py
  trap 'rm -f build/ci-release/ci-test.priv' EXIT
fi
python3 - <<'PY'
from pathlib import Path
from tests.support.images import uimage_payload
payload = Path("build/payload.bin")
if not payload.exists():
    payload.write_bytes(uimage_payload())
PY
python3 packer/mp716_fwpack.py pack \
  --payload build/payload.bin \
  --private-key build/ci-release/ci-test.priv \
  --out build/ci-release/test.mp716upd \
  --hardware-revision ci-lab \
  --firmware-version "$(cat config/firmware.version)" \
  --web-ui "$(python3 -c 'import json; print(json.load(open("web/package.json"))["version"])')" \
  --build-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>&1 | tee build/ci-logs/pack-test-container.log
python3 - <<'PY'
from pathlib import Path
import json
Path("build/ci-release/device.profile").write_text(
    "product=MP716\nhardware_revision=ci-lab\nbase_firmware=014\n"
    "vendor_software_version=014\ninstalled_custom_firmware=\n"
    f"web_ui={json.loads(Path('web/package.json').read_text())['version']}\nupgrade_engine=1.0.0\n",
    encoding="utf-8")
PY
verify_report build/ci-release/verify.json \
  python3 packer/mp716_fwverify.py build/ci-release/test.mp716upd \
  --public-key build/ci-release/upgrade.pub \
  --profile build/ci-release/device.profile
audit_code=0
python3 packer/audit_vendor_image.py > build/ci-release/vendor-audit.json || audit_code=$?
cat build/ci-release/vendor-audit.json
test "$audit_code" -eq 2
rm -f build/ci-release/ci-test.priv build/payload.bin
(cd build/ci-release && sha256sum test.mp716upd > test.mp716upd.sha256)
verify_report build/ci-release/device-verify.json \
  ./build/host/mp716-upgraded check --root build/ci-release \
  --image build/ci-release/test.mp716upd
if [ -d build/target-images ]; then
  verify_report build/ci-release/stage-verify.json \
    ./build/host/mp716-upgraded check --root build/ci-release \
    --image build/ci-release/test.mp716upd --meminfo /proc/meminfo \
    --extract build/ci-release/extracted.bin \
    --pending-state build/ci-release/sysupgrade.pending
  set -- build/target-images/*-yunxm_mp716-squashfs-sysupgrade.bin
  cmp "$1" build/ci-release/extracted.bin
  cp build/target-device.profile build/ci-release/running.profile
  verify_report build/ci-release/boot-verify.json \
    ./build/host/mp716-upgraded boot-verify --root build/ci-release
  cp build/ci-release/boot-verify.json "$ARTIFACT_DIR/"
fi
cp build/ci-release/upgrade.pub "$ARTIFACT_DIR/ci-test.pub"
cp -v build/ci-release/test.mp716upd \
      build/ci-release/test.mp716upd.sha256 \
      build/ci-release/verify.json \
      build/ci-release/device-verify.json \
      build/ci-release/vendor-audit.json \
      "$ARTIFACT_DIR/"
echo "测试升级包已生成。这不是生产签名，也没有写入设备。"
