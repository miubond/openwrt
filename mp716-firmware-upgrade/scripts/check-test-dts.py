#!/usr/bin/env python3
"""Validate the compiled device tree for either MP716 LAN test profile."""

import re
import sys
from pathlib import Path


def node_body(board, name):
    match = re.search(rf"^\s*{re.escape(name)}\s*\{{([^{{}}]*)", board, re.MULTILINE)
    if not match:
        raise ValueError(f"Missing MP716 device tree node: {name}")
    return match[1]


def verify_device_tree(board, *, candidate):
    for node, status in {
        "spi@b00": "okay" if candidate else "disabled",
        "ethernet@10100000": "okay",
        "esw@10110000": "okay",
        "wmac@10300000": "disabled",
        "gpio@600": "disabled",
        "uart0@c00": "okay",
    }.items():
        if f'status = "{status}";' not in node_body(board, node):
            raise ValueError(f"Expected {node} status {status}")
    if not re.search(r'compatible\s*=\s*"yunxm,mp716(?:\\0|")', board):
        raise ValueError("Invalid MP716 compatible")
    if 'serial0 = "/palmbus@10000000/uart0@c00";' not in node_body(board, "aliases") or \
            'bootargs = "console=ttyS0,57600";' not in node_body(board, "chosen"):
        raise ValueError("Expected the MT7628 UART0 console")

    for name, offset, size in (
        ("u-boot", 0x00000, 0x30000),
        ("config", 0x30000, 0x10000),
        ("factory", 0x40000, 0x10000),
        ("firmware", 0x50000, 0x7B0000),
    ):
        partition = node_body(board, f"partition@{offset:x}")
        reg = re.search(r"\breg\s*=\s*<([^>]+)>;", partition)
        if f'label = "{name}";' not in partition or not reg or \
                tuple(int(value, 0) for value in reg[1].split()) != (offset, size):
            raise ValueError(f"Unexpected {name} partition range at 0x{offset:x}")
        if name != "firmware" and "read-only;" not in partition:
            raise ValueError(f"Expected read-only {name} partition at 0x{offset:x}")


if __name__ == "__main__":
    verify_device_tree(Path(sys.argv[1]).read_text(encoding="utf-8"), candidate=sys.argv[2] == "1")
