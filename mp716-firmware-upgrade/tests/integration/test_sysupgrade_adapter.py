from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "integration" / "openwrt-package" / "files" / "usr" / "sbin" / "mp716-sysupgrade"


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
        for name in ("sysupgrade", "mtd"):
            path = bindir / name
            path.write_text(
                "#!/bin/sh\nprintf '%s\\n' \"$0 $*\" >> \"$MP716_TRACE\"\nexit 99\n",
                encoding="utf-8",
            )
            path.chmod(path.stat().st_mode | stat.S_IEXEC)
        self.custom = self.root / "demo.mp716upd"
        self.custom.write_bytes(b"MP716UPD" + b"\x00" * 8)
        self.vendor = self.root / "vendor.bin"
        self.vendor.write_bytes(b"\x27\x05\x19\x56" + b"\x00" * 8)
        self.unknown = self.root / "notes.txt"
        self.unknown.write_bytes(b"hello")
        self.gate = self.root / "flash-gate"
        self.gate.write_text("closed\n", encoding="utf-8")
        self.platform = self.root / "platform"
        self.platform.write_text("unconfirmed\n", encoding="utf-8")
        self.env = os.environ.copy()
        self.env["PATH"] = posix(bindir) + os.pathsep + self.env.get("PATH", "")
        self.env["MP716_TRACE"] = posix(self.trace)
        self.env["MP716_GATE_FILE"] = posix(self.gate)
        self.env["MP716_PLATFORM_FILE"] = posix(self.platform)

    def run_adapter(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [self.shell, posix(SCRIPT), *args],
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
        self.platform.write_text("confirmed\n", encoding="utf-8")
        self.gate.write_text("serial-recovery-verified\n", encoding="utf-8")
        proc = self.run_adapter("apply", posix(self.custom))
        self.assertEqual(proc.returncode, 99, proc.stderr)
        trace = self.trace.read_text(encoding="utf-8")
        self.assertIn("sysupgrade", trace)
        self.assertIn("-n", trace)
        self.assertNotIn("-F", trace)
        self.assertNotIn("mtd", Path(trace.split()[0]).name)
