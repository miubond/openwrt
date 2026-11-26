#!/usr/bin/env python3
"""Fail CI when a signed MP716UPD payload exceeds the firmware MTD budget."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from packer.size_budget import check_mp716upd


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    args = parser.parse_args()
    path = args.artifact
    if not path.is_file():
        print(f"Missing artifact: {path}", file=sys.stderr)
        return 2
    try:
        result = check_mp716upd(path)
    except (ValueError, OSError) as exc:
        print(f"inspect failed: {exc}", file=sys.stderr)
        return 1
    if not result.ok:
        print(result.reason, file=sys.stderr)
        return 1
    if result.reason.startswith("warn:"):
        print(result.reason, file=sys.stderr)
    print(
        f"ok: {path.name} container={result.container_bytes} "
        f"payload={result.payload_bytes} flash_span={result.flash_image_bytes}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())