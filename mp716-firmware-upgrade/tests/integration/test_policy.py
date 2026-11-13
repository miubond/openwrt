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

    def test_running_partition_dump_is_measured(self) -> None:
        report = json.loads((ROOT / "docs" / "audit" / "device-firmware-partition.json").read_text(encoding="utf-8"))
        self.assertEqual(report["sha256"], "56cac090ab7fa2be00a5c5d3970aef484be8303ae76889e16cd297b19436607d")
        self.assertEqual(report["size_bytes"], 8060928)
        self.assertEqual(report["squashfs"]["offset"], 0x12DB89)
        self.assertTrue(report["structural_gates_passed"])
        self.assertFalse(report["factory_upgrade_bin_hash_match"])
        self.assertFalse(report["flash_write"])

    def test_upstream_reference_is_pinned(self) -> None:
        text = (ROOT / "docs" / "upstream-reference.md").read_text(encoding="utf-8")
        self.assertIn("0c335d6ea00af9b32225f72d491e560c1a7cf4ab", text)
        self.assertIn("3.18.23", text)
        self.assertIn("chaos_calmer", text)
        self.assertIn("27051956", text)
        self.assertIn("22dd0e28678a6cd6fbadea2d5aaded3a805ab8a4", text)
        self.assertIn("04cd252e4e9394ffacd51f56f1f124abc534f715", text)
        self.assertIn("target/linux/ramips/mt76x8/base-files/lib/upgrade/platform.sh", text)
        self.assertIn("PART_NAME=firmware", text)
        self.assertIn("dual_image", text)
        self.assertIn("mt7628an.dtsi", text)
        self.assertIn("mt7628an_jotale_js76x8-8m.dts", text)
        self.assertIn("mt7628an_mediatek_mt7628an-eval-board.dts", text)
        self.assertIn("75a306df84a020c57a631ef5b4c02ace56d93387", text)
        overlay = ROOT / "openwrt-overlay"
        dts = (overlay / "target" / "linux" / "ramips" / "dts" / "mt7628an_yunxm_mp716.dts").read_text(encoding="utf-8")
        self.assertIn("yunxm,mp716", dts)
        self.assertNotIn("jotale,js76x8", dts)
        self.assertIn("status = \"disabled\"", dts)
        recipe = (overlay / "target" / "linux" / "ramips" / "image" / "yunxm_mp716.mk").read_text(encoding="utf-8")
        self.assertIn("DEVICE_VARIANT := TEST", recipe)
        self.assertIn("BROKEN := y", recipe)
        self.assertNotIn("jotale_js76x8", recipe)
        case = (overlay / "target" / "linux" / "ramips" / "mt76x8" / "base-files" / "lib" / "upgrade" / "yunxm_mp716.case").read_text(encoding="utf-8")
        self.assertIn("default_do_upgrade", case)
        self.assertNotIn("fw_setenv", case)
        self.assertNotIn("romfile", case)
        sources = "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in (ROOT / "device" / "src").glob("*.c"))
        self.assertNotIn("ubus call system sysupgrade", sources)
        self.assertNotIn("fwtool", sources)

    def test_release_is_blocked_until_hardware_acceptance(self) -> None:
        acceptance = (ROOT / "docs" / "production-acceptance.md").read_text(encoding="utf-8")
        self.assertIn("未执行", acceptance)
        self.assertIn("不能叫 RELEASE", acceptance)
        migration = (ROOT / "docs" / "migration-014-to-v015.md").read_text(encoding="utf-8")
        self.assertIn("factory-mtd-from-device.bin", migration)
        refused = subprocess.run([sys.executable, str(ROOT / "scripts" / "prepare_v25_tree.py"), "--release"], capture_output=True, text=True, check=False)
        self.assertEqual(refused.returncode, 24)
        planned = subprocess.run([sys.executable, str(ROOT / "scripts" / "prepare_v25_tree.py")], capture_output=True, text=True, check=False)
        self.assertEqual(planned.returncode, 0)
        self.assertIn("initramfs=not-built", planned.stdout)
        self.assertIn("flash_write=false", planned.stdout)

    def test_vendor_system_is_not_treated_as_official_sysupgrade(self) -> None:
        text = (ROOT / "docs" / "mp716-hardware-compatibility.md").read_text(encoding="utf-8")
        self.assertIn("v15.05.1", text)
        self.assertIn("3.10.108", text)
        self.assertIn("unconfirmed", text)
        package = (ROOT / "integration" / "openwrt-package" / "Makefile").read_text(encoding="utf-8")
        self.assertIn("does not make the", package)

    def test_release_script_refuses_flash(self) -> None:
        proc = subprocess.run([sys.executable, str(ROOT / "scripts" / "release_preflight.py"), "--allow-flash-upgrade"], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 24)


if __name__ == "__main__":
    unittest.main()
