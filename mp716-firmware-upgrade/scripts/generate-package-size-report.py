#!/usr/bin/env python3
"""Emit component size breakdown for mp716-package-size-report.md."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
RAM = ROOT / "integration" / "ram-web"


def dir_bytes(path: Path) -> int:
    if not path.is_dir():
        return 0
    total = 0
    for p in path.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def largest_files(path: Path, n: int = 15) -> list[tuple[int, str]]:
    rows: list[tuple[int, str]] = []
    if not path.is_dir():
        return rows
    for p in path.rglob("*"):
        if p.is_file():
            try:
                rows.append((p.stat().st_size, str(p.relative_to(ROOT))))
            except ValueError:
                rows.append((p.stat().st_size, str(p)))
    rows.sort(reverse=True)
    return rows[:n]


def main() -> int:
    sections = {
        "web_dist": dir_bytes(WEB / "dist-openwrt") or dir_bytes(WEB / "dist"),
        "web_src_pages": dir_bytes(WEB / "src" / "pages"),
        "ram_web_uc": dir_bytes(RAM),
        "device_src": dir_bytes(ROOT / "device" / "src"),
        "packer": dir_bytes(ROOT / "packer"),
        "integration_openwrt_package": dir_bytes(ROOT / "integration" / "openwrt-package"),
    }
    device_probe = ROOT / "reports" / "device-size-probe-2026-11-26.json"
    device = {}
    if device_probe.is_file():
        device = json.loads(device_probe.read_text(encoding="utf-8-sig"))
    out = {
        "repo_component_bytes": sections,
        "largest_repo_files": largest_files(ROOT, 20),
        "device_probe": device,
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())