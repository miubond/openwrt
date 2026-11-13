from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
import sys

sys.path.insert(0, str(ROOT))

from packer.image_format import FIRMWARE_BYTES, code  # noqa: E402
from tests.support.images import signed_image, write_meminfo, write_profile  # noqa: E402

EXE = ROOT / "build" / "host" / ("mp716-upgraded.exe" if os.name == "nt" else "mp716-upgraded")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class FaultTests(unittest.TestCase):
    def test_power_loss_is_not_success(self) -> None:
        root = ROOT / "build" / "fault-tests"
        if root.exists():
            shutil.rmtree(root)
        root.mkdir()
        blob, _seed, public = signed_image()
        (root / "incoming.mp716upd").write_bytes(blob)
        (root / "upgrade.pub").write_bytes(public)
        write_profile(root / "device.profile")
        write_meminfo(root / "meminfo", 40000)
        (root / "state").write_text(
            "state=READY\ncode=0\nerror=ok\ndetail=verified\nexpected_custom_firmware=\npayload_sha256=\nbytes_programmed=0\nerased=0\nunrecoverable=0\n",
            encoding="utf-8",
        )
        fakemtd = root / "firmware.fakemtd"
        fakemtd.write_bytes(b"\xa5" * FIRMWARE_BYTES)
        (root / "firmware.fakemtd.fault").write_text("power_cut_after=8\n", encoding="utf-8")
        runtime = root / "mp716-upgraded.exe"
        runtime.write_bytes(b"x")
        proc = subprocess.run(
            [
                str(EXE),
                "apply",
                "--root",
                str(root),
                "--backend",
                "fake",
                "--fakemtd",
                str(fakemtd),
                "--runtime-path",
                str(runtime),
                "--meminfo",
                str(root / "meminfo"),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        report = json.loads(proc.stdout)
        self.assertEqual(report["code"], code("power_loss"), report)
        self.assertTrue(report["unrecoverable"])
        self.assertTrue(report["erased"])
        self.assertFalse(report["upgraded"])
        self.assertFalse(report["flash_write"])
        self.assertEqual(report["state"], "FAILED")
        self.assertIn("installed_custom_firmware=\n", (root / "device.profile").read_text(encoding="utf-8"))
        known = root / "known-good.bin"
        known.write_bytes(b"\xa5" * FIRMWARE_BYTES)
        known_hash = sha256_file(known)
        self.assertNotEqual(sha256_file(fakemtd), known_hash)

        failed = self.recover(root, fakemtd, known, runtime)
        self.assertEqual(failed["code"], code("power_loss"), failed)
        self.assertEqual(failed["state"], "FAILED")
        self.assertTrue(failed["unrecoverable"])
        self.assertFalse(failed["upgraded"])
        self.assertFalse(failed["flash_write"])
        self.assertNotEqual(sha256_file(fakemtd), known_hash)
        self.assertEqual(sha256_file(known), known_hash)

        (root / "firmware.fakemtd.fault").unlink()
        restored = self.recover(root, fakemtd, known, runtime)
        self.assertEqual(restored["code"], 0, restored)
        self.assertEqual(restored["state"], "IDLE")
        self.assertEqual(restored["detail"], "manual recovery restored the fake firmware partition; this is not automatic rollback")
        self.assertFalse(restored["unrecoverable"])
        self.assertFalse(restored["upgraded"])
        self.assertFalse(restored["flash_write"])
        self.assertEqual(sha256_file(fakemtd), known_hash)
        self.assertEqual(sha256_file(known), known_hash)
        profile = (root / "device.profile").read_text(encoding="utf-8")
        self.assertIn("installed_custom_firmware=\n", profile)
        state = (root / "state").read_text(encoding="utf-8")
        self.assertIn("state=IDLE\n", state)
        self.assertIn("expected_custom_firmware=\n", state)

        boot = subprocess.run([str(EXE), "boot-verify", "--root", str(root)], capture_output=True, text=True, check=False)
        boot_report = json.loads(boot.stdout)
        self.assertEqual(boot_report["detail"], "no_pending_upgrade")
        self.assertFalse(boot_report["upgraded"])

        rejected = self.recover(root, fakemtd, fakemtd, runtime)
        self.assertEqual(rejected["code"], code("path"), rejected)
        self.assertEqual(sha256_file(fakemtd), known_hash)
        real = self.recover(root, fakemtd, known, runtime, backend="real")
        self.assertEqual(real["code"], code("flash_disabled"), real)
        self.assertEqual(sha256_file(fakemtd), known_hash)

    def recover(self, root: Path, fakemtd: Path, known: Path, runtime: Path, backend: str = "fake") -> dict:
        proc = subprocess.run(
            [
                str(EXE),
                "recover",
                "--root",
                str(root),
                "--backend",
                backend,
                "--fakemtd",
                str(fakemtd),
                "--known-good",
                str(known),
                "--runtime-path",
                str(runtime),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertTrue(proc.stdout, proc.stderr)
        return json.loads(proc.stdout)


if __name__ == "__main__":
    unittest.main()
