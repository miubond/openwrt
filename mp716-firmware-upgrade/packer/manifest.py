"""Canonical manifest bytes. The signed blob uses these exact bytes."""

from __future__ import annotations

import json
import re
from typing import Any

from packer.image_format import FIRMWARE_BYTES, ImageError, code

SEMVER = re.compile(r"^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$")
BUILD_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX16 = re.compile(r"^[0-9a-f]{16}$")

REQUIRED = (
    "allow_downgrade",
    "base_firmware",
    "build_time",
    "custom_firmware",
    "firmware_version",
    "format_version",
    "hardware_revision",
    "image_type",
    "payload_sha256",
    "payload_size",
    "product",
    "signing_key_id",
    "upgrade_engine",
    "web_ui",
)

FORBIDDEN_HARDWARE = {
    "",
    "validated-revision",
    "placeholder",
    "todo",
    "changeme",
    "unverified",
    "unknown",
    "none",
    "mp716",
    "test",
    "mt7628",
    "mtk-apsoc-demo",
}


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def parse_semver(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or SEMVER.fullmatch(value) is None:
        raise ImageError(code("manifest"), "manifest", "version is not major.minor.patch")
    return tuple(int(part) for part in value.split("."))  # type: ignore[return-value]


def canonicalize(fields: dict[str, Any]) -> bytes:
    validate_fields(fields)
    encoded = json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    if len(encoded) > 8192:
        raise ImageError(code("size"), "size", "canonical manifest exceeds 8192 bytes")
    return encoded


def loads_manifest(raw: bytes) -> tuple[dict[str, Any], bytes]:
    if len(raw) == 0 or len(raw) > 8192:
        raise ImageError(code("size"), "size", "manifest length is not allowed")
    if any(byte < 0x20 or byte > 0x7E for byte in raw):
        raise ImageError(code("not_canonical"), "not_canonical", "manifest is not printable ASCII without whitespace")
    if b" " in raw or b"\t" in raw:
        raise ImageError(code("not_canonical"), "not_canonical", "manifest contains whitespace")

    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        seen: dict[str, Any] = {}
        previous = ""
        for key, value in items:
            if key in seen:
                raise ImageError(code("manifest"), "manifest", "manifest repeats a field")
            if previous and key <= previous:
                raise ImageError(code("not_canonical"), "not_canonical", "manifest keys are not strictly sorted")
            previous = key
            seen[key] = value
        return seen

    try:
        text = raw.decode("ascii")
        parsed = json.loads(text, object_pairs_hook=pairs)
    except ImageError:
        raise
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ImageError(code("manifest"), "manifest", "manifest is not JSON") from exc
    if not isinstance(parsed, dict):
        raise ImageError(code("manifest"), "manifest", "manifest is not an object")
    canonical = canonicalize(parsed)
    if canonical != raw:
        raise ImageError(code("not_canonical"), "not_canonical", "manifest is not in canonical form")
    return parsed, canonical


def validate_fields(fields: dict[str, Any]) -> None:
    extra = set(fields) - set(REQUIRED)
    missing = set(REQUIRED) - set(fields)
    if extra or missing:
        raise ImageError(code("manifest"), "manifest", "manifest fields do not match the schema")
    if not isinstance(fields["allow_downgrade"], bool):
        raise ImageError(code("manifest"), "manifest", "allow_downgrade is not a boolean")
    if not _is_int(fields["format_version"]) or fields["format_version"] != 1:
        raise ImageError(code("manifest"), "manifest", "format_version is not 1")
    if not _is_int(fields["payload_size"]) or not 1 <= fields["payload_size"] <= FIRMWARE_BYTES:
        raise ImageError(code("manifest"), "manifest", "payload_size is not a payload length")
    if fields["product"] != "MP716":
        raise ImageError(code("product"), "product", "product is not MP716")
    if fields["image_type"] != "vendor-compatible":
        raise ImageError(code("manifest"), "manifest", "image_type is not vendor-compatible")
    hardware = fields["hardware_revision"]
    if not isinstance(hardware, str) or hardware.strip().lower() in FORBIDDEN_HARDWARE or len(hardware) > 32:
        raise ImageError(code("hw_revision"), "hw_revision", "hardware revision is empty or a placeholder")
    if not isinstance(fields["base_firmware"], str) or not fields["base_firmware"] or len(fields["base_firmware"]) > 16:
        raise ImageError(code("base_firmware"), "base_firmware", "base firmware is empty")
    for key in ("firmware_version", "custom_firmware", "web_ui", "upgrade_engine"):
        parse_semver(fields[key])
    if fields["custom_firmware"] != fields["firmware_version"]:
        raise ImageError(code("manifest"), "manifest", "custom_firmware and firmware_version differ")
    if not isinstance(fields["payload_sha256"], str) or HEX64.fullmatch(fields["payload_sha256"]) is None:
        raise ImageError(code("hash"), "hash", "payload_sha256 is not lowercase hex")
    if not isinstance(fields["signing_key_id"], str) or HEX16.fullmatch(fields["signing_key_id"]) is None:
        raise ImageError(code("manifest"), "manifest", "signing_key_id is not 16 lowercase hex characters")
    if not isinstance(fields["build_time"], str) or BUILD_TIME.fullmatch(fields["build_time"]) is None:
        raise ImageError(code("manifest"), "manifest", "build_time is not UTC YYYY-MM-DDTHH:MM:SSZ")
    month = int(fields["build_time"][5:7])
    day = int(fields["build_time"][8:10])
    hour = int(fields["build_time"][11:13])
    minute = int(fields["build_time"][14:16])
    second = int(fields["build_time"][17:19])
    if not (1 <= month <= 12 and 1 <= day <= 31 and hour <= 23 and minute <= 59 and second <= 60):
        raise ImageError(code("manifest"), "manifest", "build_time fields are out of range")
