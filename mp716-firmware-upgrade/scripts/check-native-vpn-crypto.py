#!/usr/bin/env python3
"""Check the delivered kernel algorithms used by MP716's default ESP proposals.

A package flag is necessary but cannot prove delivery. A missing .ko requires
actual modules.builtin content from the delivered kernel, explicitly bound to
its version with --modules-builtin VERSION=FILE. Merely listing modules.builtin
or disabling a package is never evidence that an algorithm is built in.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

PIN = '64900e756efa667774214f9c6b17c113222e01f7'
PACKAGES = ('kmod-crypto-sha256', 'kmod-crypto-xcbc')
MODULES = {'sha256_generic': 'crypto/sha256_generic.ko',
           'libsha256': 'lib/crypto/libsha256.ko', 'xcbc': 'crypto/xcbc.ko'}


def normalize_listing(text):
    paths = set()
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('./'):
            line = line[2:]
        if line.startswith('squashfs-root/'):
            line = line[len('squashfs-root/'):]
        paths.add(line)
    return paths


def check(config, listing, *, builtins=None, pin=PIN):
    if pin != PIN:
        raise ValueError('REVIEW_REQUIRED: crypto contract is only verified for OpenWrt ' + PIN)
    flags = set(config.read_text(encoding='utf-8').splitlines())
    for package in PACKAGES:
        if 'CONFIG_PACKAGE_' + package + '=y' not in flags:
            raise ValueError('Missing final package selection: CONFIG_PACKAGE_' + package + '=y')
    paths = normalize_listing(listing.read_text(encoding='utf-8'))
    proofs = {}
    for version, file in (builtins or {}).items():
        if not re.fullmatch(r'[A-Za-z0-9_.+-]+', version):
            raise ValueError('Invalid modules.builtin kernel version')
        if 'lib/modules/' + version + '/modules.builtin' not in paths:
            raise ValueError('Builtin proof is not listed in the delivered kernel: ' + version)
        raw = file.read_bytes()
        proofs[version] = {'paths': set(raw.decode('utf-8').splitlines()),
                           'sha256': hashlib.sha256(raw).hexdigest()}
    checked = {}
    versions = set()
    for module, source_path in MODULES.items():
        matches = []
        expression = re.compile(r'lib/modules/([^/]+)/' + re.escape(module) + r'\.ko(?:\.(?:xz|zst|gz))?')
        for path in paths:
            match = expression.fullmatch(path)
            if match:
                matches.append((match[1], {'delivery': 'module', 'path': path}))
        for version, proof in proofs.items():
            if source_path in proof['paths'] or 'kernel/' + source_path in proof['paths']:
                matches.append((version, {'delivery': 'builtin', 'modules_builtin_sha256': proof['sha256']}))
        if not matches:
            raise ValueError('REVIEW_REQUIRED: ' + module + '.ko is absent and no delivered modules.builtin content proves it is built in')
        if len(matches) != 1:
            raise ValueError('REVIEW_REQUIRED: ambiguous kernel delivery for ' + module)
        version, evidence = matches[0]
        versions.add(version)
        checked[module] = {**evidence, 'kernel_version': version}
    if len(versions) != 1:
        raise ValueError('REVIEW_REQUIRED: crypto modules belong to different kernel versions')
    return {'ok': True, 'openwrt_commit': pin, 'packages': list(PACKAGES), 'modules': checked,
            'test_status': 'UNVERIFIED', 'hardware_validated': False, 'flash_write': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    parser.add_argument('listing', type=Path)
    parser.add_argument('--modules-builtin', action='append', default=[], metavar='VERSION=FILE')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args(argv)
    try:
        pin = Path(__file__).resolve().parents[1].joinpath('config/openwrt.commit').read_text(encoding='ascii').strip()
        builtins = {}
        for item in args.modules_builtin:
            version, separator, file = item.partition('=')
            if not separator or version in builtins:
                raise ValueError('Expected one --modules-builtin VERSION=FILE per kernel version')
            builtins[version] = Path(file)
        result = check(args.config, args.listing, builtins=builtins, pin=pin)
    except (OSError, ValueError, UnicodeError) as error:
        result = {'ok': False, 'error': str(error), 'test_status': 'UNVERIFIED', 'flash_write': False}
    output = json.dumps(result, indent=2) + '\n'
    if args.report:
        args.report.write_text(output, encoding='utf-8')
    print(output, end='')
    return 0 if result['ok'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
