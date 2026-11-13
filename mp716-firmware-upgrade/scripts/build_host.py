#!/usr/bin/env python3
"""Compile the host binaries. This script never invokes a flash tool."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build" / "host"
INCLUDE = [
    "-I", str(ROOT / "device" / "include"),
    "-I", str(ROOT / "shared"),
    "-I", str(ROOT / "device" / "third_party" / "monocypher"),
    "-I", str(ROOT / "device" / "third_party" / "sha256"),
]
DEVICE_SOURCES = [
    ROOT / "device" / "src" / "mp716_port.c",
    ROOT / "device" / "src" / "system_info.c",
    ROOT / "device" / "src" / "signature_verify.c",
    ROOT / "device" / "src" / "image_verify.c",
    ROOT / "device" / "src" / "upgrade_state.c",
    ROOT / "device" / "src" / "mtd_backend.c",
    ROOT / "device" / "src" / "upgrade_manager.c",
]
THIRD_PARTY = [
    ROOT / "device" / "third_party" / "sha256" / "sha256.c",
    ROOT / "device" / "third_party" / "monocypher" / "monocypher.c",
    ROOT / "device" / "third_party" / "monocypher" / "monocypher-ed25519.c",
]


def compiler() -> str:
    env = os.environ.get("CC")
    if env:
        return env
    found = shutil.which("clang") or shutil.which("gcc")
    if found:
        return found
    windows = Path(r"C:\Program Files\LLVM\bin\clang.exe")
    if windows.is_file():
        return str(windows)
    raise SystemExit("no C compiler found")


def compile_one(cc: str, source: Path, out: Path, our_code: bool) -> None:
    cmd = [cc, "-std=c99", "-Wall", "-Wextra", "-Wno-macro-redefined", "-D_CRT_SECURE_NO_WARNINGS", "-DMP716_HOST", "-c", str(source), "-o", str(out)]
    cmd[5:5] = INCLUDE
    if our_code:
        cmd.insert(4, "-Werror")
    subprocess.run(cmd, check=True)


def link(cc: str, objects: list[Path], output: Path) -> None:
    subprocess.run([cc, "-o", str(output), *[str(item) for item in objects]], check=True)


def main() -> int:
    cc = compiler()
    BUILD.mkdir(parents=True, exist_ok=True)
    objects: list[Path] = []
    for source in DEVICE_SOURCES + THIRD_PARTY:
        obj = BUILD / (source.stem + ".o")
        compile_one(cc, source, obj, source in DEVICE_SOURCES)
        objects.append(obj)
    main_obj = BUILD / "main.o"
    cgi_obj = BUILD / "cgi.o"
    test_obj = BUILD / "test_device.o"
    compile_one(cc, ROOT / "device" / "src" / "main.c", main_obj, True)
    compile_one(cc, ROOT / "cgi" / "mp716_upgrade.c", cgi_obj, True)
    compile_one(cc, ROOT / "tests" / "fake-mtd" / "test_device.c", test_obj, True)
    exe = ".exe" if os.name == "nt" else ""
    link(cc, [main_obj, *objects], BUILD / f"mp716-upgraded{exe}")
    link(cc, [cgi_obj, *objects], BUILD / f"mp716-upgrade{exe}")
    link(cc, [test_obj, *objects], BUILD / f"test_device{exe}")
    print(f"host binaries written to {BUILD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
