from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import tarfile
import unittest
from pathlib import Path

from tests.support.images import signed_image, uimage_payload, write_meminfo, write_profile

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "integration" / "openwrt-package" / "files" / "usr" / "sbin" / "mp716-sysupgrade"
EXE = ROOT / "build" / "host" / ("mp716-upgraded.exe" if os.name == "nt" else "mp716-upgraded")


def bash() -> str | None:
    found = shutil.which("bash") or shutil.which("sh")
    if found:
        return found
    git = shutil.which("git")
    if git:
        candidate = Path(git).resolve().parent.parent / "bin" / "bash.exe"
        if candidate.is_file():
            return str(candidate)
    return None


def posix(path: Path) -> str:
    text = path.resolve().as_posix()
    if len(text) >= 2 and text[1] == ":":
        return f"/{text[0].lower()}{text[2:]}"
    return text


class SysupgradeAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.shell = bash()
        if self.shell is None:
            self.skipTest("bash is required to run the adapter")
        self.root = ROOT / "build" / "sysupgrade-adapter"
        if self.root.exists():
            shutil.rmtree(self.root)
        bindir = self.root / "bin"
        bindir.mkdir(parents=True)
        self.trace = self.root / "trace"
        self.script = self.root / SCRIPT.name
        self.script.write_bytes(SCRIPT.read_text(encoding="utf-8").encode("utf-8"))
        for name, body in {
            "mtd": 'printf "mtd\\n" >> "$MP716_TRACE"\nexit 98\n',
            "sysupgrade": (
                'printf "sysupgrade %s\\n" "$*" >> "$MP716_TRACE"\n'
                'if [ "$1" = -b ]; then\n'
                '  tar -czf "$2" -C "$MP716_TEST_ROOT/old-root" etc\n  exit $?\nfi\n'
                'test_only=0\n[ "$1" != -T ] || { test_only=1; shift; }\n'
                'if [ "$1" = -f ]; then cp "$2" "$MP716_TEST_ROOT/submitted.tgz"; shift 2; fi\n'
                '[ "$1" != -n ] || shift\n'
                'cmp -s "$1" "$MP716_TEST_ROOT/expected.bin" || exit 97\n'
                '[ "$test_only" = 0 ] || exit "${MP716_PREFLIGHT_CODE:-0}"\n'
                'exit 99\n'
            ),
            "mp716-upgraded": (
                'root=$MP716_TEST_ROOT\nexe=$MP716_TEST_EXE\nimage=$3\n'
                'if command -v cygpath >/dev/null 2>&1; then\n'
                '  root=$(cygpath -m "$root"); image=$(cygpath -m "$image")\n'
                'fi\n'
                'if [ "$#" = 7 ]; then\n'
                '  out=$5; pending=$7\n'
                '  if command -v cygpath >/dev/null 2>&1; then out=$(cygpath -m "$out"); pending=$(cygpath -m "$pending"); fi\n'
                '  set -- --extract "$out" --pending-state "$pending"\n'
                'else\n  set --\nfi\n'
                'exec "$exe" check --root "$root" --image "$image" "$@"\n'
            ),
        }.items():
            path = bindir / name
            path.write_bytes(("#!/bin/sh\n" + body).encode("utf-8"))
            path.chmod(path.stat().st_mode | stat.S_IEXEC)
        self.custom = self.root / "demo.mp716upd"
        payload = uimage_payload() + b"test-metadata-placeholder"
        blob, _, public = signed_image(payload)
        self.custom.write_bytes(blob)
        (self.root / "expected.bin").write_bytes(payload)
        (self.root / "upgrade.pub").write_bytes(public)
        write_profile(self.root / "device.profile")
        write_meminfo(self.root / "meminfo", 40000)
        (self.root / "old-root" / "etc").mkdir(parents=True)
        (self.root / "old-root" / "etc" / "old-config").write_text("keep me", encoding="ascii")
        self.vendor = self.root / "vendor.bin"
        self.vendor.write_bytes(b"\x27\x05\x19\x56" + b"\x00" * 8)
        self.unknown = self.root / "notes.txt"
        self.unknown.write_bytes(b"hello")
        self.gate = self.root / "flash-gate"
        self.gate.write_text("closed\n", encoding="utf-8")
        self.platform = self.root / "platform"
        self.platform.write_text("unconfirmed\n", encoding="utf-8")
        self.env = os.environ.copy()
        self.env["PATH"] = str(bindir) + os.pathsep + self.env.get("PATH", "")
        self.env["MP716_TRACE"] = posix(self.trace)
        self.env["MP716_GATE_FILE"] = posix(self.gate)
        self.env["MP716_PLATFORM_FILE"] = posix(self.platform)
        self.env["MP716_TEST_ROOT"] = posix(self.root)
        self.env["MP716_TEST_EXE"] = posix(EXE)

    def run_adapter(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [self.shell, posix(self.script), *args],
            capture_output=True,
            text=True,
            env=self.env,
            check=False,
        )

    def test_identify_keeps_vendor_and_custom_apart(self) -> None:
        custom = json.loads(self.run_adapter("identify", posix(self.custom)).stdout)
        vendor = json.loads(self.run_adapter("identify", posix(self.vendor)).stdout)
        unknown = json.loads(self.run_adapter("identify", posix(self.unknown)).stdout)
        self.assertEqual(custom["kind"], "custom")
        self.assertEqual(vendor["kind"], "vendor")
        self.assertEqual(unknown["kind"], "unknown")
        self.assertFalse(self.trace.exists())

    def test_closed_gate_does_not_call_sysupgrade_or_mtd(self) -> None:
        refused = self.run_adapter("apply", posix(self.custom))
        self.assertEqual(refused.returncode, 12, refused.stdout)
        self.assertIn("platform_unconfirmed", refused.stdout)
        self.assertFalse(self.trace.exists())
        vendor = self.run_adapter("verify", posix(self.vendor))
        self.assertEqual(vendor.returncode, 9)
        forced = self.run_adapter("apply", posix(self.custom), "-F")
        self.assertEqual(forced.returncode, 24)
        self.assertFalse(self.trace.exists())

    def test_plan_can_keep_config_without_force_or_execution(self) -> None:
        default = json.loads(self.run_adapter("plan", posix(self.custom)).stdout)
        kept = json.loads(self.run_adapter("plan", posix(self.custom), "--keep-config").stdout)
        self.assertIn("sysupgrade -n ", default["command"])
        self.assertNotIn("-F", default["command"])
        self.assertNotIn(" -n ", " " + kept["command"])
        self.assertNotIn("-F", kept["command"])
        self.assertFalse(default["flash_write"])
        self.assertFalse(self.trace.exists())

    def test_open_gate_without_platform_confirmation_does_not_flash(self) -> None:
        self.gate.write_text("serial-recovery-verified\n", encoding="utf-8")
        proc = self.run_adapter("apply", posix(self.custom))
        self.assertEqual(proc.returncode, 12, proc.stdout)
        self.assertIn("platform_unconfirmed", proc.stdout)
        self.assertFalse(self.trace.exists())

    def test_open_gate_uses_sysupgrade_not_mtd(self) -> None:
        self.assertEqual(self.run_adapter("verify", posix(self.custom)).returncode, 0)
        self.platform.write_text("confirmed\n", encoding="utf-8")
        self.gate.write_text("serial-recovery-verified\n", encoding="utf-8")
        proc = self.run_adapter("apply", posix(self.custom))
        self.assertEqual(proc.returncode, 99, proc.stderr)
        trace = self.trace.read_text(encoding="utf-8")
        self.assertEqual(len(trace.splitlines()), 2)
        self.assertTrue(trace.splitlines()[0].startswith("sysupgrade -T -n "), trace)
        self.assertTrue(trace.splitlines()[1].startswith("sysupgrade -f "), trace)
        self.assertIn(" -n ", trace.splitlines()[1])
        self.assertNotIn("demo.mp716upd", trace)
        self.assertNotIn("-F", trace)
        self.check_archive_and_boot(keep=False)

    def test_keep_config_carries_the_pending_record_with_existing_settings(self) -> None:
        self.platform.write_text("confirmed\n", encoding="utf-8")
        self.gate.write_text("serial-recovery-verified\n", encoding="utf-8")
        proc = self.run_adapter("apply", posix(self.custom), "--keep-config")
        self.assertEqual(proc.returncode, 99, proc.stderr)
        self.check_archive_and_boot(keep=True)

    def check_archive_and_boot(self, *, keep: bool) -> None:
        self.assertFalse((self.root / "sysupgrade.pending").exists())
        with tarfile.open(self.root / "submitted.tgz") as archive:
            names = {name.removeprefix("./") for name in archive.getnames()}
            self.assertEqual("etc/old-config" in names, keep)
            if not keep:
                self.assertEqual(names, {"etc/mp716-upgrade/sysupgrade.pending"})
            pending = archive.extractfile("./etc/mp716-upgrade/sysupgrade.pending")
            self.assertIsNotNone(pending)
            record = pending.read()
        for installed, expected in (("0.9.0", "FAILED"), ("1.0.0", "SUCCESS")):
            with self.subTest(installed=installed):
                write_profile(self.root / "running.profile", installed_custom_firmware=installed)
                # Old writable configuration could falsely claim the target version.
                write_profile(self.root / "device.profile", installed_custom_firmware="1.0.0")
                (self.root / "sysupgrade.pending").write_bytes(record)
                proc = subprocess.run(
                    [str(EXE), "boot-verify", "--root", str(self.root)],
                    capture_output=True, text=True, check=False,
                )
                report = json.loads(proc.stdout)
                self.assertEqual(report["state"], expected, report)
                self.assertEqual(report["upgraded"], expected == "SUCCESS")
                self.assertFalse((self.root / "sysupgrade.pending").exists())

        write_profile(self.root / "device.profile", installed_custom_firmware="0.9.0")
        proc = self.run_adapter("verify", posix(self.custom))
        self.assertEqual(json.loads(proc.stdout)["error"], "downgrade")

    def test_invalid_signature_and_failed_openwrt_check_stop_apply(self) -> None:
        self.platform.write_text("confirmed\n", encoding="utf-8")
        self.gate.write_text("serial-recovery-verified\n", encoding="utf-8")
        bad = self.root / "bad.mp716upd"
        image = bytearray(self.custom.read_bytes())
        image[-1] ^= 1
        bad.write_bytes(image)
        proc = self.run_adapter("apply", posix(bad))
        self.assertEqual(json.loads(proc.stdout)["error"], "signature")
        self.assertFalse(self.trace.exists())
        self.env["MP716_PREFLIGHT_CODE"] = "96"
        proc = self.run_adapter("apply", posix(self.custom), "--keep-config")
        self.assertEqual(proc.returncode, 96, proc.stderr)
        trace = self.trace.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(trace), 1)
        self.assertTrue(trace[0].startswith("sysupgrade -T /"), trace)
