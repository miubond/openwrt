import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tests.support.images import uimage_payload


ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "integration/ram-web"
KEY_PATH = "etc/mp716-upgrade/upgrade.pub"


class RamWebSigningTests(unittest.TestCase):
    def test_external_lab_key_keeps_public_key_stable_without_copying_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            seed = work / "external.key"
            seed.write_bytes(bytes(range(32)))
            env = dict(os.environ, MP716_CI_SIGNING_KEY=str(seed))
            public_keys = []
            for name in ("first", "second"):
                build = work / name
                build.mkdir()
                subprocess.run([sys.executable, ROOT / "scripts/prepare-ci-test-key.py"],
                               cwd=build, env=env, check=True)
                key_dir = build / "build/ci-release"
                public_keys.append((key_dir / "upgrade.pub").read_bytes())
                self.assertFalse((key_dir / "ci-test.priv").exists())
            self.assertEqual(public_keys[0], public_keys[1])
            self.assertEqual(seed.read_bytes(), bytes(range(32)))

    def test_ram_overlay_accepts_the_same_run_package(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            subprocess.run(
                [sys.executable, ROOT / "scripts/prepare-ci-test-key.py"],
                cwd=work, check=True,
                env={name: value for name, value in os.environ.items() if name != "MP716_CI_SIGNING_KEY"},
            )
            keys = work / "build/ci-release"
            payload = work / "payload.bin"
            payload.write_bytes(uimage_payload())
            package = work / "test.mp716upd"
            profile = ROOT / "config/test-device.profile"
            subprocess.run(
                [sys.executable, ROOT / "packer/mp716_fwpack.py", "pack", "--payload", payload,
                 "--private-key", keys / "ci-test.priv", "--out", package,
                 "--hardware-revision", "ci-lab",
                 "--firmware-version", (ROOT / "config/firmware.version").read_text().strip()],
                check=True, capture_output=True,
            )

            for name, options, expected in (
                ("ci-ram", ["--test-public-key", keys / "upgrade.pub"], 0),
                ("ci-lan", ["--test-public-key", keys / "upgrade.pub"], 0),
                ("standalone-ram", [], 10),
                ("lan", ["--no-test-key"], None),
            ):
                with self.subTest(image=name):
                    overlay = work / name
                    subprocess.run(
                        [sys.executable, STAGING / "stage.py", STAGING / "web-input.zip", overlay, *options],
                        check=True,
                    )
                    public_key = overlay / KEY_PATH
                    if expected is None:
                        self.assertFalse(public_key.exists())
                        continue
                    result = subprocess.run(
                        [sys.executable, ROOT / "packer/mp716_fwverify.py", package,
                         "--public-key", public_key, "--profile", profile],
                        capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                    self.assertEqual(json.loads(result.stdout)["ok"], expected == 0)
