from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile
import unittest

from tests.support.images import signed_image, uimage_payload, write_profile


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("stage_versioned_release", ROOT / "scripts/stage-versioned-release.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class VersionedReleaseTests(unittest.TestCase):
    def setUp(self):
        build = ROOT / "build"
        build.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=build)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / "publish"
        self.version = (ROOT / "config/firmware.version").read_text().strip()
        self.openwrt_version = (ROOT / "config/openwrt.version").read_text().strip()
        self.pin = (ROOT / "config/openwrt.commit").read_text().strip()
        self.commit = "a" * 40
        self.payload = uimage_payload()
        self.images = [
            self.image("initramfs", "initramfs-ram-web-kernel", self.payload),
            self.image("sysupgrade", "squashfs-sysupgrade", self.payload),
        ]
        self.signed = self.root / "signed"
        self.signed.mkdir()
        blob, _, public = signed_image(self.payload, firmware_version=self.version)
        (self.signed / "test.mp716upd").write_bytes(blob)
        (self.signed / "upgrade.pub").write_bytes(public)
        write_profile(self.signed / "device.profile")
        self.signed_checksum()
        verification = {
            "ok": True, "flash_write": False, "signature_checked": True,
            "payload_sha256": hashlib.sha256(self.payload).hexdigest(),
        }
        for name in ("verify", "device-verify", "stage-verify", "boot-verify", "vendor-audit"):
            release.store_json(self.signed / f"{name}.json", verification)
        (self.signed / "ci-test.priv").write_text("not included", encoding="ascii")

    def signed_checksum(self):
        digest = release.sha256(self.signed / "test.mp716upd")
        (self.signed / "test.mp716upd.sha256").write_text(f"{digest}  test.mp716upd\n", encoding="ascii")

    def image(self, kind, suffix, payload):
        directory = self.root / kind
        directory.mkdir()
        filename = f"openwrt-ramips-mt76x8-yunxm_mp716-{suffix}.bin"
        (directory / filename).write_bytes(payload)
        digest = hashlib.sha256(payload).hexdigest()
        (directory / "SHA256SUMS").write_text(f"{digest}  {filename}\n", encoding="ascii")
        (directory / "openwrt.config").write_text("CONFIG_TEST=y\n", encoding="ascii")
        profile = directory / "device.profile"
        write_profile(profile)
        release.store_json(directory / "build-report.json", {
            "openwrt_commit": self.pin, "profile": kind, "static_checks_passed": True,
            "hardware_validated": False, "flash_write": False,
            "images": [{"name": filename, "bytes": len(payload), "sha256": digest}],
        })
        if kind == "sysupgrade":
            release.store_json(directory / "sysupgrade-metadata.json", {
                "supported_devices": ["yunxm,mp716"], "version": {"version": self.openwrt_version},
            })
        return kind, directory, profile

    def test_both_profiles_publish_with_integrity_checks_and_no_private_key(self):
        target = release.stage(self.output, self.images, self.commit, self.signed)
        self.assertEqual(target.relative_to(self.output).as_posix(),
                         f"releases/{self.version}/targets/ramips/mt76x8")
        manifest = release.read_json(target / "release-manifest.json")
        self.assertEqual(manifest["build_commit"], self.commit)
        self.assertEqual(manifest["test_status"], "UNVERIFIED")
        self.assertFalse(manifest["production_flash_allowed"])
        self.assertEqual({item["type"] for item in manifest["images"]}, {"initramfs", "sysupgrade"})
        for item in manifest["images"]:
            self.assertIn(f"openwrt-{self.openwrt_version}-ramips-mt76x8-yunxm_mp716-", item["filename"])
            self.assertEqual((target / item["filename"]).read_bytes(), self.payload)
            self.assertEqual(item["test_status"], "UNVERIFIED")
        for line in (target / "sha256sums").read_text().splitlines():
            digest, filename = line.split("  ", 1)
            self.assertEqual(release.sha256(target / filename), digest)
        self.assertFalse(list(target.rglob("*.priv")))

    def test_tampered_signed_test_fails_even_with_new_checksum(self):
        path = self.signed / "test.mp716upd"
        blob = bytearray(path.read_bytes())
        blob[-1] ^= 1
        path.write_bytes(blob)
        self.signed_checksum()
        with self.assertRaisesRegex(ValueError, "verification failed: signature"):
            release.stage(self.output, self.images, self.commit, self.signed)
        self.assertFalse((self.output / "releases" / self.version / "targets/ramips/mt76x8").exists())

    def test_corrupt_native_image_cannot_be_published(self):
        image = next(self.images[0][1].glob("*.bin"))
        image.write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "report or SHA-256 mismatch"):
            release.stage(self.output, self.images[:1], self.commit)

    def test_standalone_ram_artifact_does_not_require_signed_package(self):
        target = release.stage(self.output, self.images[:1], self.commit)
        manifest = release.read_json(target / "release-manifest.json")
        self.assertEqual(["initramfs"], [entry["type"] for entry in manifest["images"]])
        self.assertNotIn("signed_test_package", manifest)
