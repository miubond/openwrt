#!/usr/bin/env python3
"""Measure MP716 native GET latency (P50/P95/P99). Requires ROUTER_HOST and ROUTER_ROOT_PASSWORD."""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def percentile(samples: list[float], p: float) -> float:
    if not samples:
        return 0.0
    ordered = sorted(samples)
    idx = int(round((p / 100.0) * (len(ordered) - 1)))
    return ordered[max(0, min(idx, len(ordered) - 1))]


def load_get_routes(repo_root: Path) -> list[str]:
    routes_file = repo_root / "integration/ram-web/native-routes.json"
    rows = json.loads(routes_file.read_text(encoding="utf-8"))
    get_paths = []
    for item in rows:
        if not item.startswith("GET "):
            continue
        path = item[4:]
        if ":id" in path:
            continue
        get_paths.append(path)
    return get_paths


def login(base: str, user: str, password: str) -> str:
    req = urllib.request.Request(
        f"{base}/auth/login",
        data=json.dumps({"username": user, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode())
    if not body.get("ok"):
        raise RuntimeError(f"login failed: {body}")
    return str(body["data"]["token"])


def timed_get(base: str, token: str, path: str, timeout: float) -> tuple[float, int, str | None]:
    req = urllib.request.Request(
        f"{base}/{path}",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            ms = (time.perf_counter() - start) * 1000.0
            return ms, resp.status, None
    except urllib.error.HTTPError as e:
        ms = (time.perf_counter() - start) * 1000.0
        return ms, e.code, e.read(256).decode(errors="replace")
    except Exception as e:  # noqa: BLE001
        ms = (time.perf_counter() - start) * 1000.0
        return ms, -1, str(e)


def main() -> int:
    parser = argparse.ArgumentParser(description="MP716 native API GET benchmark")
    parser.add_argument("--host", default=os.environ.get("ROUTER_HOST", "192.168.199.1"))
    parser.add_argument("--user", default=os.environ.get("ROUTER_LOGIN_USER", "admin"))
    parser.add_argument(
        "--password",
        default=os.environ.get("ROUTER_ROOT_PASSWORD") or os.environ.get("ROUTER_SSH_PASSWORD") or "",
    )
    parser.add_argument("--iterations", type=int, default=8)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--routes", nargs="*", help="subset of route paths (no GET prefix)")
    parser.add_argument("--out", type=Path, default=Path("benchmark-native-api.json"))
    args = parser.parse_args()

    if not args.password:
        print("Set ROUTER_ROOT_PASSWORD or --password", file=sys.stderr)
        return 2

    repo = Path(__file__).resolve().parents[1]
    routes = args.routes or load_get_routes(repo)
    base = f"http://{args.host}/cgi-bin/mp716"

    token = login(base, args.user, args.password)
    print(f"logged in, {len(routes)} GET routes, {args.iterations} iterations each")

    report: dict[str, object] = {
        "host": args.host,
        "iterations": args.iterations,
        "warmup": args.warmup,
        "routes": {},
    }

    all_slow: list[tuple[str, float]] = []

    for path in routes:
        samples: list[float] = []
        last_err: str | None = None
        status = 0
        for i in range(args.warmup + args.iterations):
            ms, status, err = timed_get(base, token, path, args.timeout)
            if err and status != 200:
                last_err = err
            if i >= args.warmup and status == 200:
                samples.append(ms)
        entry = {
            "status": status,
            "error": last_err,
            "count": len(samples),
            "p50_ms": round(percentile(samples, 50), 1),
            "p95_ms": round(percentile(samples, 95), 1),
            "p99_ms": round(percentile(samples, 99), 1),
            "mean_ms": round(statistics.mean(samples), 1) if samples else None,
        }
        report["routes"][path] = entry
        if samples:
            all_slow.append((path, entry["p95_ms"]))
        mark = "OK" if samples else "FAIL"
        print(f"{mark} {path:40} p50={entry['p50_ms']} p95={entry['p95_ms']} ms")

    all_slow.sort(key=lambda x: x[1], reverse=True)
    report["slowest_p95"] = [{"route": p, "p95_ms": v} for p, v in all_slow[:10]]
    args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())