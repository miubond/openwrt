"""Install the device Web snapshot and the public test key into an OpenWrt overlay."""

import argparse
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
    gateway = root / "usr/share/mp716/httpd.uc"
    gateway.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("httpd.uc"), gateway)
    gateway.chmod(0o644)


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
