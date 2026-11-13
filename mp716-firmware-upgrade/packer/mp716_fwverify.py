"""Verify an .mp716upd container without writing flash."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from packer.image_format import (
    FIRMWARE_BYTES,
    HEADER_BYTES,
    SIGNATURE_BYTES,
    UPLOAD_RESERVE_BYTES,
    VERIFY_RESERVE_BYTES,
    ImageError,
    code,
    inspect_payload,
    parse_header,
    signing_message,
)
from packer.manifest import loads_manifest, parse_semver

NAMES = {
    0: "ok",
    1: "usage",
    2: "io",
    3: "format",
    4: "magic",
    5: "version",
    6: "size",
    7: "overflow",
    8: "manifest",
    9: "hash",
    10: "signature",
    11: "product",
    12: "hw_revision",
    13: "base_firmware",
    14: "downgrade",
    15: "uimage",
    16: "rootfs",
    17: "no_space",
    18: "low_memory",
    19: "state",
    20: "busy",
    21: "auth",
    22: "csrf",
    23: "path",
    24: "flash_disabled",
    25: "interrupted",
    26: "power_loss",
    27: "truncated",
    28: "trailing",
    29: "not_canonical",
    30: "not_in_ram",
    31: "auth_unavailable",
    32: "forbidden",
}


def error_name(value: int) -> str:
    return NAMES.get(value, "unknown")


def load_public_key(path: Path) -> bytes:
    data = path.read_bytes()
    if len(data) == 32:
        return data
    try:
        raw = bytes.fromhex(data.decode("ascii").strip())
    except (UnicodeError, ValueError) as exc:
        raise ImageError(code("io"), "io", "public key is not 32 raw bytes or 64 hex characters") from exc
    if len(raw) != 32:
        raise ImageError(code("io"), "io", "public key length is not 32 bytes")
    return raw


def key_id(public_key: bytes) -> str:
    return hashlib.sha256(public_key).hexdigest()[:16]


def load_profile(path: Path) -> dict:
    raw = path.read_text(encoding="utf-8")
    if raw.lstrip().startswith("{"):
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ImageError(code("format"), "format", "device profile is not an object")
        return {str(key): "" if value is None else str(value) for key, value in data.items()}
    profile: dict[str, str] = {}
    for line in raw.splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        profile[key.strip()] = value.strip()
    return profile


def parse_meminfo(text: str) -> int:
    values: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0].endswith(":"):
            try:
                values[parts[0][:-1]] = int(parts[1])
            except ValueError as exc:
                raise ImageError(code("low_memory"), "low_memory", "meminfo is not numeric") from exc
    if "MemAvailable" in values:
        return values["MemAvailable"]
    if "MemFree" not in values:
        raise ImageError(code("low_memory"), "low_memory", "meminfo has no MemFree")
    return values["MemFree"] + values.get("Buffers", 0) // 2 + values.get("Cached", 0) // 2


def memory_allows(available_kib: int, payload_size: int, phase: str) -> bool:
    available = available_kib * 1024
    if phase == "upload":
        return available >= payload_size + UPLOAD_RESERVE_BYTES
    if phase == "verify":
        return available >= VERIFY_RESERVE_BYTES
    raise ImageError(code("usage"), "usage", "unknown memory phase")


def _base_report(command: str) -> dict:
    return {
        "ok": False,
        "code": code("format"),
        "error": "format",
        "command": command,
        "flash_write": False,
        "upgraded": False,
    }


def inspect_file(path: Path) -> dict:
    report = _base_report("inspect")
    try:
        parsed = _read_container(path)
    except ImageError as exc:
        report["code"] = exc.code
        report["error"] = exc.error
        report["detail"] = exc.detail
        return report
    report.update(parsed["public"])
    report["ok"] = True
    report["code"] = 0
    report["error"] = "ok"
    report["signature_checked"] = False
    return report


def verify_file(
    path: Path,
    public_key_path: Path,
    profile_path: Path,
    *,
    meminfo_path: Path | None = None,
    require_memory: bool = False,
    operator_allow_downgrade: bool = False,
) -> dict:
    report = _base_report("verify")
    report["vendor_software_version"] = ""
    try:
        parsed = _read_container(path)
        public = parsed["public"]
        report.update(public)
        manifest = parsed["manifest"]
        if manifest["payload_sha256"] != public["payload_sha256"]:
            raise ImageError(code("hash"), "hash", "manifest hash does not match the payload")
        if manifest["payload_size"] != public["payload_size"]:
            raise ImageError(code("manifest"), "manifest", "manifest payload_size does not match the header")
        raw_key = load_public_key(public_key_path)
        if manifest["signing_key_id"] != key_id(raw_key):
            raise ImageError(code("signature"), "signature", "signing key id does not match this public key")
        try:
            Ed25519PublicKey.from_public_bytes(raw_key).verify(parsed["signature"], parsed["signed"])
        except InvalidSignature as exc:
            raise ImageError(code("signature"), "signature", "Ed25519 signature rejected the image") from exc
        profile = load_profile(profile_path)
        report["vendor_software_version"] = profile.get("vendor_software_version", "")
        _check_profile(manifest, profile, operator_allow_downgrade)
        structure = inspect_payload(parsed["payload"])
        report["squashfs_offset"] = structure.squashfs_offset
        report["historical_offset_match"] = structure.historical_offset_match
        report["lzma_dictionary"] = structure.lzma_dictionary
        report["uimage_name"] = structure.uimage_name
        if require_memory:
            if meminfo_path is None:
                raise ImageError(code("low_memory"), "low_memory", "memory budget was required but meminfo is missing")
            available = parse_meminfo(meminfo_path.read_text(encoding="utf-8"))
            report["memory_available_kib"] = available
            report["memory_checked"] = True
            if not memory_allows(available, public["payload_size"], "verify"):
                raise ImageError(code("low_memory"), "low_memory", "not enough free memory to verify")
        else:
            report["memory_checked"] = False
    except ImageError as exc:
        report["code"] = exc.code
        report["error"] = exc.error
        report["detail"] = exc.detail
        report["ok"] = False
        report["upgraded"] = False
        report["flash_write"] = False
        return report
    report["ok"] = True
    report["code"] = 0
    report["error"] = "ok"
    report["signature_checked"] = True
    report["upgraded"] = False
    report["flash_write"] = False
    return report


def compare_files(left: Path, right: Path) -> dict:
    report = _base_report("compare")
    first = inspect_file(left)
    second = inspect_file(right)
    report["left"] = first
    report["right"] = second
    if not first["ok"] or not second["ok"]:
        report["code"] = first["code"] if not first["ok"] else second["code"]
        report["error"] = first["error"] if not first["ok"] else second["error"]
        report["identical"] = False
        return report
    fields = (
        "payload_sha256",
        "payload_size",
        "firmware_version",
        "base_firmware",
        "hardware_revision",
        "product",
        "custom_firmware",
        "web_ui",
        "upgrade_engine",
    )
    diffs = [name for name in fields if first.get(name) != second.get(name)]
    report["ok"] = True
    report["code"] = 0
    report["error"] = "ok"
    report["identical"] = not diffs and first["payload_sha256"] == second["payload_sha256"]
    report["differences"] = diffs
    return report


def _check_profile(manifest: dict, profile: dict, operator_allow_downgrade: bool) -> None:
    if profile.get("product") != "MP716" or manifest["product"] != profile.get("product"):
        raise ImageError(code("product"), "product", "image product does not match the device")
    if manifest["hardware_revision"] != profile.get("hardware_revision"):
        raise ImageError(code("hw_revision"), "hw_revision", "hardware revision does not match the device profile")
    if manifest["base_firmware"] != profile.get("base_firmware"):
        raise ImageError(code("base_firmware"), "base_firmware", "base firmware does not match the device")
    if profile.get("vendor_software_version") != profile.get("base_firmware"):
        raise ImageError(code("version"), "version", "profile vendor version and base firmware disagree")
    installed = profile.get("installed_custom_firmware", "")
    if installed:
        parse_semver(installed)
        if parse_semver(manifest["firmware_version"]) <= parse_semver(installed):
            if not (manifest["allow_downgrade"] and operator_allow_downgrade):
                raise ImageError(code("downgrade"), "downgrade", "image is not newer than the installed custom firmware")


def _read_container(path: Path) -> dict:
    try:
        blob = path.read_bytes()
    except OSError as exc:
        raise ImageError(code("io"), "io", "image cannot be read") from exc
    if len(blob) < HEADER_BYTES + SIGNATURE_BYTES:
        raise ImageError(code("truncated"), "truncated", "file is shorter than a header and signature")
    header_info = parse_header(blob[:HEADER_BYTES])
    total = header_info["total_size"]
    if len(blob) < total:
        raise ImageError(code("truncated"), "truncated", "file is shorter than the lengths in the header")
    if len(blob) > total:
        raise ImageError(code("trailing"), "trailing", "file has bytes after the signature")
    manifest_end = HEADER_BYTES + header_info["manifest_size"]
    payload_end = manifest_end + header_info["payload_size"]
    manifest_bytes = blob[HEADER_BYTES:manifest_end]
    payload = blob[manifest_end:payload_end]
    signature = blob[payload_end:payload_end + SIGNATURE_BYTES]
    if len(payload) != header_info["payload_size"] or len(signature) != SIGNATURE_BYTES:
        raise ImageError(code("format"), "format", "section bounds do not match")
    # Reject overlapping or inverted ranges. The arithmetic above is exact, so
    # this guards a future edit that introduces another length field.
    if not (HEADER_BYTES <= manifest_end <= payload_end <= total):
        raise ImageError(code("overflow"), "overflow", "sections overlap")
    manifest, canonical = loads_manifest(manifest_bytes)
    digest = hashlib.sha256(payload).digest()
    public = {
        "format_version": header_info["format_version"],
        "manifest_size": header_info["manifest_size"],
        "payload_size": header_info["payload_size"],
        "payload_sha256": digest.hex(),
        "product": manifest.get("product", ""),
        "hardware_revision": manifest.get("hardware_revision", ""),
        "firmware_version": manifest.get("firmware_version", ""),
        "base_firmware": manifest.get("base_firmware", ""),
        "custom_firmware": manifest.get("custom_firmware", ""),
        "web_ui": manifest.get("web_ui", ""),
        "upgrade_engine": manifest.get("upgrade_engine", ""),
        "image_type": manifest.get("image_type", ""),
        "signing_key_id": manifest.get("signing_key_id", ""),
        "build_time": manifest.get("build_time", ""),
        "allow_downgrade": manifest.get("allow_downgrade", False),
        "container_bytes": total,
        "within_firmware_partition": header_info["payload_size"] <= FIRMWARE_BYTES,
    }
    return {
        "public": public,
        "manifest": manifest,
        "manifest_bytes": canonical,
        "payload": payload,
        "signature": signature,
        "signed": signing_message(blob[:HEADER_BYTES], manifest_bytes, digest),
        "header": blob[:HEADER_BYTES],
    }


def _emit(report: dict) -> int:
    json.dump(report, sys.stdout, ensure_ascii=False, sort_keys=True)
    sys.stdout.write("\n")
    return int(report["code"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mp716-fwverify", description="Verify an MP716 upgrade container. This tool never writes flash.")
    parser.add_argument("image")
    parser.add_argument("--public-key", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--meminfo")
    parser.add_argument("--require-memory", action="store_true")
    parser.add_argument("--allow-downgrade", action="store_true")
    args = parser.parse_args(argv)
    report = verify_file(
        Path(args.image),
        Path(args.public_key),
        Path(args.profile),
        meminfo_path=Path(args.meminfo) if args.meminfo else None,
        require_memory=args.require_memory,
        operator_allow_downgrade=args.allow_downgrade,
    )
    return _emit(report)


if __name__ == "__main__":
    sys.exit(main())
