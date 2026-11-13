#!/usr/bin/env python3
"""Plan a TEST tree for OpenWrt v25.12.6. This command never compiles or flashes."""

from __future__ import annotations

import sys

PIN = "64900e756efa667774214f9c6b17c113222e01f7"
REFUSED = ("--release", "--force", "-f", "factory-mtd", "allow-flash-upgrade")


def main(argv: list[str]) -> int:
    joined = " ".join(argv).lower()
    if any(token in joined for token in REFUSED):
        print("refusing release build, force flag, or factory MTD input", file=sys.stderr)
        return 24
    print("status=TEST")
    print("commit=" + PIN)
    print("tree=not-checked-out")
    print("compiler=unavailable-on-this-windows-host")
    print("initramfs=not-built")
    print("sysupgrade=not-built")
    print("flash_write=false")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
