#!/bin/bash
# Sign and verify a CI-only container using a disposable test key.
set -euo pipefail
ARTIFACT_DIR=${1:?Missing absolute CI artifact directory}
mkdir -p "$ARTIFACT_DIR"
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
python3 - <<'PY'
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from tests.support.images import uimage_payload
root = Path("build/ci-release")
root.mkdir(parents=True, exist_ok=True)
key = root / "ci-test.priv"
seed = Ed25519PrivateKey.generate()
key.write_bytes(seed.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()))
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
  --build-time 2026-11-13T00:00:00Z 2>&1 | tee build/ci-logs/pack-test-container.log
python3 - <<'PY'
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
seed = Path("build/ci-release/ci-test.priv").read_bytes()
pub = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes(
    serialization.Encoding.Raw, serialization.PublicFormat.Raw)
Path("build/ci-release/upgrade.pub").write_bytes(pub)
Path("build/ci-release/device.profile").write_text(
    "product=MP716\nhardware_revision=ci-lab\nbase_firmware=014\n"
    "vendor_software_version=014\ninstalled_custom_firmware=\n"
    "web_ui=1.0.0\nupgrade_engine=1.0.0\n",
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
