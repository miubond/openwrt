"""Install the device Web snapshot and the public test key into an OpenWrt overlay."""

import shutil
import sys
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def stage(bundle: Path, root: Path) -> None:
    paths = {
        "rootfs/www/cgi-bin/mp716": ("www/cgi-bin/mp716", 0o755),
        "rootfs/usr/share/rpcd/acl.d/mp716.json": ("usr/share/rpcd/acl.d/mp716.json", 0o644),
        "rootfs/usr/sbin/mp716-package-verify": ("usr/sbin/mp716-package-verify", 0o755),
        "test-data/upgrade.pub": ("etc/mp716-upgrade/upgrade.pub", 0o644),
    }
    with ZipFile(bundle) as archive:
        entries = {entry.filename for entry in archive.infolist() if not entry.is_dir()}
        required = paths.keys() | {"rootfs/www/mp716/index.html"}
        if missing := required - entries:
            raise SystemExit("Missing Web inputs: " + ", ".join(sorted(missing)))
        for name in sorted(entries):
            if name.startswith("rootfs/www/mp716/"):
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
    gateway = root / "usr/share/mp716/httpd.uc"
    gateway.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(Path(__file__).with_name("httpd.uc"), gateway)
    gateway.chmod(0o644)


if __name__ == "__main__":
    stage(Path(sys.argv[1]), Path(sys.argv[2]))
