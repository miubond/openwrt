#!/usr/bin/env python3
"""Copy validated MP716 test outputs into an OpenWrt-style release tree."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
from packer.manifest import parse_semver


TARGET = "ramips/mt76x8"
MODEL = "MP716"
PROFILE = "yunxm_mp716"
STATUS = "UNVERIFIED"
HARDWARE_REPORT = "reports/mp716-hardware-compatibility.md"
IMAGE_TYPES = {
    "initramfs": ("initramfs-kernel", "启动到 RAM，用于实验室启动测试"),
    "sysupgrade": ("squashfs-sysupgrade", "OpenWrt sysupgrade 格式候选，仅供实验室校验"),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def store_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def publish_directory(staged, destination):
    # Windows file scanners can briefly hold an open handle during staging.
    for delay in (0.05, 0.1, 0.2, 0.4, None):
        try:
            staged.rename(destination)
            return
        except PermissionError as error:
            if delay is None or sys.platform != "win32" or error.winerror not in (5, 32, 33):
                raise
            time.sleep(delay)


def expected_sha(checksums, filename):
    matches = [digest for digest, name in (line.split("  ", 1)
               for line in checksums.read_text(encoding="ascii").splitlines()) if name == filename]
    require(len(matches) == 1, f"Missing or duplicate SHA-256 entry: {filename}")
    return matches[0]


def copy_image(target, kind, source, profile, openwrt_version, openwrt_commit):
    suffix, purpose = IMAGE_TYPES[kind]
    report = read_json(source / "build-report.json")
    require(report["openwrt_commit"] == openwrt_commit and report["profile"] == kind,
            f"Unexpected OpenWrt commit or profile in {source}")
    require(report["static_checks_passed"] is True and report["hardware_validated"] is False
            and report["flash_write"] is False, f"Unexpected build checks in {source}")
    image, = report["images"]
    source_name = image["name"]
    native_suffixes = ("initramfs-kernel", "initramfs-ram-web-kernel", "initramfs-rx-kernel") \
        if kind == "initramfs" else (suffix,)
    require(re.fullmatch(r"openwrt-(?:[0-9.]+-)?ramips-mt76x8-yunxm_mp716-(" +
                         "|".join(native_suffixes) + r")\.bin", source_name),
            f"Unexpected {kind} image name: {source_name}")
    native = source / source_name
    digest, size = sha256(native), native.stat().st_size
    require(digest == image["sha256"] == expected_sha(source / "SHA256SUMS", source_name)
            and size == image["bytes"], f"Build report or SHA-256 mismatch: {native}")
    name = f"openwrt-{openwrt_version}-ramips-mt76x8-{PROFILE}-{suffix}.bin"
    shutil.copyfile(native, target / name)
    require(sha256(target / name) == digest, f"Release copy differs from {native}")

    config_dir, report_dir = target / "configs" / kind, target / "reports" / kind
    config_dir.mkdir(parents=True)
    report_dir.mkdir(parents=True)
    require("product=MP716" in profile.read_text(encoding="ascii").splitlines(),
            f"Unexpected device profile: {profile}")
    shutil.copyfile(profile, config_dir / "device.profile")
    for item in ("openwrt.config", "board.dts"):
        if item == "openwrt.config" or (source / item).is_file():
            shutil.copyfile(source / item, config_dir / item)
    for item in ("SHA256SUMS", "build-report.json", "sysupgrade-metadata.json", "rootfs-files.txt", "initramfs-files.txt",
                 "original-sysupgrade.sha256"):
        if item == "build-report.json" or (source / item).is_file():
            shutil.copyfile(source / item, report_dir / item)
    if kind == "sysupgrade":
        metadata = read_json(source / "sysupgrade-metadata.json")
        require("yunxm,mp716" in metadata["supported_devices"] and
                metadata["version"]["version"] == openwrt_version, "Unexpected native sysupgrade metadata")
    return {
        "filename": name, "native_filename": source_name, "type": kind,
        "purpose": purpose, "bytes": size, "sha256": digest,
        "test_status": STATUS, "production_flash_allowed": False,
    }


def copy_signed_test(target, source, firmware_version, sysupgrade):
    from packer.mp716_fwverify import verify_file

    package = source / "test.mp716upd"
    digest = sha256(package)
    require(digest == expected_sha(source / "test.mp716upd.sha256", package.name), "Signed test package SHA-256 mismatch")
    verification = verify_file(package, source / "upgrade.pub", source / "device.profile")
    require(verification["ok"] is True and verification["signature_checked"] is True,
            f"Signed test package verification failed: {verification.get('error')}")
    require(verification["payload_sha256"] == sysupgrade["sha256"], "Signed payload differs from published sysupgrade")
    require(verification["product"] == MODEL and verification["firmware_version"] == firmware_version,
            "Signed test package device or firmware version mismatch")
    for name in ("verify.json", "device-verify.json"):
        report = read_json(source / name)
        require(report["ok"] is True and report["signature_checked"] is True and report["flash_write"] is False
                and report["payload_sha256"] == sysupgrade["sha256"],
                f"Missing successful test signature verification: {name}")
    directory = target / "test-packages"
    directory.mkdir()
    for name in ("test.mp716upd", "test.mp716upd.sha256", "upgrade.pub", "device.profile",
                 "verify.json", "device-verify.json", "stage-verify.json", "boot-verify.json", "vendor-audit.json"):
        shutil.copyfile(source / name, directory / name)
    return {
        "filename": "test-packages/test.mp716upd", "format": "mp716upd",
        "purpose": "lab_signature_test", "bytes": package.stat().st_size, "sha256": digest,
        "test_status": STATUS, "production_flash_allowed": False,
    }


def stage(output, images, build_commit, signed_test=None):
    firmware_version = (PROJECT / "config/firmware.version").read_text().strip()
    parse_semver(firmware_version)
    openwrt_version = (PROJECT / "config/openwrt.version").read_text().strip()
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", openwrt_version), "Invalid OpenWrt version")
    openwrt_commit = (PROJECT / "config/openwrt.commit").read_text().strip()
    for commit in (build_commit, openwrt_commit):
        require(re.fullmatch(r"[0-9a-f]{40}", commit), "Expected full Git commit ID")
    modes = [kind for kind, _, _ in images]
    require(modes and len(set(modes)) == len(modes) and set(modes) <= IMAGE_TYPES.keys(),
            "Expected one input per known image type")
    require(signed_test is None or "sysupgrade" in modes, "Signed test package requires sysupgrade")

    output = output.resolve()
    destination = output / "releases" / firmware_version / "targets" / TARGET
    require(destination.resolve().is_relative_to(output), "Release directory escapes requested output")
    require(not destination.exists(), f"Release directory already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as temporary:
        target = Path(temporary) / "target"
        target.mkdir()
        metadata = {
            "project": "mp716-firmware", "firmware_version": firmware_version,
            "openwrt_version": openwrt_version, "openwrt_commit": openwrt_commit,
            "build_commit": build_commit, "target": TARGET,
            "device": MODEL, "device_profile": PROFILE, "supported_devices": ["yunxm,mp716"],
            "test_status": STATUS, "production_flash_allowed": False,
            "hardware_compatibility_report": HARDWARE_REPORT,
        }
        metadata["images"] = [copy_image(target, kind, Path(source), Path(profile), openwrt_version, openwrt_commit)
                              for kind, source, profile in sorted(images)]
        shutil.copyfile(PROJECT / "docs/mp716-hardware-compatibility.md", target / HARDWARE_REPORT)
        shutil.copyfile(PROJECT / "docs/stock-014-network-migration.md",
                        target / "reports/stock-014-network-migration.md")
        if signed_test is not None:
            sysupgrade = next(item for item in metadata["images"] if item["type"] == "sysupgrade")
            metadata["signed_test_package"] = copy_signed_test(target, signed_test, firmware_version, sysupgrade)
        store_json(target / "release-manifest.json", metadata)
        (target / "README.txt").write_text(
            f"MP716 {firmware_version} / OpenWrt {openwrt_version}\n"
            "状态 UNVERIFIED。禁止生产刷写。\n"
            "initramfs 用于 RAM 启动测试。sysupgrade 用于候选镜像离线校验。\n"
            "test-packages 下的签名和公钥仅用于实验室验证。\n",
            encoding="utf-8")
        entries = sorted(path for path in target.rglob("*") if path.is_file())
        (target / "sha256sums").write_text("".join(
            f"{sha256(path)}  {path.relative_to(target).as_posix()}\n" for path in entries),
            encoding="ascii", newline="\n")
        publish_directory(target, destination)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--build-commit", required=True)
    parser.add_argument("--image", nargs=3, action="append", required=True, metavar=("TYPE", "BUILD_DIR", "PROFILE"))
    parser.add_argument("--signed-test", type=Path)
    args = parser.parse_args()
    print(stage(args.output, args.image, args.build_commit, args.signed_test))
