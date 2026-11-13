"""Deterministic MP716UPD container.

Layout, little-endian:
  0   magic[8]           MP716UPD
  8   format_version     u32 = 1
  12  header_size        u32 = 64
  16  manifest_size      u32
  20  payload_size       u32
  24  flags              u32 = 0
  28  reserved[36]       zeros
  64  manifest bytes
  ..  payload
  ..  Ed25519 signature[64]

The signed message is header || manifest || SHA-256(payload). The payload
itself is not copied into the signed buffer.
"""

from __future__ import annotations

import hashlib
import struct
from dataclasses import dataclass

MAGIC = b"MP716UPD"
FORMAT_VERSION = 1
HEADER_BYTES = 64
SIGNATURE_BYTES = 64
MANIFEST_MAX = 8192
FIRMWARE_OFFSET = 0x00050000
FIRMWARE_BYTES = 0x007B0000
HISTORICAL_SQUASHFS_OFFSET = 0x0012DB89
UPLOAD_RESERVE_BYTES = 8 * 1024 * 1024
VERIFY_RESERVE_BYTES = 2 * 1024 * 1024
IO_CHUNK = 4096

IH_MAGIC = 0x27051956
IH_OS_LINUX = 5
IH_ARCH_MIPS = 5
IH_TYPE_KERNEL = 2
IH_COMP_LZMA = 3
SQUASHFS_MAGIC = b"hsqs"
SQUASHFS_MAJOR = 4
SQUASHFS_XZ = 4


class ImageError(Exception):
    def __init__(self, code: int, error: str, detail: str = ""):
        super().__init__(detail or error)
        self.code = code
        self.error = error
        self.detail = detail or error


def error_table() -> dict[str, int]:
    from pathlib import Path

    text = (Path(__file__).resolve().parents[1] / "shared" / "error_codes.h").read_text(encoding="utf-8")
    found: dict[str, int] = {}
    for line in text.splitlines():
        line = line.strip().rstrip(",")
        if not line.startswith("MP716_"):
            continue
        name, value = line.split("=", 1)
        found[name.strip()] = int(value.strip().rstrip(","))
    return found


CODES = None


def code(name: str) -> int:
    global CODES
    if CODES is None:
        raw = error_table()
        CODES = {key.removeprefix("MP716_ERR_").lower() if key != "MP716_OK" else "ok": value for key, value in raw.items()}
        CODES["ok"] = raw["MP716_OK"]
    return CODES[name]


def pack_header(manifest_size: int, payload_size: int) -> bytes:
    if manifest_size <= 0 or manifest_size > MANIFEST_MAX:
        raise ImageError(code("size"), "size", "manifest length is outside 1..8192")
    if payload_size <= 0 or payload_size > FIRMWARE_BYTES:
        raise ImageError(code("size"), "size", "payload length is outside the firmware partition")
    total = HEADER_BYTES + manifest_size + payload_size + SIGNATURE_BYTES
    if total > 0xFFFFFFFF:
        raise ImageError(code("overflow"), "overflow", "container length does not fit in 32 bits")
    header = bytearray(HEADER_BYTES)
    header[0:8] = MAGIC
    struct.pack_into("<IIIII", header, 8, FORMAT_VERSION, HEADER_BYTES, manifest_size, payload_size, 0)
    return bytes(header)


def parse_header(header: bytes) -> dict:
    if len(header) != HEADER_BYTES:
        raise ImageError(code("truncated"), "truncated", "header is short")
    if header[0:8] != MAGIC:
        raise ImageError(code("magic"), "magic", "magic is not MP716UPD")
    version, header_size, manifest_size, payload_size, flags = struct.unpack_from("<IIIII", header, 8)
    if version != FORMAT_VERSION:
        raise ImageError(code("version"), "version", "unsupported format version")
    if header_size != HEADER_BYTES or flags != 0 or header[28:] != b"\x00" * 36:
        raise ImageError(code("format"), "format", "header flags or reserved bytes are not zero")
    total = HEADER_BYTES + manifest_size + payload_size + SIGNATURE_BYTES
    if total > 0xFFFFFFFF:
        raise ImageError(code("overflow"), "overflow", "declared lengths overflow")
    if manifest_size == 0 or manifest_size > MANIFEST_MAX:
        raise ImageError(code("size"), "size", "manifest length is not allowed")
    if payload_size == 0 or payload_size > FIRMWARE_BYTES:
        raise ImageError(code("size"), "size", "payload length is not allowed")
    return {
        "format_version": version,
        "header_size": header_size,
        "manifest_size": manifest_size,
        "payload_size": payload_size,
        "flags": flags,
        "total_size": total,
    }


def signing_message(header: bytes, manifest: bytes, payload_sha256: bytes) -> bytes:
    if len(header) != HEADER_BYTES or len(payload_sha256) != 32:
        raise ImageError(code("format"), "format", "signing input is the wrong length")
    if len(manifest) > MANIFEST_MAX:
        raise ImageError(code("size"), "size", "manifest is too large to sign")
    return header + manifest + payload_sha256


def sha256_stream(read, size: int) -> tuple[bytes, bytes]:
    """Hash exactly `size` bytes. Returns (digest, first_bytes_up_to_64)."""
    digest = hashlib.sha256()
    remaining = size
    first = bytearray()
    while remaining:
        chunk = read(min(IO_CHUNK, remaining))
        if not chunk:
            raise ImageError(code("truncated"), "truncated", "payload ended early")
        if len(chunk) > remaining:
            raise ImageError(code("format"), "format", "reader returned more than requested")
        digest.update(chunk)
        if len(first) < 64:
            first.extend(chunk[: 64 - len(first)])
        remaining -= len(chunk)
    return digest.digest(), bytes(first)


@dataclass
class PayloadStructure:
    kernel_size: int
    kernel_crc_ok: bool
    uimage_name: str
    compression: int
    squashfs_offset: int
    squashfs_compression: int
    squashfs_major: int
    squashfs_bytes_used: int
    historical_offset_match: bool
    lzma_dictionary: int


def inspect_payload(payload: bytes) -> PayloadStructure:
    """Structural check of a vendor-compatible payload. `payload` may be a
    small test image. The device verifier streams the same rules."""
    if len(payload) < 64 + 13 + 96:
        raise ImageError(code("uimage"), "uimage", "payload is too small for a kernel and rootfs")
    header = payload[:64]
    magic = struct.unpack_from(">I", header, 0)[0]
    if magic != IH_MAGIC:
        raise ImageError(code("uimage"), "uimage", "uImage magic is missing")
    stored_hcrc = struct.unpack_from(">I", header, 4)[0]
    zeroed = bytearray(header)
    zeroed[4:8] = b"\x00\x00\x00\x00"
    import binascii

    actual_hcrc = binascii.crc32(zeroed) & 0xFFFFFFFF
    if actual_hcrc != stored_hcrc:
        raise ImageError(code("uimage"), "uimage", "uImage header CRC does not match")
    ih_size = struct.unpack_from(">I", header, 12)[0]
    ih_dcrc = struct.unpack_from(">I", header, 24)[0]
    os_id, arch, image_type, comp = header[28], header[29], header[30], header[31]
    name = header[32:64].split(b"\x00", 1)[0].decode("ascii", "replace")
    if os_id != IH_OS_LINUX or arch != IH_ARCH_MIPS or image_type != IH_TYPE_KERNEL:
        raise ImageError(code("uimage"), "uimage", "uImage is not a MIPS Linux kernel")
    if comp != IH_COMP_LZMA:
        raise ImageError(code("uimage"), "uimage", "uImage compression is not LZMA")
    if ih_size < 13 or 64 + ih_size + 96 > len(payload):
        raise ImageError(code("uimage"), "uimage", "kernel length does not leave room for SquashFS")
    kernel = payload[64 : 64 + ih_size]
    if (binascii.crc32(kernel) & 0xFFFFFFFF) != ih_dcrc:
        raise ImageError(code("uimage"), "uimage", "kernel CRC does not match")
    dictionary = _lzma_dictionary(kernel[:13])
    offset = payload.find(SQUASHFS_MAGIC, 64 + ih_size)
    if offset < 0:
        raise ImageError(code("rootfs"), "rootfs", "SquashFS magic was not found after the kernel")
    return _squashfs_at(payload, offset, ih_size, name, dictionary)


def _lzma_dictionary(prefix: bytes) -> int:
    if len(prefix) < 5:
        raise ImageError(code("uimage"), "uimage", "LZMA header is short")
    props = prefix[0]
    lc = props % 9
    rest = props // 9
    lp = rest % 5
    pb = rest // 5
    if pb > 4 or lc + lp > 4:
        raise ImageError(code("uimage"), "uimage", "LZMA property byte is not valid")
    dictionary = struct.unpack_from("<I", prefix, 1)[0]
    if dictionary < 4096 or dictionary > 8 * 1024 * 1024 or dictionary & (dictionary - 1):
        raise ImageError(code("uimage"), "uimage", "LZMA dictionary is not an allowed power of two")
    return dictionary


def _squashfs_at(payload: bytes, offset: int, kernel_size: int, name: str, dictionary: int) -> PayloadStructure:
    if offset + 48 > len(payload):
        raise ImageError(code("rootfs"), "rootfs", "SquashFS superblock is truncated")
    magic, inodes, _mtime, block_size, _fragments = struct.unpack_from("<IIIII", payload, offset)
    compression, block_log, _flags, _ids, major, minor = struct.unpack_from("<HHHHHH", payload, offset + 20)
    _root, bytes_used = struct.unpack_from("<QQ", payload, offset + 32)
    del inodes, minor
    if magic != 0x73717368:
        raise ImageError(code("rootfs"), "rootfs", "SquashFS magic is not little-endian hsqs")
    if major != SQUASHFS_MAJOR or compression != SQUASHFS_XZ:
        raise ImageError(code("rootfs"), "rootfs", "rootfs is not SquashFS v4 XZ")
    if block_size < 4096 or block_size > 1024 * 1024 or block_size & (block_size - 1):
        raise ImageError(code("rootfs"), "rootfs", "SquashFS block size is not valid")
    if block_log != block_size.bit_length() - 1:
        raise ImageError(code("rootfs"), "rootfs", "SquashFS block_log does not match block size")
    if bytes_used < 96 or offset + bytes_used > len(payload):
        raise ImageError(code("rootfs"), "rootfs", "SquashFS bytes_used does not fit in the payload")
    import binascii

    kernel = payload[64 : 64 + kernel_size]
    return PayloadStructure(
        kernel_size=kernel_size,
        kernel_crc_ok=(binascii.crc32(kernel) & 0xFFFFFFFF) == struct.unpack_from(">I", payload, 24)[0],
        uimage_name=name,
        compression=IH_COMP_LZMA,
        squashfs_offset=offset,
        squashfs_compression=compression,
        squashfs_major=major,
        squashfs_bytes_used=bytes_used,
        historical_offset_match=offset == HISTORICAL_SQUASHFS_OFFSET,
        lzma_dictionary=dictionary,
    )
