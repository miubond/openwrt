"""Copy a local file to the router byte-for-byte over ssh stdin.

Windows PowerShell's Process.StandardInput writes a UTF-8 BOM before the
first byte, which corrupts ucode, shell shebangs, keys and tarballs.
"""
import argparse
import subprocess
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("host")
    ap.add_argument("local")
    ap.add_argument("remote")
    ap.add_argument("--mode", default="644")
    ap.add_argument("--text", action="store_true", help="strip BOM and CRLF before sending")
    ap.add_argument("--expect-size", type=int, default=0)
    args = ap.parse_args()

    with open(args.local, "rb") as fh:
        data = fh.read()
    if args.text:
        if data.startswith(b"\xef\xbb\xbf"):
            data = data[3:]
        data = data.replace(b"\r\n", b"\n")
    if args.expect_size and len(data) != args.expect_size:
        print(f"{args.local}: size {len(data)} != {args.expect_size}", file=sys.stderr)
        return 2

    remote = args.remote.replace("'", "")
    tmp = remote + ".push"
    cmd = (
        f"cat > '{tmp}' && [ $(wc -c < '{tmp}') -eq {len(data)} ] "
        f"&& chmod {args.mode} '{tmp}' && mv -f '{tmp}' '{remote}'"
    )
    proc = subprocess.run(
        ["ssh", "-o", "ConnectTimeout=15", f"root@{args.host}", cmd],
        input=data,
    )
    if proc.returncode != 0:
        print(f"push failed: {remote}", file=sys.stderr)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
