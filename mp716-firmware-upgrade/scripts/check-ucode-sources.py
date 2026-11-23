#!/usr/bin/env python3
"""Reject JS-only syntax in device ucode sources (backticks break mp716 admin load)."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1] / 'integration' / 'ram-web'
BACKTICK = re.compile(r'`')
def main() -> int:
    bad: list[str] = []
    for path in sorted(ROOT.rglob('*.uc')):
        if '/tests/' in path.as_posix():
            continue
        text = path.read_text(encoding='utf-8')
        if text.startswith('\ufeff'):
            bad.append(f"{path.relative_to(ROOT.parents[1]).as_posix()}: UTF-8 BOM")
        if BACKTICK.search(text):
            bad.append(path.relative_to(ROOT.parents[1]).as_posix())
    if bad:
        print('ucode sources must not use backtick template literals:', file=sys.stderr)
        for name in bad:
            print(f'  - {name}', file=sys.stderr)
        return 1
    print(f'check-ucode-sources: ok ({len(list(ROOT.rglob("*.uc")))} files)')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())