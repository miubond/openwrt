"""Build a small vendor-compatible payload for tests.

The SquashFS offset is deliberately not the historical 0x12DB89 value.
"""

from __future__ import annotations

import binascii
import struct
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from packer.image_format import HISTORICAL_SQUASHFS_OFFSET
from packer.mp716_fwpack import build_container, build_manifest, public_from_seed


def uimage_payload() -> bytes:
    kernel = bytes([0x5D]) + struct.pack("<I", 0x10000) + struct.pack("<Q", 64) + b"\x00" * 64
    header = bytearray(64)
    struct.pack_into(">I", header, 0, 0x27051956)
    struct.pack_into(">I", header, 12, len(kernel))
    struct.pack_into(">I", header, 16, 0x80000000)
    struct.pack_into(">I", header, 20, 0x80000000)
    struct.pack_into(">I", header, 24, binascii.crc32(kernel) & 0xFFFFFFFF)
    header[28:32] = bytes((5, 5, 2, 3))
    header[32:37] = b"MP716"
    struct.pack_into(">I", header, 4, binascii.crc32(header) & 0xFFFFFFFF)
    superblock = bytearray(96)
    struct.pack_into("<I", superblock, 0, 0x73717368)
    struct.pack_into("<I", superblock, 4, 1)
    struct.pack_into("<I", superblock, 12, 131072)
    struct.pack_into("<H", superblock, 20, 4)
    struct.pack_into("<H", superblock, 22, 17)
    struct.pack_into("<H", superblock, 26, 1)
    struct.pack_into("<H", superblock, 28, 4)
    struct.pack_into("<Q", superblock, 40, 96)
    payload = bytes(header) + kernel + bytes(superblock)
    if payload.find(b"hsqs") == HISTORICAL_SQUASHFS_OFFSET:
        raise RuntimeError("test payload accidentally used the historical rootfs offset")
    return payload


def new_seed() -> bytes:
    return Ed25519PrivateKey.generate().private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )


def signed_image(payload: bytes | None = None, *, seed: bytes | None = None, enforce_structure: bool = True, **fields: object) -> tuple[bytes, bytes, bytes]:
    payload = uimage_payload() if payload is None else payload
    seed = new_seed() if seed is None else seed
    public = public_from_seed(seed)
    manifest = build_manifest(
        payload=payload,
        hardware_revision=str(fields.get("hardware_revision", "mp716-r0-test")),
        firmware_version=str(fields.get("firmware_version", "1.0.0")),
        base_firmware=str(fields.get("base_firmware", "014")),
        web_ui=str(fields.get("web_ui", "1.0.0")),
        upgrade_engine=str(fields.get("upgrade_engine", "1.0.0")),
        build_time=str(fields.get("build_time", "2026-11-13T01:02:03Z")),
        allow_downgrade=bool(fields.get("allow_downgrade", False)),
        public_key=public,
        product=str(fields.get("product", "MP716")),
        image_type=str(fields.get("image_type", "vendor-compatible")),
        custom_firmware=fields.get("custom_firmware") if isinstance(fields.get("custom_firmware"), str) else None,
    )
    manifest_bytes = fields.get("manifest_bytes")
    signature = fields.get("signature")
    blob = build_container(
        payload,
        manifest,
        seed,
        enforce_structure=enforce_structure,
        manifest_bytes=manifest_bytes if isinstance(manifest_bytes, bytes) else None,
        signature=signature if isinstance(signature, bytes) else None,
    )
    return blob, seed, public


def write_profile(path: Path, **overrides: str) -> None:
    values = {
        "product": "MP716",
        "hardware_revision": "mp716-r0-test",
        "base_firmware": "014",
        "vendor_software_version": "014",
        "installed_custom_firmware": "",
        "web_ui": "1.0.0",
        "upgrade_engine": "1.0.0",
    }
    values.update(overrides)
    path.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")


def write_meminfo(path: Path, mem_free_kib: int) -> None:
    path.write_text(f"MemFree: {mem_free_kib} kB\nBuffers: 0 kB\nCached: 0 kB\n", encoding="utf-8")
