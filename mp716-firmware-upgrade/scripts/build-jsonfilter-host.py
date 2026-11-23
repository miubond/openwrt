#!/usr/bin/env python3
"""Build the pinned real OpenWrt jsonfilter for Linux host regressions only."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
JSONPATH_PIN = "b9034210bd331749673416c6bf389cccd4e23610"
LIBUBOX_PIN = "7dd127841e82eb1cfb61185da37dde7b9bd9ba6d"
SOURCE_ROOT = "jsonpath-" + JSONPATH_PIN
SOURCES = {
    "jsonpath.tar.gz": (
        "https://codeload.github.com/openwrt/jsonpath/tar.gz/" + JSONPATH_PIN,
        "b66682e8d66cd86cabe209aba6f395936817656c9a3078df7f33ee6922d5eb38",
    ),
    "list.h": (
        f"https://raw.githubusercontent.com/openwrt/libubox/{LIBUBOX_PIN}/list.h",
        "8ca757c8053da9da5c68fe8ba27918da9544030152ad065023c328c1f48d677b",
    ),
    "utils.h": (
        f"https://raw.githubusercontent.com/openwrt/libubox/{LIBUBOX_PIN}/utils.h",
        "a3c97f1b6d431041816ab6c085d6f44811d6d2bfb1e694c2ba7b501be226a2d8",
    ),
    "utils.c": (
        f"https://raw.githubusercontent.com/openwrt/libubox/{LIBUBOX_PIN}/utils.c",
        "22447191e1048d165207808a3ec5d882f7e66b39fa109a3a420a74bba76fb726",
    ),
}
FLAGS = ["-Os", "-std=gnu99", "-D_GNU_SOURCE", "-DJSONC"]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def output(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{shlex.join(command)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def tool(name: str) -> str:
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f"Required host tool not found: {name}; install gcc, pkg-config and libjson-c-dev")
    return str(Path(found).resolve())


def download(cache: Path, name: str, url: str, expected: str) -> Path:
    path = cache / (expected[:16] + "-" + name)
    if path.exists():
        if digest(path) != expected:
            raise RuntimeError(f"SHA-256 mismatch in cached source {path}; remove that file before retrying")
        return path
    print(f"Downloading pinned source: {name}", file=sys.stderr)
    with tempfile.NamedTemporaryFile(dir=cache, prefix="download-", delete=False) as temporary:
        pending = Path(temporary.name)
        try:
            with urllib.request.urlopen(url, timeout=45) as response:
                total = 0
                while chunk := response.read(65536):
                    total += len(chunk)
                    if total > 8 * 1024 * 1024:
                        raise RuntimeError(f"Source download is unexpectedly large: {url}")
                    temporary.write(chunk)
            temporary.flush()
            if digest(pending) != expected:
                raise RuntimeError(f"SHA-256 mismatch downloading {name} from {url}; source was not accepted")
            os.replace(pending, path)
        finally:
            pending.unlink(missing_ok=True)
    return path


def extract_source(archive: Path, destination: Path) -> Path:
    """Extract regular source files only, without following archive links."""
    seen = set()
    with tarfile.open(archive, "r:gz") as source:
        for member in source.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or not name.parts or name.parts[0] != SOURCE_ROOT or \
                    ".." in name.parts or "\\" in member.name or name in seen:
                raise RuntimeError(f"Unsafe or duplicate source archive path: {member.name!r}")
            seen.add(name)
            target = destination.joinpath(*name.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                content = source.extractfile(member)
                if content is None:
                    raise RuntimeError(f"Unreadable source archive member: {member.name}")
                with content, target.open("wb") as stream:
                    shutil.copyfileobj(content, stream)
            else:
                raise RuntimeError(f"Unsupported source archive member: {member.name!r}")
    return destination / SOURCE_ROOT


def run(command: list[str], directory: Path) -> None:
    subprocess.run(command, cwd=directory, stdout=sys.stderr, check=True)


def build(binary: Path, sources: dict[str, Path], cache: Path, cc: str,
          cflags: list[str], libraries: list[str]) -> None:
    with tempfile.TemporaryDirectory(dir=cache, prefix="compile-") as temporary:
        stage = Path(temporary)
        source = extract_source(sources["jsonpath.tar.gz"], stage)
        include = stage / "include" / "libubox"
        include.mkdir(parents=True)
        for name in ("list.h", "utils.h", "utils.c"):
            shutil.copyfile(sources[name], include / name)
        lemon = source / "contrib/lemon"
        run([cc, "-std=gnu17", "-O2", "contrib/lemon.c", "-o", str(lemon)], source)
        run([str(lemon), "parser.y"], source)
        candidate = stage / "jsonfilter"
        run([cc, *FLAGS, "-I" + str(stage / "include"), *cflags,
             "main.c", "ast.c", "lexer.c", "parser.c", "matcher.c",
             str(include / "utils.c"), *libraries, "-o", str(candidate)], source)
        smoke = output([str(candidate), "-s", '{"enabled":true,"guard":"input"}',
                        "-t", "@.enabled", "-e", "@.guard"])
        if smoke != "boolean\ninput":
            raise RuntimeError(f"Real jsonfilter smoke check failed: {smoke!r}")
        # Candidate and output can reside on different filesystems. Copy into
        # the output directory before atomically replacing the previous binary.
        with tempfile.NamedTemporaryFile(dir=binary.parent, prefix=".jsonfilter-", delete=False) as item:
            pending = Path(item.name)
        try:
            shutil.copyfile(candidate, pending)
            pending.chmod(0o755)
            os.replace(pending, binary)
        finally:
            pending.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "build/host-tools/jsonfilter")
    parser.add_argument("--cc", default=os.environ.get("CC", "gcc"), help="C compiler executable, without extra flags")
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        raise RuntimeError("This bootstrap requires Linux; provide an existing real JSONFILTER binary on other hosts")
    cc = tool(args.cc)
    pkg_config = tool("pkg-config")
    try:
        json_c_version = output([pkg_config, "--modversion", "json-c"])
        cflags = shlex.split(output([pkg_config, "--cflags", "json-c"]))
        libraries = shlex.split(output([pkg_config, "--libs", "json-c"]))
    except RuntimeError as error:
        raise RuntimeError("json-c development package not available; install libjson-c-dev: " + str(error)) from error
    binary = args.output.resolve()
    binary.parent.mkdir(parents=True, exist_ok=True)
    cache = binary.parent / "jsonfilter-cache"
    cache.mkdir(exist_ok=True)
    sources = {name: download(cache, name, url, sha) for name, (url, sha) in SOURCES.items()}
    inputs = {
        "script_sha256": digest(Path(__file__)),
        "sources": {name: {"url": url, "sha256": sha} for name, (url, sha) in SOURCES.items()},
        "compiler": {"path": cc, "sha256": digest(Path(cc)),
                     "version": output([cc, "--version"]), "target": output([cc, "-dumpmachine"])},
        "host": platform.platform(),
        "json_c": {"version": json_c_version, "cflags": cflags, "libraries": libraries},
        "flags": FLAGS,
    }
    provenance = binary.with_name(binary.name + ".provenance.json")
    try:
        previous = json.loads(provenance.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = {}
    if previous.get("inputs") == inputs and binary.is_file() and os.access(binary, os.X_OK) and \
            previous.get("binary_sha256") == digest(binary):
        print(f"Using verified cached jsonfilter (system json-c {json_c_version})", file=sys.stderr)
    else:
        build(binary, sources, cache, cc, cflags, libraries)
        record = {
            "inputs": inputs,
            "binary_sha256": digest(binary),
            "jsonpath_commit": JSONPATH_PIN,
            "libubox_commit": LIBUBOX_PIN,
            "scope": "Real upstream jsonfilter with complete Linux libubox utils.c and system POSIX regex/json-c; no parser modifications or Python substitute.",
            "dependency_note": "Ubuntu 24.04 system json-c is 0.17; the separate Windows host build uses 0.18. The actual Linux version is recorded above. This host check does not establish equivalence to the target firmware, libc, or json-c runtime.",
        }
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=binary.parent,
                                         prefix=".jsonfilter-provenance-", delete=False) as item:
            pending = Path(item.name)
            json.dump(record, item, indent=2)
            item.write("\n")
        try:
            os.replace(pending, provenance)
        finally:
            pending.unlink(missing_ok=True)
        print(f"Built real pinned jsonfilter (system json-c {json_c_version})", file=sys.stderr)
    print(binary)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print(f"jsonfilter host build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
