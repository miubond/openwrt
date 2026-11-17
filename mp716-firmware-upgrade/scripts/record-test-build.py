#!/usr/bin/env python3
"""Record the validated MP716 outputs without implying hardware acceptance."""

import hashlib
import json
from pathlib import Path
import sys


def record(output, commit, profile):
    images = []
    for line in (output / "SHA256SUMS").read_text(encoding="ascii").splitlines():
        expected, name = line.split("  ", 1)
        data = (output / name).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != expected:
            raise ValueError(f"SHA-256 mismatch: {name}")
        images.append({"name": name, "bytes": len(data), "sha256": digest})
    if not images:
        raise ValueError("Missing firmware images")
    report = {
        "project": "mp716-firmware",
        "openwrt_commit": commit,
        "profile": profile,
        "images": images,
        "static_checks_passed": True,
        "hardware_validated": False,
        "flash_write": False,
        "vendor_web_upgrade_verified": False,
    }
    (output / "build-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    record(Path(sys.argv[1]), sys.argv[2], sys.argv[3])
