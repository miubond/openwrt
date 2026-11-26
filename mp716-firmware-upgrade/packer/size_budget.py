"""MP716 flash / production size budgets (8 MiB flash, 64 MiB RAM profile)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from packer.image_format import FIRMWARE_BYTES, inspect_payload, parse_header

FLASH_CHIP_BYTES = 8_388_608
FIRMWARE_PARTITION_BYTES = FIRMWARE_BYTES  # 8_060_928 / mtd3
ERASE_BLOCK_BYTES = 65_536
ROOTFS_DATA_BYTES = 1_114_112  # mtd6 ~0x110000, device 2026-11-26
ROOTFS_DATA_BUDGET_BYTES = 1_048_576  # reserve ≥1 MiB overlay headroom

# SquashFS region must end before JFFS2 (historical factory jffs2 @ 0x680000).
PRODUCTION_TARGET_BYTES = 6_815_744  # 6.5 MiB — layout target
PRODUCTION_MAX_BYTES = 7_012_352  # 6.6875 MiB — release hard cap for written image span
CONTAINER_MAX_BYTES = FIRMWARE_PARTITION_BYTES


@dataclass
class SizeCheck:
    ok: bool
    reason: str
    container_bytes: int = 0
    payload_bytes: int = 0
    flash_image_bytes: int = 0
    squashfs_used: int = 0


def mp716upd_sizes(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 64:
        raise ValueError("container too short")
    header = parse_header(data[:64])
    total = header["total_size"]
    if len(data) < total:
        raise ValueError(f"truncated container: have {len(data)} need {total}")
    return total, int(header["payload_size"])


def payload_flash_span(payload: bytes) -> int:
    """Bytes that would occupy the firmware MTD (kernel + squashfs region)."""
    info = inspect_payload(payload)
    return info.squashfs_offset + info.squashfs_bytes_used


def check_mp716upd(path: Path) -> SizeCheck:
    container, payload_size = mp716upd_sizes(path)
    data = path.read_bytes()
    header = parse_header(data[:64])
    payload = data[header["header_size"] + header["manifest_size"] : header["header_size"] + header["manifest_size"] + payload_size]
    span = payload_flash_span(payload)
    if container > CONTAINER_MAX_BYTES:
        return SizeCheck(False, "container exceeds firmware partition", container, payload_size, span)
    if payload_size > CONTAINER_MAX_BYTES:
        return SizeCheck(False, "payload exceeds firmware partition", container, payload_size, span)
    if span > PRODUCTION_MAX_BYTES:
        return SizeCheck(False, f"flash span {span} > production max {PRODUCTION_MAX_BYTES}", container, payload_size, span)
    over_target = span > PRODUCTION_TARGET_BYTES
    reason = "ok"
    if over_target:
        reason = f"warn: flash span {span} exceeds target {PRODUCTION_TARGET_BYTES}"
    return SizeCheck(True, reason, container, payload_size, span)


def check_sysupgrade_image(path: Path) -> SizeCheck:
    raw = path.read_bytes()
    flash_bytes = len(raw)
    if flash_bytes > FIRMWARE_PARTITION_BYTES:
        return SizeCheck(False, "sysupgrade.bin exceeds mtd firmware size", flash_bytes, flash_bytes, flash_bytes)
    span = payload_flash_span(raw)
    if span > PRODUCTION_MAX_BYTES:
        return SizeCheck(False, f"sysupgrade payload span {span} > production max", flash_bytes, flash_bytes, span)
    reason = "ok"
    if span > PRODUCTION_TARGET_BYTES:
        reason = f"warn: span {span} > target {PRODUCTION_TARGET_BYTES}"
    return SizeCheck(True, reason, flash_bytes, flash_bytes, span)