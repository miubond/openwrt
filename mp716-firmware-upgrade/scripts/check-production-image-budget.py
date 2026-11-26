#!/usr/bin/env python3
"""Fail CI when release images exceed MP716 production flash budget."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from packer.size_budget import check_mp716upd, check_sysupgrade_image


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    parser.add_argument(
        "--strict-target",
        action="store_true",
        help="Treat exceed PRODUCTION_TARGET as failure (default: warn only)",
    )
    args = parser.parse_args()
    path = args.artifact
    if not path.is_file():
        print(f"Missing: {path}", file=sys.stderr)
        return 2
    name = path.name.lower()
    if name.endswith(".mp716upd"):
        result = check_mp716upd(path)
    else:
        result = check_sysupgrade_image(path)
    if not result.ok:
        print(result.reason, file=sys.stderr)
        print(
            f"  container={result.container_bytes} payload={result.payload_bytes} flash_span={result.flash_image_bytes}",
            file=sys.stderr,
        )
        return 1
    if args.strict_target and result.reason.startswith("warn:"):
        print(result.reason, file=sys.stderr)
        return 1
    print(
        f"{path.name}: {result.reason} "
        f"container={result.container_bytes} payload={result.payload_bytes} flash_span={result.flash_image_bytes}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())