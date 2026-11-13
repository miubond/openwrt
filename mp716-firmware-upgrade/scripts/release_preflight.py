#!/usr/bin/env python3
"""Offline release pack. Refuses device paths, placeholders, and flash flags."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str]) -> int:
    if "--allow-flash-upgrade" in argv or "allow-flash-upgrade" in argv:
        print("real flash upgrade is disabled", file=sys.stderr)
        return 24
    if any(arg.startswith("/dev/mtd") or "mtdblock" in arg for arg in argv):
        print("refusing a device path", file=sys.stderr)
        return 23
    key = None
    hardware = None
    out = None
    args = argv[1:]
    index = 0
    while index < len(args):
        item = args[index]
        if item in {"--private-key", "--hardware-revision", "--out"} and index + 1 < len(args):
            value = args[index + 1]
            if item == "--private-key":
                key = Path(value)
            elif item == "--hardware-revision":
                hardware = value
            else:
                out = Path(value)
            index += 2
            continue
        index += 1
    if key is None or hardware is None or out is None:
        print("release requires --private-key, --hardware-revision and --out", file=sys.stderr)
        return 1
    try:
        key.resolve().relative_to(ROOT.resolve())
        inside = True
    except ValueError:
        inside = False
    if inside:
        print("signing key must stay outside the git repository", file=sys.stderr)
        return 1
    if hardware.strip().lower() in {"validated-revision", "placeholder", "unverified", "test", "mp716"} or hardware.endswith("-test"):
        print("hardware revision is not a release value", file=sys.stderr)
        return 12
    if out.suffix != ".mp716upd":
        print("output must use the .mp716upd extension", file=sys.stderr)
        return 23
    sys.path.insert(0, str(ROOT))
    from packer.mp716_fwpack import main as pack_main

    return pack_main(["pack", *args])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
