from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class PolicyTests(unittest.TestCase):
    def test_sources_do_not_erase_real_flash(self) -> None:
        roots = [ROOT / "device" / "src", ROOT / "cgi", ROOT / "scripts", ROOT / "packer"]
        banned = ("MEMERASE", "MEMWRITE", "popen(", "system(")
        for root in roots:
            for path in root.rglob("*"):
                if path.suffix not in {".c", ".h", ".py", ".sh"}:
                    continue
                text = path.read_text(encoding="utf-8", errors="replace")
                for token in banned:
                    self.assertNotIn(token, text, f"{path} contains {token}")
        cgi = (ROOT / "cgi" / "mp716_upgrade.c").read_text(encoding="utf-8")
        self.assertNotIn("mp716_cmd_recover", cgi)
        build = (ROOT / "scripts" / "build_host.py").read_text(encoding="utf-8")
        self.assertNotIn("mtd_backend_real.c", build)

    def test_real_backend_file_has_no_flash_operation(self) -> None:
        text = (ROOT / "device" / "src" / "mtd_backend_real.c").read_text(encoding="utf-8")
        self.assertIn("MP716_ERR_FLASH_DISABLED", text)
        self.assertNotIn("ioctl", text.lower())

    def test_vendor_image_audit_is_blocked_without_the_sample(self) -> None:
        proc = subprocess.run([sys.executable, str(ROOT / "packer" / "audit_vendor_image.py")], capture_output=True, text=True, check=False)
        report = json.loads(proc.stdout)
        self.assertEqual(proc.returncode, 2)
        self.assertEqual(report["status"], "BLOCKED")
        self.assertFalse(report["hash_match"])
        self.assertFalse(report["historical_offset_verified"])
        self.assertIsNone(report["computed_sha256"])

    def test_release_script_refuses_flash(self) -> None:
        proc = subprocess.run([sys.executable, str(ROOT / "scripts" / "release_preflight.py"), "--allow-flash-upgrade"], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 24)


if __name__ == "__main__":
    unittest.main()
