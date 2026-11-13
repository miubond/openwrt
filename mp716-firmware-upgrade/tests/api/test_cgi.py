from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
import sys

sys.path.insert(0, str(ROOT))

from packer.image_format import code  # noqa: E402
from tests.support.images import signed_image, write_meminfo, write_profile  # noqa: E402

CGI = ROOT / "build" / "host" / ("mp716-upgrade.exe" if os.name == "nt" else "mp716-upgrade")
EXE = ROOT / "build" / "host" / ("mp716-upgraded.exe" if os.name == "nt" else "mp716-upgraded")


def invoke(root: Path, env_extra: dict, body: bytes = b"") -> tuple[int, str, dict]:
    env = os.environ.copy()
    env["MP716_RUNTIME_ROOT"] = str(root)
    env["MP716_UPGRADED_BIN"] = str(root / EXE.name)
    env.update(env_extra)
    proc = subprocess.run([str(CGI)], input=body, capture_output=True, env=env, check=False)
    text = proc.stdout.decode("utf-8", "replace")
    head, _, raw = text.partition("\r\n\r\n")
    if not raw:
        head, _, raw = text.partition("\n\n")
    if not raw.strip():
        raise AssertionError(text + proc.stderr.decode("utf-8", "replace"))
    return proc.returncode, head, json.loads(raw)


class CgiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = ROOT / "build" / "cgi-tests"
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir()
        blob, _seed, public = signed_image()
        self.blob = blob
        (self.root / "upgrade.pub").write_bytes(public)
        write_profile(self.root / "device.profile")
        write_meminfo(self.root / "meminfo", 40000)
        (self.root / "auth.mode").write_text("deny\n", encoding="utf-8")
        (self.root / "session").write_text("token=session-token\nrole=admin\n", encoding="utf-8")
        shutil.copyfile(EXE, self.root / EXE.name)

    def test_deny_mode_and_public_address(self) -> None:
        _rc, head, report = invoke(self.root, {"REQUEST_METHOD": "GET", "REMOTE_ADDR": "127.0.0.1", "QUERY_STRING": "op=info"})
        self.assertIn("403", head)
        self.assertEqual(report["code"], code("auth_unavailable"))
        (self.root / "auth.mode").write_text("test\n", encoding="utf-8")
        _rc, head, report = invoke(
            self.root,
            {
                "REQUEST_METHOD": "GET",
                "REMOTE_ADDR": "8.8.8.8",
                "QUERY_STRING": "op=info",
                "HTTP_COOKIE": "mp716_test_session=session-token",
            },
        )
        self.assertEqual(report["code"], code("forbidden"))

    def test_missing_cookie_viewer_and_csrf(self) -> None:
        (self.root / "auth.mode").write_text("test\n", encoding="utf-8")
        _rc, _head, report = invoke(self.root, {"REQUEST_METHOD": "GET", "REMOTE_ADDR": "192.168.1.20", "QUERY_STRING": "op=info"})
        self.assertEqual(report["code"], code("auth"))
        (self.root / "session").write_text("token=session-token\nrole=viewer\n", encoding="utf-8")
        _rc, _head, report = invoke(
            self.root,
            {
                "REQUEST_METHOD": "POST",
                "REMOTE_ADDR": "192.168.1.20",
                "QUERY_STRING": "op=verify",
                "HTTP_COOKIE": "mp716_test_session=session-token",
                "HTTP_X_MP716_UPGRADE": "1",
            },
        )
        self.assertEqual(report["code"], code("forbidden"))
        (self.root / "session").write_text("token=session-token\nrole=admin\n", encoding="utf-8")
        _rc, _head, report = invoke(
            self.root,
            {"REQUEST_METHOD": "POST", "REMOTE_ADDR": "10.0.0.8", "QUERY_STRING": "op=verify", "HTTP_COOKIE": "mp716_test_session=session-token"},
        )
        self.assertEqual(report["code"], code("csrf"))

    def test_info_upload_and_path_attack(self) -> None:
        (self.root / "auth.mode").write_text("test\n", encoding="utf-8")
        _rc, head, report = invoke(
            self.root,
            {"REQUEST_METHOD": "GET", "REMOTE_ADDR": "127.0.0.1", "PATH_INFO": "/info", "HTTP_COOKIE": "mp716_test_session=session-token"},
        )
        self.assertIn("200", head)
        self.assertEqual(report["vendor_software_version"], "014")
        self.assertFalse(report["custom_firmware_installed"])
        self.assertFalse(report["upgraded"])
        _rc, _head, report = invoke(
            self.root,
            {
                "REQUEST_METHOD": "POST",
                "REMOTE_ADDR": "127.0.0.1",
                "QUERY_STRING": "op=upload",
                "CONTENT_TYPE": "application/octet-stream",
                "CONTENT_LENGTH": str(len(self.blob)),
                "HTTP_COOKIE": "mp716_test_session=session-token",
                "HTTP_X_MP716_UPGRADE": "1",
            },
            self.blob[:10],
        )
        self.assertEqual(report["code"], code("interrupted"))
        self.assertFalse((self.root / "incoming.mp716upd").exists())
        _rc, _head, report = invoke(
            self.root,
            {
                "REQUEST_METHOD": "POST",
                "REMOTE_ADDR": "127.0.0.1",
                "QUERY_STRING": "op=upload&mtd=/dev/mtd0&path=../../etc/passwd",
                "CONTENT_TYPE": "application/octet-stream",
                "CONTENT_LENGTH": str(len(self.blob)),
                "HTTP_COOKIE": "mp716_test_session=session-token",
                "HTTP_X_MP716_UPGRADE": "1",
            },
            self.blob,
        )
        self.assertEqual(report["code"], code("path"))
        self.assertFalse((ROOT / "etc" / "passwd").exists())
        outside = self.root.parent / "passwd"
        self.assertFalse(outside.exists())

    def test_complete_upload_is_not_success(self) -> None:
        (self.root / "auth.mode").write_text("test\n", encoding="utf-8")
        _rc, head, report = invoke(
            self.root,
            {
                "REQUEST_METHOD": "POST",
                "REMOTE_ADDR": "127.0.0.1",
                "QUERY_STRING": "op=upload",
                "CONTENT_TYPE": "application/octet-stream",
                "CONTENT_LENGTH": str(len(self.blob)),
                "HTTP_COOKIE": "mp716_test_session=session-token",
                "HTTP_X_MP716_UPGRADE": "1",
            },
            self.blob,
        )
        self.assertIn("200", head)
        self.assertEqual(report["code"], 0)
        self.assertEqual(report["state"], "UPLOADING")
        self.assertEqual(report["detail"], "upload_stored")
        self.assertFalse(report["upgraded"])
        self.assertEqual((self.root / "incoming.mp716upd").read_bytes(), self.blob)

    def test_busy_lock(self) -> None:
        (self.root / "auth.mode").write_text("test\n", encoding="utf-8")
        (self.root / "LOCK").write_text("held\n", encoding="utf-8")
        _rc, head, report = invoke(
            self.root,
            {
                "REQUEST_METHOD": "POST",
                "REMOTE_ADDR": "172.16.0.4",
                "QUERY_STRING": "op=upload",
                "CONTENT_TYPE": "application/octet-stream",
                "CONTENT_LENGTH": str(len(self.blob)),
                "HTTP_COOKIE": "mp716_test_session=session-token",
                "HTTP_X_MP716_UPGRADE": "1",
            },
            self.blob,
        )
        self.assertIn("409", head)
        self.assertEqual(report["code"], code("busy"))


if __name__ == "__main__":
    unittest.main()
