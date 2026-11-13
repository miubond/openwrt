"""Pack, inspect, verify, and compare MP716 upgrade containers."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from packer.image_format import ImageError, code, inspect_payload, pack_header, signing_message
from packer.manifest import canonicalize
from packer.mp716_fwverify import compare_files, inspect_file, key_id, verify_file


def load_seed(path: Path) -> bytes:
    data = path.read_bytes()
    if len(data) == 32:
        return data
    try:
        raw = bytes.fromhex(data.decode("ascii").strip())
    except (UnicodeError, ValueError) as exc:
        raise ImageError(code("io"), "io", "private key is not 32 raw bytes or 64 hex characters") from exc
    if len(raw) != 32:
        raise ImageError(code("io"), "io", "private key length is not 32 bytes")
    return raw


def public_from_seed(seed: bytes) -> bytes:
    private = Ed25519PrivateKey.from_private_bytes(seed)
    return private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def build_manifest(
    *,
    payload: bytes,
    hardware_revision: str,
    firmware_version: str,
    base_firmware: str,
    web_ui: str,
    upgrade_engine: str,
    build_time: str,
    allow_downgrade: bool,
    public_key: bytes,
    product: str = "MP716",
    image_type: str = "vendor-compatible",
    custom_firmware: str | None = None,
) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "allow_downgrade": allow_downgrade,
        "base_firmware": base_firmware,
        "build_time": build_time,
        "custom_firmware": custom_firmware or firmware_version,
        "firmware_version": firmware_version,
        "format_version": 1,
        "hardware_revision": hardware_revision,
        "image_type": image_type,
        "payload_sha256": hashlib.sha256(payload).hexdigest(),
        "payload_size": len(payload),
        "product": product,
        "signing_key_id": key_id(public_key),
        "upgrade_engine": upgrade_engine,
        "web_ui": web_ui,
    }
    canonicalize(fields)
    return fields


def build_container(
    payload: bytes,
    fields: dict[str, Any],
    seed: bytes,
    *,
    enforce_structure: bool = True,
    manifest_bytes: bytes | None = None,
    signature: bytes | None = None,
) -> bytes:
    if enforce_structure:
        inspect_payload(payload)
    encoded = manifest_bytes if manifest_bytes is not None else canonicalize(fields)
    header = pack_header(len(encoded), len(payload))
    digest = hashlib.sha256(payload).digest()
    message = signing_message(header, encoded, digest)
    if signature is None:
        signature = Ed25519PrivateKey.from_private_bytes(seed).sign(message)
    if len(signature) != 64:
        raise ImageError(code("signature"), "signature", "signature length is not 64 bytes")
    return header + encoded + payload + signature


def pack_file(
    payload_path: Path,
    private_key_path: Path,
    output_path: Path,
    *,
    hardware_revision: str,
    firmware_version: str,
    base_firmware: str,
    web_ui: str,
    upgrade_engine: str,
    build_time: str,
    allow_downgrade: bool,
) -> dict:
    report = {
        "ok": False,
        "code": code("format"),
        "error": "format",
        "command": "pack",
        "flash_write": False,
        "upgraded": False,
    }
    try:
        if output_path.name.startswith("/dev") or "mtd" in output_path.name.lower() and output_path.suffix != ".mp716upd":
            raise ImageError(code("path"), "path", "refusing to write the container to a device-like path")
        payload = payload_path.read_bytes()
        seed = load_seed(private_key_path)
        public = public_from_seed(seed)
        if not build_time:
            build_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        fields = build_manifest(
            payload=payload,
            hardware_revision=hardware_revision,
            firmware_version=firmware_version,
            base_firmware=base_firmware,
            web_ui=web_ui,
            upgrade_engine=upgrade_engine,
            build_time=build_time,
            allow_downgrade=allow_downgrade,
            public_key=public,
        )
        blob = build_container(payload, fields, seed, enforce_structure=True)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(blob)
    except ImageError as exc:
        report["code"] = exc.code
        report["error"] = exc.error
        report["detail"] = exc.detail
        return report
    except OSError as exc:
        report["code"] = code("io")
        report["error"] = "io"
        report["detail"] = str(exc)
        return report
    report["ok"] = True
    report["code"] = 0
    report["error"] = "ok"
    report["output"] = str(output_path)
    report["payload_size"] = len(payload)
    report["container_bytes"] = len(blob)
    report["signing_key_id"] = fields["signing_key_id"]
    report["firmware_version"] = fields["firmware_version"]
    report["base_firmware"] = fields["base_firmware"]
    return report


def _emit(report: dict) -> int:
    json.dump(report, sys.stdout, ensure_ascii=False, sort_keys=True)
    sys.stdout.write("\n")
    return int(report["code"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mp716-fwpack", description="Build and check MP716 upgrade containers. This tool never writes flash.")
    sub = parser.add_subparsers(dest="command", required=True)

    inspect = sub.add_parser("inspect", help="parse a container and print JSON")
    inspect.add_argument("image")

    pack = sub.add_parser("pack", help="sign a vendor-compatible payload into .mp716upd")
    pack.add_argument("--payload", required=True)
    pack.add_argument("--private-key", required=True)
    pack.add_argument("--out", required=True)
    pack.add_argument("--hardware-revision", required=True)
    pack.add_argument("--firmware-version", required=True)
    pack.add_argument("--base-firmware", default="014")
    pack.add_argument("--web-ui", default="1.0.0")
    pack.add_argument("--upgrade-engine", default="1.0.0")
    pack.add_argument("--build-time", default="")
    pack.add_argument("--allow-downgrade", action="store_true")

    verify = sub.add_parser("verify", help="verify signature, compatibility, and payload structure")
    verify.add_argument("image")
    verify.add_argument("--public-key", required=True)
    verify.add_argument("--profile", required=True)
    verify.add_argument("--meminfo")
    verify.add_argument("--require-memory", action="store_true")
    verify.add_argument("--allow-downgrade", action="store_true")

    compare = sub.add_parser("compare", help="compare two containers")
    compare.add_argument("left")
    compare.add_argument("right")

    args = parser.parse_args(argv)
    if args.command == "inspect":
        return _emit(inspect_file(Path(args.image)))
    if args.command == "pack":
        return _emit(
            pack_file(
                Path(args.payload),
                Path(args.private_key),
                Path(args.out),
                hardware_revision=args.hardware_revision,
                firmware_version=args.firmware_version,
                base_firmware=args.base_firmware,
                web_ui=args.web_ui,
                upgrade_engine=args.upgrade_engine,
                build_time=args.build_time,
                allow_downgrade=args.allow_downgrade,
            )
        )
    if args.command == "verify":
        return _emit(
            verify_file(
                Path(args.image),
                Path(args.public_key),
                Path(args.profile),
                meminfo_path=Path(args.meminfo) if args.meminfo else None,
                require_memory=args.require_memory,
                operator_allow_downgrade=args.allow_downgrade,
            )
        )
    if args.command == "compare":
        return _emit(compare_files(Path(args.left), Path(args.right)))
    return _emit({"ok": False, "code": code("usage"), "error": "usage", "command": args.command, "flash_write": False, "upgraded": False})


if __name__ == "__main__":
    sys.exit(main())
