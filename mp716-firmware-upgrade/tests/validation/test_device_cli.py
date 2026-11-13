from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from packer.image_format import code  # noqa: E402
from tests.support.images import signed_image, uimage_payload, write_meminfo, write_profile  # noqa: E402

EXE = ROOT / "build" / "host" / ("mp716-upgraded.exe" if os.name == "nt" else "mp716-upgraded")
CGI = ROOT / "build" / "host" / ("mp716-upgrade.exe" if os.name == "nt" else "mp716-upgrade")


def run_json(args: list[str]) -> tuple[int, dict]:
    proc = subprocess.run([str(EXE), *args], capture_output=True, text=True, check=False)
    if not proc.stdout.strip():
        raise AssertionError(proc.stderr)
    return proc.returncode, json.loads(proc.stdout)


class DeviceCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = ROOT / "build" / "device-tests"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir()
        self.blob, _seed, public = signed_image()
        self.image = self.root / "good.mp716upd"
        self.image.write_bytes(self.blob)
        (self.root / "upgrade.pub").write_bytes(public)
        write_profile(self.root / "device.profile")
        write_meminfo(self.root / "meminfo", 40000)
        self.public = public

    def check(self, image: Path, meminfo: Path | None = None) -> tuple[int, dict]:
        args = ["check", "--root", str(self.root), "--image", str(image)]
        if meminfo:
            args.extend(["--meminfo", str(meminfo), "--require-memory"])
        return run_json(args)

    def test_c_accepts_python_signature(self) -> None:
        code_rc, report = self.check(self.image, self.root / "meminfo")
        self.assertEqual(report["code"], 0, report)
        self.assertEqual(code_rc, 0)
        self.assertFalse(report["flash_write"])
        self.assertFalse(report["upgraded"])
        self.assertEqual(report["vendor_software_version"], "014")
        self.assertEqual(report["firmware_version"], "1.0.0")
        self.assertFalse(report["historical_offset_match"])
        self.assertTrue(report["signature_checked"])

    def test_c_rejects_bad_signature_and_downgrade(self) -> None:
        bad = bytearray(self.blob)
        bad[-1] ^= 1
        path = self.root / "bad.mp716upd"
        path.write_bytes(bad)
        rc, report = self.check(path, self.root / "meminfo")
        self.assertEqual(report["code"], code("signature"))
        self.assertNotEqual(rc, 0)
        write_profile(self.root / "device.profile", installed_custom_firmware="2.0.0")
        rc, report = self.check(self.image, self.root / "meminfo")
        self.assertEqual(report["code"], code("downgrade"))

    def test_low_memory_and_flash_flag(self) -> None:
        write_meminfo(self.root / "low.meminfo", 100)
        rc, report = self.check(self.image, self.root / "low.meminfo")
        self.assertEqual(report["code"], code("low_memory"))
        self.assertNotEqual(rc, 0)
        rc, report = run_json(["info", "--root", str(self.root), "--allow-flash-upgrade"])
        self.assertEqual(report["code"], code("flash_disabled"))
        self.assertFalse(report["flash_write"])

    def test_apply_does_not_mark_success_or_change_profile(self) -> None:
        fakemtd = self.root / "firmware.fakemtd"
        fakemtd.write_bytes(b"\xa5" * (0x7B0000))
        runtime = self.root / "mp716-upgraded.exe"
        runtime.write_bytes(b"runtime")
        incoming = self.root / "incoming.mp716upd"
        incoming.write_bytes(self.blob)
        (self.root / "state").write_text(
            "state=READY\ncode=0\nerror=ok\ndetail=verified\nexpected_custom_firmware=\npayload_sha256=\nbytes_programmed=0\nerased=0\nunrecoverable=0\n",
            encoding="utf-8",
        )
        rc, report = run_json(
            [
                "apply",
                "--root",
                str(self.root),
                "--backend",
                "fake",
                "--fakemtd",
                str(fakemtd),
                "--runtime-path",
                str(runtime),
                "--meminfo",
                str(self.root / "meminfo"),
            ]
        )
        self.assertEqual(report["code"], 0, report)
        self.assertEqual(report["state"], "REBOOT_REQUIRED")
        self.assertFalse(report["upgraded"])
        self.assertFalse(report["flash_write"])
        self.assertTrue(report["fake_mtd"])
        profile = (self.root / "device.profile").read_text(encoding="utf-8")
        self.assertIn("installed_custom_firmware=\n", profile)
        rc, status = run_json(["status", "--root", str(self.root)])
        self.assertEqual(status["state"], "REBOOT_REQUIRED")
        self.assertEqual(status["code"], 0)
        rc, boot = run_json(["boot-verify", "--root", str(self.root)])
        self.assertNotEqual(boot["code"], 0)
        self.assertFalse(boot["upgraded"])
        write_profile(self.root / "device.profile", installed_custom_firmware="1.0.0")
        (self.root / "state").write_text(
            (self.root / "state").read_text(encoding="utf-8").replace("state=FAILED", "state=REBOOT_REQUIRED").replace("state=BOOT_VERIFYING", "state=REBOOT_REQUIRED"),
            encoding="utf-8",
        )
        # The failed boot-verify consumed the pending state. A second success
        # requires the pending record to still be reboot-required.
        text = (self.root / "state").read_text(encoding="utf-8")
        if "state=REBOOT_REQUIRED" not in text:
            text = text.replace("state=FAILED", "state=REBOOT_REQUIRED", 1)
            (self.root / "state").write_text(text, encoding="utf-8")
        rc, boot = run_json(["boot-verify", "--root", str(self.root)])
        self.assertEqual(boot["code"], 0, boot)
        self.assertTrue(boot["upgraded"])
        self.assertEqual(boot["state"], "SUCCESS")


if __name__ == "__main__":
    unittest.main()
