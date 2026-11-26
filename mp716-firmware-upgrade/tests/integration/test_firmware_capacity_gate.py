"""Capacity budget for RAM/tmpfs upload on MP716 (host unit test)."""

from __future__ import annotations

import unittest

PARTITION_BYTES = 8060928
MEM_EXTRA_KB = 8 * 1024
TMP_EXTRA_KB = 512


def need_memory_kb(file_bytes: int) -> int:
    return (file_bytes + 1023) // 1024 + MEM_EXTRA_KB


def need_tmp_kb(file_bytes: int) -> int:
    return (file_bytes + 1023) // 1024 + TMP_EXTRA_KB


class FirmwareCapacityGateTests(unittest.TestCase):
    def test_partition_matches_packer_constant(self) -> None:
        from packer.image_format import FIRMWARE_BYTES

        self.assertEqual(FIRMWARE_BYTES, PARTITION_BYTES)

    def test_worst_case_8m_payload_budget(self) -> None:
        need = need_memory_kb(PARTITION_BYTES)
        self.assertGreater(need, MEM_EXTRA_KB)
        self.assertLess(need, 64 * 1024)

    def test_ci_sysupgrade_size_gate_is_enforced_in_script(self) -> None:
        script = (
            __import__("pathlib").Path(__file__).resolve().parents[2]
            / "scripts"
            / "build-openwrt-test.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("8060928", script)
        self.assertIn("exceeds the firmware partition", script)


if __name__ == "__main__":
    unittest.main()