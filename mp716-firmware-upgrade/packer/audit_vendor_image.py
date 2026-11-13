#!/usr/bin/env python3
"""Offline audit of a vendor BIN. Never writes flash and never contacts a device."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

REFERENCE_SHA256 = "28b9a075a5e298159a0a49b5372659d264a8cf686c8171ef2d7dff8320e02733"
REFERENCE_NAME = "HUAYI_ZC-AP_MT7628DA_spi_8M64M_None_014_2024-11-13.bin"
HISTORICAL_SQUASHFS_OFFSET = 0x12DB89
FIRMWARE_BYTES = 0x7B0000
IH_MAGIC = 0x27051956


def audit(path: Path) -> dict:
    report = {
        "file_name": path.name,
        "reference_sha256": REFERENCE_SHA256,
        "file_found": path.is_file(),
        "computed_sha256": None,
        "hash_match": False,
        "status": "BLOCKED",
        "historical_squashfs_offset": HISTORICAL_SQUASHFS_OFFSET,
        "historical_offset_verified": False,
        "squashfs_offsets": [],
        "uimage": None,
        "size_bytes": None,
        "within_firmware_partition": None,
        "note": "Offsets from old notes are not accepted as measurements.",
    }
    if not path.is_file():
        report["note"] = "Vendor image is not in this workspace, so the reference hash was not checked."
        return report
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    report["computed_sha256"] = digest
    report["hash_match"] = digest == REFERENCE_SHA256
    report["size_bytes"] = len(data)
    report["within_firmware_partition"] = len(data) <= FIRMWARE_BYTES
    if not report["hash_match"]:
        report["status"] = "HASH_MISMATCH"
        report["note"] = "File bytes do not match the stated vendor SHA-256."
        return report
    uimages = []
    start = 0
    needle = struct.pack(">I", IH_MAGIC)
    while True:
        at = data.find(needle, start)
        if at < 0 or len(uimages) >= 8:
            break
        if at + 64 <= len(data):
            import binascii

            header = bytearray(data[at : at + 64])
            stored = struct.unpack_from(">I", header, 4)[0]
            header[4:8] = b"\x00\x00\x00\x00"
            ok = (binascii.crc32(header) & 0xFFFFFFFF) == stored
            ih_size = struct.unpack_from(">I", data, at + 12)[0]
            uimages.append({"offset": at, "header_crc_ok": ok, "ih_size": ih_size, "name": data[at + 32 : at + 64].split(b"\x00", 1)[0].decode("latin1", "replace")})
        start = at + 1
    squash = []
    start = 0
    while True:
        at = data.find(b"hsqs", start)
        if at < 0 or len(squash) >= 8:
            break
        squash.append(at)
        start = at + 1
    report["uimage"] = uimages
    report["squashfs_offsets"] = squash
    report["historical_offset_verified"] = HISTORICAL_SQUASHFS_OFFSET in squash
    report["status"] = "HASH_MATCHED"
    report["note"] = "Hash matched. SquashFS offsets were measured from this file and the historical offset was not assumed."
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mp716-audit-vendor", description="Hash and structurally inspect a vendor BIN. This command never writes flash.")
    parser.add_argument("image", nargs="?", default="")
    parser.add_argument("--json-out")
    args = parser.parse_args(argv)
    path = Path(args.image) if args.image else Path(__file__).resolve().parents[1] / "firmware" / "input" / REFERENCE_NAME
    report = audit(path)
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if args.json_out:
        Path(args.json_out).write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if report["status"] == "HASH_MATCHED" else 2


if __name__ == "__main__":
    sys.exit(main())
