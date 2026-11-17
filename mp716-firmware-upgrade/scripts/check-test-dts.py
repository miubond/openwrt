#!/usr/bin/env python3
"""Validate the compiled device tree for either MP716 LAN test profile."""

import re
import sys
from pathlib import Path


def verify_device_tree(board, *, candidate):
    for node, status in {
        "spi@b00": "okay" if candidate else "disabled",
        "ethernet@10100000": "okay",
        "esw@10110000": "okay",
        "wmac@10300000": "disabled",
    }.items():
        match = re.search(rf"^\s*{re.escape(node)}\s*\{{([^{{}}]*)", board, re.MULTILINE)
        if not match or f'status = "{status}";' not in match[1]:
            raise ValueError(f"Expected {node} status {status}")
    if not re.search(r'compatible\s*=\s*"yunxm,mp716(?:\\0|")', board):
        raise ValueError("Invalid MP716 compatible")
    for name, offset in {"u-boot": 0, "u-boot-env": 0x30000, "factory": 0x40000}.items():
        node = re.search(rf"partition@{offset:x}\s*\{{([^{{}}]*)", board)
        if not node or f'label = "{name}";' not in node[1] or "read-only;" not in node[1]:
            raise ValueError(f"Expected read-only {name} partition at 0x{offset:x}")
    firmware = re.search(r"partition@50000\s*\{([^{}]*)", board)
    if not firmware or not re.search(r"reg\s*=\s*<0x50000\s+0x7b0000>;", firmware[1]):
        raise ValueError("Expected the MP716 0x7b0000-byte firmware range")


if __name__ == "__main__":
    verify_device_tree(Path(sys.argv[1]).read_text(encoding="utf-8"), candidate=sys.argv[2] == "1")
