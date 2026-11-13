from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from packer.image_format import FIRMWARE_BYTES, HEADER_BYTES, HISTORICAL_SQUASHFS_OFFSET, code, parse_header  # noqa: E402
from packer.manifest import loads_manifest  # noqa: E402
from packer.mp716_fwpack import main as pack_main  # noqa: E402
from packer.mp716_fwverify import verify_file  # noqa: E402
from tests.support.images import new_seed, signed_image, uimage_payload, write_meminfo, write_profile  # noqa: E402


class PackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = ROOT / "build" / "pytests"
        self.tmp.mkdir(parents=True, exist_ok=True)
        self.blob, self.seed, self.public = signed_image()
        self.image = self.tmp / "good.mp716upd"
        self.image.write_bytes(self.blob)
        self.key = self.tmp / "test.pub"
        self.key.write_bytes(self.public)
        self.profile = self.tmp / "device.profile"
        write_profile(self.profile)
        self.mem = self.tmp / "meminfo"
        write_meminfo(self.mem, 40000)

    def verify(self, blob: bytes, **profile: str):
        path = self.tmp / "case.mp716upd"
        path.write_bytes(blob)
        if profile:
            write_profile(self.profile, **profile)
        else:
            write_profile(self.profile)
        return verify_file(path, self.key, self.profile, meminfo_path=self.mem, require_memory=True)

    def test_round_trip_keeps_vendor_version(self) -> None:
        report = self.verify(self.blob)
        self.assertEqual(report["code"], 0)
        self.assertFalse(report["upgraded"])
        self.assertFalse(report["flash_write"])
        self.assertEqual(report["vendor_software_version"], "014")
        self.assertEqual(report["firmware_version"], "1.0.0")
        self.assertEqual(report["base_firmware"], "014")
        self.assertFalse(report["historical_offset_match"])
        self.assertNotEqual(report["squashfs_offset"], HISTORICAL_SQUASHFS_OFFSET)
        self.assertLessEqual(report["payload_size"], FIRMWARE_BYTES)

    def test_help_commands(self) -> None:
        for args in (["--help"], ["inspect", "--help"], ["pack", "--help"], ["verify", "--help"], ["compare", "--help"]):
            with self.assertRaises(SystemExit) as caught:
                pack_main(args)
            self.assertEqual(caught.exception.code, 0)

    def test_cli_pack_and_compare(self) -> None:
        payload = self.tmp / "payload.bin"
        payload.write_bytes(uimage_payload())
        private = self.tmp / "test.priv"
        private.write_bytes(self.seed)
        out = self.tmp / "cli.mp716upd"
        self.assertEqual(
            pack_main(
                [
                    "pack",
                    "--payload",
                    str(payload),
                    "--private-key",
                    str(private),
                    "--out",
                    str(out),
                    "--hardware-revision",
                    "mp716-r0-test",
                    "--firmware-version",
                    "1.0.0",
                    "--build-time",
                    "2026-11-13T01:02:03Z",
                ]
            ),
            0,
        )
        self.assertEqual(pack_main(["inspect", str(out)]), 0)
        self.assertEqual(pack_main(["compare", str(out), str(self.image)]), 0)

    def test_wrong_product(self) -> None:
        import hashlib

        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        from packer.image_format import pack_header, signing_message
        from packer.manifest import canonicalize
        from packer.mp716_fwpack import build_manifest, public_from_seed

        payload = uimage_payload()
        seed = new_seed()
        public = public_from_seed(seed)
        fields = build_manifest(
            payload=payload,
            hardware_revision="mp716-r0-test",
            firmware_version="1.0.0",
            base_firmware="014",
            web_ui="1.0.0",
            upgrade_engine="1.0.0",
            build_time="2026-11-13T01:02:03Z",
            allow_downgrade=False,
            public_key=public,
        )
        fields["product"] = "OTHER"
        encoded = json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        self.assertNotEqual(encoded, canonicalize({**fields, "product": "MP716"}))
        header = pack_header(len(encoded), len(payload))
        signature = Ed25519PrivateKey.from_private_bytes(seed).sign(signing_message(header, encoded, hashlib.sha256(payload).digest()))
        blob = header + encoded + payload + signature
        self.key.write_bytes(public)
        self.assertEqual(self.verify(blob)["code"], code("product"))

    def test_hardware_mismatch_and_placeholder(self) -> None:
        blob, _seed, public = signed_image(hardware_revision="other-board")
        self.key.write_bytes(public)
        self.assertEqual(self.verify(blob)["code"], code("hw_revision"))
        with self.assertRaises(Exception):
            signed_image(hardware_revision="validated-revision")
        with self.assertRaises(Exception):
            signed_image(hardware_revision="mtk-apsoc-demo")
        with self.assertRaises(Exception):
            signed_image(hardware_revision="MT7628")

    def test_downgrade_and_same_version(self) -> None:
        self.assertEqual(self.verify(self.blob, installed_custom_firmware="1.2.0")["code"], code("downgrade"))
        self.assertEqual(self.verify(self.blob, installed_custom_firmware="1.0.0")["code"], code("downgrade"))
        allowed, _seed, public = signed_image(firmware_version="1.0.0", allow_downgrade=True)
        self.key.write_bytes(public)
        report = verify_file(
            self._write(allowed),
            self.key,
            self._profile(installed_custom_firmware="1.2.0"),
            meminfo_path=self.mem,
            require_memory=True,
            operator_allow_downgrade=True,
        )
        self.assertEqual(report["code"], 0)

    def test_bad_signature_modified_payload_and_forged_manifest(self) -> None:
        bad = bytearray(self.blob)
        bad[-1] ^= 0x01
        self.assertEqual(self.verify(bytes(bad))["code"], code("signature"))
        payload = uimage_payload()
        blob, _seed, public = signed_image(payload)
        self.key.write_bytes(public)
        mutated = bytearray(blob)
        mutated[-65] ^= 0x01
        self.assertEqual(self.verify(bytes(mutated))["code"], code("hash"))
        forged = bytearray(self.blob)
        raw = self.blob
        start = HEADER_BYTES
        # Flip a letter inside the hardware revision while keeping the signature.
        marker = b"mp716-r0-test"
        at = raw.find(marker)
        self.assertGreater(at, 0)
        forged[at] = ord("x")
        self.assertEqual(self.verify(bytes(forged))["code"], code("signature"))

    def test_truncated_trailing_and_overflow(self) -> None:
        self.assertEqual(self.verify(self.blob[:-1])["code"], code("truncated"))
        self.assertEqual(self.verify(self.blob + b"\x00")["code"], code("trailing"))
        header = bytearray(64)
        header[0:8] = b"MP716UPD"
        header[8:12] = (1).to_bytes(4, "little")
        header[12:16] = (64).to_bytes(4, "little")
        header[16:20] = (0xFFFFFFFF).to_bytes(4, "little")
        header[20:24] = (0xFFFFFFFF).to_bytes(4, "little")
        with self.assertRaises(Exception) as caught:
            parse_header(bytes(header))
        self.assertEqual(caught.exception.code, code("overflow"))

    def test_bad_version_and_noncanonical(self) -> None:
        with self.assertRaises(Exception):
            signed_image(firmware_version="01.0.0")
        payload = uimage_payload()
        blob, seed, public = signed_image(payload)
        from packer.mp716_fwpack import build_manifest, public_from_seed
        from packer.image_format import signing_message, pack_header
        import hashlib
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        fields = build_manifest(
            payload=payload,
            hardware_revision="mp716-r0-test",
            firmware_version="1.0.0",
            base_firmware="014",
            web_ui="1.0.0",
            upgrade_engine="1.0.0",
            build_time="2026-11-13T01:02:03Z",
            allow_downgrade=False,
            public_key=public_from_seed(seed),
        )
        from packer.manifest import canonicalize

        messy = b" " + canonicalize(fields)
        header = pack_header(len(messy), len(payload))
        digest = hashlib.sha256(payload).digest()
        signature = Ed25519PrivateKey.from_private_bytes(seed).sign(signing_message(header, messy, digest))
        blob = header + messy + payload + signature
        self.key.write_bytes(public)
        self.assertEqual(self.verify(blob)["code"], code("not_canonical"))

    def test_low_memory_and_base_firmware(self) -> None:
        write_meminfo(self.mem, 1000)
        report = verify_file(self.image, self.key, self.profile, meminfo_path=self.mem, require_memory=True)
        self.assertEqual(report["code"], code("low_memory"))
        blob, _seed, public = signed_image(base_firmware="013")
        self.key.write_bytes(public)
        write_meminfo(self.mem, 40000)
        self.assertEqual(self.verify(blob)["code"], code("base_firmware"))

    def test_duplicate_manifest_key(self) -> None:
        with self.assertRaises(Exception):
            loads_manifest(b'{"format_version":1,"format_version":1}')

    def test_uimage_and_rootfs_rejected_after_signature(self) -> None:
        blob, _seed, public = signed_image(b"\x00" * 200, enforce_structure=False)
        self.key.write_bytes(public)
        self.assertEqual(self.verify(blob)["code"], code("uimage"))

    def _write(self, blob: bytes) -> Path:
        path = self.tmp / "downgrade.mp716upd"
        path.write_bytes(blob)
        return path

    def _profile(self, **overrides: str) -> Path:
        path = self.tmp / "downgrade.profile"
        write_profile(path, **overrides)
        return path


if __name__ == "__main__":
    unittest.main()
