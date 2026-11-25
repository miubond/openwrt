"""Install the device Web snapshot and the public test key into an OpenWrt overlay."""

import argparse
from datetime import datetime, timedelta, timezone
import re
import shutil
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def stage(
    bundle: Path,
    root: Path,
    *,
    web_dist: Path | None = None,
    test_key: bool = True,
    test_public_key: Path | None = None,
) -> None:
    key_destination = "etc/mp716-upgrade/upgrade.pub"
    public_key = None
    if test_public_key is not None:
        if not test_key:
            raise SystemExit("A test public key cannot be used with --no-test-key")
        public_key = test_public_key.read_bytes()
        if len(public_key) != 32:
            raise SystemExit("Expected a 32-byte raw Ed25519 test public key")
    paths = {
        "rootfs/www/cgi-bin/mp716": ("www/cgi-bin/mp716", 0o755),
        "rootfs/usr/share/rpcd/acl.d/mp716.json": ("usr/share/rpcd/acl.d/mp716.json", 0o644),
        "rootfs/usr/sbin/mp716-package-verify": ("usr/sbin/mp716-package-verify", 0o755),
    }
    if test_key and public_key is None:
        paths["test-data/upgrade.pub"] = (key_destination, 0o644)
    with ZipFile(bundle) as archive:
        entries = {entry.filename for entry in archive.infolist() if not entry.is_dir()}
        required = paths.keys() if web_dist else paths.keys() | {"rootfs/www/mp716/index.html"}
        if missing := required - entries:
            raise SystemExit("Missing Web inputs: " + ", ".join(sorted(missing)))
        for name in sorted(entries):
            if web_dist is None and name.startswith("rootfs/www/mp716/"):
                path = PurePosixPath(name)
                if ".." in path.parts or "\\" in name:
                    raise SystemExit(f"Invalid Web input path: {name}")
                paths[name] = (str(path.relative_to("rootfs")), 0o644)
        for name, (relative, mode) in paths.items():
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(name) as source, destination.open("wb") as output:
                shutil.copyfileobj(source, output)
            destination.chmod(mode)
    if public_key is not None:
        destination = root / key_destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(public_key)
        destination.chmod(0o644)
    if web_dist is not None:
        if not (web_dist / "index.html").is_file():
            raise SystemExit(f"Missing built Vue frontend: {web_dist}")
        shutil.copytree(web_dist, root / "www/mp716", dirs_exist_ok=True)
        # Serve the native Vue entry directly at the management IP. Assets and
        # the legacy /mp716/ entry keep their existing, API-independent paths.
        shutil.copyfile(web_dist / "index.html", root / "www/index.html")
    gateway = root / "usr/share/mp716/httpd.uc"
    gateway.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("httpd.uc"), gateway)
    gateway.chmod(0o644)
    for name in ("mp716-ucode-compile.sh", "build-meta.uc", "admin.uc", "admin-state.uc", "admin-tick.uc", "apply-task.uc", "network-values.uc", "system-values.uc", "physical-ports.uc", "perf-diag.uc", "dispatch.uc", "capabilities.uc", "native-routes.json",
                 "system-admin.uc", "system-apply.uc", "diagnostics.uc", "diagnostic-worker.sh",
                 "firewall-admin.uc", "network-services.uc", "network-routes.uc", "network-qos.uc", "port-links.sh",
                 "vpn.uc", "vpn-config.uc", "vpn-runtime.uc", "vpn-render.uc", "vpn-hook.uc", "vpn-services.uc", "vpn-health.uc",
                 "wireguard.uc", "wg-health.uc",
                 "vpn-ppp-up.sh", "vpn-ppp-down.sh", "vpn-openvpn-up.sh", "vpn-openvpn-down.sh"):
        shutil.copyfile(Path(__file__).with_name(name), gateway.with_name(name))
        gateway.with_name(name).chmod(0o755 if name.endswith(".sh") else 0o644)
    vpn_init = root / "etc/init.d/mp716-vpn"
    vpn_init.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("mp716-vpn.init"), vpn_init)
    vpn_init.chmod(0o755)
    keep = root / "lib/upgrade/keep.d/mp716-admin"
    keep.parent.mkdir(parents=True, exist_ok=True)
    keep.write_text("/etc/mp716-admin/\n/etc/mp716-vpn/\n/etc/mp716-upgrade/installed.at\n", encoding="ascii")
    init = root / "etc/init.d/mp716-admin"
    init.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("mp716-admin.init"), init)
    init.chmod(0o755)
    defaults = root / "etc/uci-defaults/98-mp716-admin"
    defaults.parent.mkdir(parents=True, exist_ok=True)
    defaults.write_text("#!/bin/sh\n/etc/init.d/mp716-admin enable\n/etc/init.d/mp716-vpn enable\n/etc/init.d/mp716-admin start\n/etc/init.d/mp716-vpn start\n", encoding="ascii")
    defaults.chmod(0o755)
    version = Path(__file__).resolve().parents[2].joinpath("config/firmware.version").read_text(encoding="ascii").strip()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise SystemExit("Invalid firmware build version")
    (root / "etc/mp716-build.version").write_text(version + "\n", encoding="ascii")
    # Shown verbatim as the release time in the Web UI, which has no time zone label.
    built = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S")
    (root / "etc/mp716-build.date").write_text(built + "\n", encoding="ascii")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("root", type=Path)
    parser.add_argument("--web-dist", type=Path)
    key_options = parser.add_mutually_exclusive_group()
    key_options.add_argument("--no-test-key", action="store_true")
    key_options.add_argument("--test-public-key", type=Path)
    args = parser.parse_args()
    stage(
        args.bundle, args.root, web_dist=args.web_dist,
        test_key=not args.no_test_key, test_public_key=args.test_public_key,
    )
