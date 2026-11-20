#!/usr/bin/env python3
"""Inspect the actual delivered gmpdh plugin without loading target code.

OpenWrt sstrip removes section headers, so this uses program headers and the
dynamic table. A matching string anywhere in the file does not prove the
strongSwan loader's version ABI. Only the exported object and its relocated
pointer to the fixed version are accepted. This is not a tunnel test.
"""
import argparse
import binascii
import hashlib
import json
import lzma
from pathlib import Path
import re
import struct
import subprocess
import sys

PIN = '64900e756efa667774214f9c6b17c113222e01f7'
VERSION = '6.0.7'
PLUGIN = 'usr/lib/ipsec/plugins/libstrongswan-gmpdh.so'
PHYSICAL_PORTS = 'usr/share/mp716/physical-ports.uc'
MAX_BYTES = 4 * 1024 * 1024
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_DECODED_BYTES = 64 * 1024 * 1024
# The pinned MP716 kernel embeds its newc archive as ALONE LZMA,
# lc=1/lp=2/pb=2 with a 1 MiB dictionary. An unknown format needs review.
CPIO_LZMA_PREFIX = b'\x6d\x00\x00\x10\x00'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def inspect_plugin(data):
    require(52 <= len(data) <= MAX_BYTES, 'Invalid gmpdh ELF size')
    require(data[:7] == b'\x7fELF\x01\x01\x01', 'Expected ELF32 little-endian gmpdh')
    h = struct.unpack_from('<16sHHIIIIIHHHHHH', data)
    require(h[1:4] == (3, 8, 1) and h[8] == 52, 'Expected MIPS ET_DYN ELF v1')
    flags = h[7]
    require(flags & 0xf0000000 == 0x70000000 and flags & 0xf000 == 0x1000
            and not flags & 0x20 and flags & 6, 'Expected MIPS32R2 O32 PIC/CPIC ABI')
    require(h[9] == 32 and 1 <= h[10] <= 64, 'Invalid program header table')

    def bounded(offset, size):
        require(0 <= offset <= len(data) and 0 <= size <= len(data) - offset,
                'ELF range is outside the delivered file')
        return data[offset:offset + size]

    bounded(h[5], h[9] * h[10])
    ph = [struct.unpack_from('<IIIIIIII', data, h[5] + i * 32) for i in range(h[10])]
    for p in ph:
        bounded(p[1], p[4])
        require(p[4] <= p[5], 'Invalid ELF segment size')
    loads = [p for p in ph if p[0] == 1]
    require(loads and not any(p[0] == 3 for p in ph), 'Expected a shared plugin without PT_INTERP')

    def va(address, size, permissions=0):
        matches = [p for p in loads if p[2] <= address and size <= p[4]
                   and address - p[2] <= p[4] - size and p[6] & permissions == permissions]
        require(len(matches) == 1, 'Ambiguous or unmapped ELF virtual address')
        p = matches[0]
        return bounded(p[1] + address - p[2], size)

    abi = [p for p in ph if p[0] == 0x70000003]
    require(len(abi) == 1 and abi[0][4] == 24, 'Missing MIPS ABI flags')
    ab = struct.unpack('<H6B4I', bounded(abi[0][1], 24))
    require(ab[:7] == (0, 32, 2, 1, 0, 0, 3), 'Expected MIPS32R2 O32 soft-float ABI flags')
    dynamic = [p for p in ph if p[0] == 2]
    require(len(dynamic) == 1 and dynamic[0][4] % 8 == 0, 'Invalid PT_DYNAMIC')
    tags = {}
    terminated = False
    p = dynamic[0]
    for offset in range(p[1], p[1] + p[4], 8):
        tag, value = struct.unpack_from('<II', data, offset)
        if tag == 0:
            terminated = True
            break
        tags.setdefault(tag, []).append(value)
    require(terminated, 'Unterminated PT_DYNAMIC')

    def one(tag):
        values = tags.get(tag, [])
        require(len(values) == 1, 'Missing or duplicate dynamic tag ' + hex(tag))
        return values[0]

    require(one(11) == 16, 'Invalid ELF32 dynamic symbol size')
    count = one(0x70000011)  # DT_MIPS_SYMTABNO survives sstrip.
    require(1 <= count <= 65536, 'Invalid MIPS dynamic symbol count')
    if 4 in tags:  # SysV hash table provides an independent count.
        buckets, chains = struct.unpack('<II', va(one(4), 8))
        require(buckets > 0 and chains == count, 'Dynamic symbol/hash count mismatch')
        va(one(4), 8 + 4 * (buckets + chains))
    strings = va(one(5), one(10))

    def string(index):
        require(0 <= index < len(strings), 'Invalid dynamic string offset')
        end = strings.find(b'\0', index)
        require(end >= index, 'Unterminated dynamic string')
        try:
            return strings[index:end].decode('ascii')
        except UnicodeError as error:
            raise ValueError('Non-ASCII dynamic string') from error

    symbols = va(one(6), count * 16)
    wanted = {}
    for i in range(count):
        name, value, size, info, other, section = struct.unpack_from('<IIIBBH', symbols, i * 16)
        name = string(name)
        if name in ('gmpdh_plugin_create', 'gmpdh_plugin_version'):
            require(name not in wanted, 'Duplicate exported gmpdh symbol')
            wanted[name] = (value, size, info, other, section)
    for name, kind in [('gmpdh_plugin_create', 2), ('gmpdh_plugin_version', 1)]:
        require(name in wanted, 'Missing dynamic symbol ' + name)
        value, size, info, other, section = wanted[name]
        require(info >> 4 == 1 and info & 15 == kind and other & 3 == 0 and
                section not in (0, 0xfff1, 0xfff2) and section < 0xff00,
                'Expected defined GLOBAL DEFAULT ' + ('FUNC ' if kind == 2 else 'OBJECT ') + name)
        require(value != 0 and size > 0, 'Empty exported symbol ' + name)
        va(value & ~1 if kind == 2 else value, size, 1 if kind == 2 else 4)

    version_address, size, *_ = wanted['gmpdh_plugin_version']
    require(size == 4, 'Version export must be one O32 pointer object')
    pointer = struct.unpack('<I', va(version_address, 4))[0]
    # ET_DYN pointers must relocate against the image base. Do not accept an
    # arbitrary literal, undefined symbol binding, or another relocation kind.
    require(one(19) == 8 and one(18) % 8 == 0, 'Invalid ELF32 REL table')
    rel = va(one(17), one(18))
    matches = [struct.unpack_from('<II', rel, i) for i in range(0, len(rel), 8)
               if struct.unpack_from('<I', rel, i)[0] == version_address]
    require(matches == [(version_address, 3)], 'Version pointer needs exactly one local R_MIPS_REL32')
    require(va(pointer, len(VERSION) + 1, 4) == VERSION.encode('ascii') + b'\0',
            'gmpdh version object does not point to pinned strongSwan ' + VERSION)
    needed = [string(index) for index in tags.get(1, [])]
    return {'ok': True, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
            'elf': {'class': 'ELF32', 'byte_order': 'little', 'machine': 'MIPS',
                    'abi': 'O32', 'isa': 'MIPS32R2', 'float_abi': 'soft', 'flags': hex(flags)},
            'exports': {'gmpdh_plugin_create': 'defined GLOBAL DEFAULT FUNC',
                        'gmpdh_plugin_version': 'defined GLOBAL DEFAULT OBJECT'},
            'version_pointer_relocation': 'local R_MIPS_REL32', 'strongswan_version': VERSION,
            'needed': needed, 'test_status': 'UNVERIFIED', 'hardware_validated': False,
            'tunnel_interoperability_validated': False, 'flash_write': False}


def decode_lzma(data, *, trailing=False):
    try:
        decoder = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE, memlimit=128 * 1024 * 1024)
        decoded = decoder.decompress(data, max_length=MAX_DECODED_BYTES + 1)
    except lzma.LZMAError as error:
        raise ValueError('Invalid embedded LZMA stream') from error
    require(len(decoded) <= MAX_DECODED_BYTES and decoder.eof,
            'Truncated or oversized embedded LZMA stream')
    require(trailing or not decoder.unused_data, 'Unexpected trailing uImage LZMA data')
    return decoded, len(data) - len(decoder.unused_data)


def cpio_members(data):
    """Parse the exact in-memory archive; never extract names to the host."""
    cursor, entries, plugins, physical_ports = 0, 0, [], []
    while True:
        require(cursor + 110 <= len(data) and data[cursor:cursor + 6] == b'070701',
                'Malformed embedded newc archive')
        raw = data[cursor + 6:cursor + 110]
        require(re.fullmatch(b'[0-9a-fA-F]{104}', raw) is not None, 'Invalid newc header fields')
        values = [int(raw[i:i + 8], 16) for i in range(0, 104, 8)]
        mode, size, namesize = values[1], values[6], values[11]
        require(0 < namesize <= 4096 and cursor + 110 + namesize <= len(data), 'Invalid newc member name')
        name = data[cursor + 110:cursor + 110 + namesize]
        require(name[-1:] == b'\0' and b'\0' not in name[:-1], 'Invalid newc name terminator')
        start = (cursor + 110 + namesize + 3) & ~3
        require(start <= len(data) and size <= len(data) - start, 'Truncated newc member data')
        entries += 1
        require(entries <= 100000, 'Excessive embedded newc member count')
        cursor = (start + size + 3) & ~3
        if name == b'TRAILER!!!\0':
            require(size == 0 and not any(data[cursor:]), 'Trailing or concatenated newc data')
            return plugins, physical_ports
        if name[:-1] in (PLUGIN.encode('ascii'), b'./' + PLUGIN.encode('ascii')):
            require(mode & 0xf000 == 0x8000 and 0 < size <= MAX_BYTES,
                    'gmpdh CPIO member is not one regular plugin file')
            plugins.append(data[start:start + size])
        if name[:-1] in (PHYSICAL_PORTS.encode('ascii'), b'./' + PHYSICAL_PORTS.encode('ascii')):
            require(mode & 0xf000 == 0x8000 and 0 < size <= MAX_BYTES,
                    'physical-ports CPIO member is not one regular module file')
            physical_ports.append(data[start:start + size])


def physical_ports_sha256(data):
    expected = Path(__file__).resolve().parents[1] / 'integration/ram-web/physical-ports.uc'
    require(0 < len(data) <= MAX_BYTES and data == expected.read_bytes(),
            'Delivered physical-ports.uc differs from the current source')
    return hashlib.sha256(data).hexdigest()


def embedded_ram_plugin(payload):
    """Bind the plugin check to final uImage bytes, rather than a build-tree CPIO."""
    require(64 + 13 <= len(payload) <= MAX_IMAGE_BYTES, 'Invalid RAM uImage size')
    h = payload[:64]
    magic, stored_crc, _time, size, _load, _entry, data_crc = struct.unpack_from('>7I', h)
    require(magic == 0x27051956 and h[28:32] == bytes((5, 5, 2, 3)),
            'Expected RAM uImage MIPS Linux LZMA kernel')
    zeroed = bytearray(h)
    zeroed[4:8] = bytes(4)
    require(binascii.crc32(zeroed) & 0xffffffff == stored_crc, 'RAM uImage header CRC mismatch')
    require(size >= 13 and len(payload) == 64 + size, 'RAM uImage payload length mismatch')
    compressed = payload[64:]
    require(binascii.crc32(compressed) & 0xffffffff == data_crc, 'RAM uImage kernel CRC mismatch')
    kernel, _ = decode_lzma(compressed)
    archives, search = [], 0
    while True:
        offset = kernel.find(CPIO_LZMA_PREFIX, search)
        if offset < 0:
            break
        search = offset + 1
        try:
            archive, consumed = decode_lzma(kernel[offset:], trailing=True)
        except ValueError:
            continue  # Header-like constants in the kernel are not archives.
        if not archive.startswith(b'070701'):
            continue
        # An actual newc stream that is corrupt must not be ignored in favour
        # of a different valid archive. Nor may multiple archives be guessed.
        plugins, physical_ports = cpio_members(archive)
        archives.append((offset, consumed, archive, plugins, physical_ports))
        require(len(archives) == 1, 'Missing or ambiguous embedded initramfs CPIO')
    require(len(archives) == 1, 'Missing or ambiguous embedded initramfs CPIO')
    offset, consumed, archive, plugins, physical_ports = archives[0]
    require(len(plugins) == 1, 'Expected one exact gmpdh member in delivered initramfs CPIO')
    require(len(physical_ports) == 1, 'Expected one exact physical-ports.uc member in delivered initramfs CPIO')
    return plugins[0], {'kernel_crc_verified': True, 'uimage_header_crc_verified': True,
                        'physical_ports_sha256': physical_ports_sha256(physical_ports[0]),
                        'embedded_cpio_sha256': hashlib.sha256(archive).hexdigest(),
                        'embedded_cpio_kernel_offset': offset,
                        'embedded_cpio_compressed_bytes': consumed}


def extract_plugin(tree, output, mode):
    """Inspect one final image while the caller still owns its build lock."""
    if mode == 'initramfs':
        image_names = list(output.glob('*-yunxm_mp716-initramfs*-kernel.bin'))
        require(len(image_names) == 1, 'Expected one delivered initramfs image')
        image = image_names[0]
        require(image.is_file() and not image.is_symlink() and image.stat().st_size <= MAX_IMAGE_BYTES,
                'Invalid delivered RAM image file')
        payload = image.read_bytes()
        plugin, metadata = embedded_ram_plugin(payload)
        return plugin, {'image': image.name, 'image_type': mode,
                        'image_sha256': hashlib.sha256(payload).hexdigest(),
                        'source': 'delivered initramfs embedded CPIO', **metadata}
    else:
        require(mode == 'sysupgrade', 'Unknown image mode')
        images = list(output.glob('*-yunxm_mp716-squashfs-sysupgrade.bin'))
        require(len(images) == 1, 'Expected one delivered sysupgrade image')
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from packer.image_format import ImageError, inspect_payload
        # Validates the uImage header/CRC, kernel size and complete squashfs;
        # never locate rootfs by searching for the first hsqs byte sequence.
        try:
            payload = images[0].read_bytes()
            offset = inspect_payload(payload).squashfs_offset
        except ImageError as error:
            raise ValueError('Invalid sysupgrade payload: ' + error.detail) from error
        command = [str(tree / 'staging_dir/host/bin/unsquashfs4'), '-offset', str(offset),
                   '-cat', str(images[0]), PLUGIN]
        result = subprocess.run(command, capture_output=True, check=False, timeout=60)
        source = {'image': images[0].name, 'image_type': mode, 'image_sha256': hashlib.sha256(payload).hexdigest(),
                  'source': 'delivered sysupgrade squashfs', 'rootfs_offset': offset}
    require(result.returncode == 0, 'Exact gmpdh rootfs extraction failed')
    require(0 < len(result.stdout) <= MAX_BYTES, 'Invalid extracted gmpdh size')
    module = subprocess.run([*command[:-1], PHYSICAL_PORTS], capture_output=True, check=False, timeout=60)
    require(module.returncode == 0, 'Exact physical-ports.uc rootfs extraction failed')
    source['physical_ports_sha256'] = physical_ports_sha256(module.stdout)
    return result.stdout, source


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--elf', type=Path, help='inspect an already extracted plugin without running it')
    parser.add_argument('--openwrt-tree', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--image-type', choices=('initramfs', 'sysupgrade'))
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        pin = Path(__file__).resolve().parents[1].joinpath('config/openwrt.commit').read_text().strip()
        require(pin == PIN, 'REVIEW_REQUIRED: gmpdh ABI contract is pinned to OpenWrt ' + PIN)
        if args.elf:
            require(not any((args.openwrt_tree, args.output, args.image_type)), 'Choose ELF or image extraction')
            data, source = args.elf.read_bytes(), {'source': 'extracted ELF', 'file': args.elf.name}
        else:
            require(all((args.openwrt_tree, args.output, args.image_type)), 'Image extraction arguments are required')
            data, source = extract_plugin(args.openwrt_tree.resolve(), args.output.resolve(), args.image_type)
        result = {**inspect_plugin(data), 'openwrt_commit': pin, 'delivery': source}
    except (OSError, ValueError, struct.error, subprocess.TimeoutExpired) as error:
        result = {'ok': False, 'error': str(error), 'test_status': 'UNVERIFIED',
                  'hardware_validated': False, 'tunnel_interoperability_validated': False, 'flash_write': False}
    args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
    return 0 if result['ok'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
