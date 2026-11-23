#!/usr/bin/env python3
"""Wall-clock vs sum-of-latencies: simulates SPA firing parallel GETs (in-flight dedupe not modeled)."""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed


def login(base: str, password: str) -> str:
    req = urllib.request.Request(
        f"{base}/auth/login",
        data=json.dumps({"username": "admin", "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode())
    return body["data"]["token"]


def get_once(base: str, token: str, path: str, timeout: float) -> float:
    req = urllib.request.Request(
        f"{base}/{path}",
        headers={"Authorization": f"Bearer {token}"},
        method="GET",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        resp.read()
    return (time.perf_counter() - t0) * 1000.0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default=os.environ.get("ROUTER_HOST", "192.168.199.1"))
    p.add_argument(
        "--password",
        default=os.environ.get("ROUTER_ROOT_PASSWORD") or os.environ.get("ROUTER_SSH_PASSWORD") or "",
    )
    p.add_argument("--workers", type=int, default=6, help="parallel browser-like burst")
    p.add_argument("--rounds", type=int, default=3)
    p.add_argument(
        "--routes",
        nargs="+",
        default=["system/ping", "wireless/config", "home/dashboard", "hosts/connected"],
    )
    p.add_argument("--out", type=str, default=os.environ.get("BENCHMARK_OUT", "benchmark-client-parallel.json"))
    args = p.parse_args()
    if not args.password:
        print("Need ROUTER_ROOT_PASSWORD", file=sys.stderr)
        return 2

    base = f"http://{args.host}/cgi-bin/mp716"
    token = login(base, args.password)
    report: dict[str, object] = {"host": args.host, "workers": args.workers, "rounds": []}

    for r in range(args.rounds):
        if r == 1:
            time.sleep(0.5)
        latencies: list[float] = []
        t_wall = time.perf_counter()
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futs = [pool.submit(get_once, base, token, path, 60.0) for path in args.routes * max(1, args.workers // len(args.routes))]
            for fut in as_completed(futs):
                try:
                    latencies.append(fut.result())
                except urllib.error.HTTPError as e:
                    latencies.append(-float(e.code))
        wall_ms = (time.perf_counter() - t_wall) * 1000.0
        ok = [x for x in latencies if x > 0]
        round_rec = {
            "wall_ms": round(wall_ms, 1),
            "sum_ms": round(sum(ok), 1),
            "queue_penalty_ms": round(wall_ms - max(ok) if ok else wall_ms, 1),
            "p50_ms": round(statistics.median(ok), 1) if ok else None,
            "p95_ms": round(sorted(ok)[int(0.95 * (len(ok) - 1))], 1) if len(ok) > 1 else (ok[0] if ok else None),
            "count": len(ok),
        }
        report["rounds"].append(round_rec)
        print(f"round {r+1}: wall={round_rec['wall_ms']}ms sum={round_rec['sum_ms']}ms penalty={round_rec['queue_penalty_ms']}ms")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())