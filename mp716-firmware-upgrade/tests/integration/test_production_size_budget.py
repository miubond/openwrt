"""Production flash budget gates (host, uses real 1.0.11 sample when present)."""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
from packer.size_budget import (  # noqa: E402
    CONTAINER_MAX_BYTES,
    PRODUCTION_MAX_BYTES,
    PRODUCTION_TARGET_BYTES,
    check_mp716upd,
)

SAMPLE = Path.home() / "Desktop" / "MP716-1.0.11" / "test.mp716upd"


class ProductionSizeBudgetTests(unittest.TestCase):
    def test_constants_match_mp716_mtd(self) -> None:
        self.assertEqual(CONTAINER_MAX_BYTES, 8_060_928)
        self.assertEqual(PRODUCTION_TARGET_BYTES, 6_815_744)
        self.assertEqual(PRODUCTION_MAX_BYTES, 7_012_352)

    def test_real_1_0_11_sample_under_hard_cap(self) -> None:
        if not SAMPLE.is_file():
            self.skipTest("Desktop MP716-1.0.11 test.mp716upd not present")
        result = check_mp716upd(SAMPLE)
        self.assertTrue(result.ok, result.reason)
        self.assertLessEqual(result.container_bytes, CONTAINER_MAX_BYTES)
        self.assertLessEqual(result.flash_image_bytes, PRODUCTION_MAX_BYTES)
        self.assertGreater(result.flash_image_bytes, PRODUCTION_TARGET_BYTES)  # known warn band


if __name__ == "__main__":
    unittest.main()