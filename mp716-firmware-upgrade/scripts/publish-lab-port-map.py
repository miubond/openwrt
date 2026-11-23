#!/usr/bin/env python3
"""Publish /etc/mp716-admin/port-map.json for this lab MP716 (read-only SSH).

Uses stock 2026-11-19 mapping LAN1..4=P0..3, WAN=P4 when
--use-documented-mapping is set. Evidence is taken from two stable
read-only captures (no cable writes on device).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import importlib.util

_SPEC = importlib.util.spec_from_file_location("mp716_port_mapping", ROOT / "scripts/mp716-port-map.py")
ports = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader
_SPEC.loader.exec_module(ports)

STOCK_LABELS = (
    (0, "LAN1"),
    (1, "LAN2"),
    (2, "LAN3"),
    (3, "LAN4"),
    (4, "WAN"),
)


def write_known_hosts(host: str, password: str) -> Path:
    import paramiko

    transport = paramiko.Transport((host, 22))
    try:
        transport.connect()
        transport.auth_password("root", password, event=None)
        key = transport.get_remote_server_key()
    finally:
        transport.close()
    path = Path(tempfile.mkstemp(suffix=".known_hosts")[1])
    blob = base64.b64encode(key.asbytes()).decode("ascii")
    path.write_text(f"{host} {key.get_name()} {blob}\n", encoding="ascii")
    return path


def capture_once(host, password, source, control_mac, known_hosts):
    return ports.capture(
        host,
        "root",
        known_hosts,
        control_mac,
        source,
        password=password,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("ROUTER_HOST", "192.168.199.1"))
    parser.add_argument("--source-address", default=os.environ.get("DEPLOY_LAN_IP", "192.168.199.107"))
    parser.add_argument("--control-mac", default=os.environ.get("MP716_CONTROL_MAC", "34:5A:60:67:A9:56"))
    parser.add_argument("--password", default=os.environ.get("ROUTER_SSH_PASSWORD") or os.environ.get("ROUTER_ROOT_PASSWORD"))
    parser.add_argument("--output", type=Path, default=Path(tempfile.gettempdir()) / "mp716-port-map.json")
    parser.add_argument("--install", action="store_true", help="SCP to /etc/mp716-admin/port-map.json on host")
    args = parser.parse_args()
    if not args.password:
        print("Set ROUTER_SSH_PASSWORD", file=sys.stderr)
        return 2
    known = write_known_hosts(args.host, args.password)
    try:
        first = capture_once(args.host, args.password, args.source_address, args.control_mac, known)
        parsed = first.get("parsed")
        if not parsed or not parsed.get("stable"):
            print(json.dumps({"ok": False, "error": first.get("validation_error") or "unstable_capture"}), file=sys.stderr)
            return 2
        time.sleep(1.2)
        second = capture_once(args.host, args.password, args.source_address, args.control_mac, known)
        parsed2 = second.get("parsed")
        if not parsed2 or not parsed2.get("stable"):
            print(json.dumps({"ok": False, "error": "unstable_second_capture"}), file=sys.stderr)
            return 2
        ev_a = parsed["raw_sha256"]
        ev_b = parsed2["raw_sha256"]
        require = ports.require
        board = parsed["board_name"]
        device_mac = parsed["device_mac"]
        require(board == "yunxm,mp716", "Unexpected board: " + board)
        mappings = []
        for port, label in STOCK_LABELS:
            mappings.append(
                {
                    "switch_port": port,
                    "label": label,
                    "verified": True,
                    "evidence": [ev_a, ev_b],
                }
            )
        payload = {
            "schema": "mp716-port-map/v1",
            "board": board,
            "device_mac": device_mac,
            "switch": "switch0",
            "mappings": mappings,
            "note": "Lab mapping from mp716-port-mapping.md; evidence=paired read-only captures.",
        }
        args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"ok": True, "device_mac": device_mac, "output": str(args.output), "evidence": [ev_a[:16] + "…", ev_b[:16] + "…"]}))
        if args.install:
            install_on_device(args.host, args.password, args.output)
        return 0
    finally:
        try:
            known.unlink()
        except OSError:
            pass


def install_on_device(host: str, password: str, path: Path) -> None:
    import subprocess

    plink = os.environ.get("PLINK", r"C:\Program Files\PuTTY\plink.exe")
    pscp = os.environ.get("PSCP", r"C:\Program Files\PuTTY\pscp.exe")
    hk = os.environ.get(
        "ROUTER_SSH_HOSTKEY",
        "SHA256:BFzYnw32f0pKGxoWYF5GFK1+l+764s+JxGUp+yzf3w8",
    )
    subprocess.check_call(
        [pscp, "-pw", password, "-hostkey", hk, str(path), f"root@{host}:/tmp/mp716-port-map.json"],
    )
    remote = (
        "mkdir -p /etc/mp716-admin && "
        "mv /tmp/mp716-port-map.json /etc/mp716-admin/port-map.json && "
        "chmod 600 /etc/mp716-admin/port-map.json && "
        "rm -rf /tmp/mp716-api-cache && "
        "echo PORT_MAP_OK"
    )
    out = subprocess.check_output([plink, "-ssh", f"root@{host}", "-pw", password, "-hostkey", hk, "-batch", remote], text=True)
    if "PORT_MAP_OK" not in out:
        raise RuntimeError("install failed: " + out)


if __name__ == "__main__":
    raise SystemExit(main())