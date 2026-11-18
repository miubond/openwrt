#!/usr/bin/env python3
"""Build and verify a LAN-enabled MP716 OpenWrt test image from the known test build."""

import argparse
import hashlib
import io
import json
import lzma
from pathlib import Path, PurePosixPath
import struct
import subprocess
import sys
import tarfile
import tempfile
import zipfile
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from packer.image_format import inspect_payload


BASE_SHA256 = "9c7367233b2eb7af815eb32907b0a872d2a1a468cfb7ed160bdb7bb20e920c58"
PARTITION_BYTES = 0x7B0000
ROOTFS_BLOCK_SIZE = 65536
JFFS_END = b"\xde\xad\xc0\xde"
FWTOOL_TRAILER = struct.Struct(">4sIB3sI")
FDT_HEADER = struct.Struct(">10I")
ETH = "/ethernet@10100000"
SWITCH = "/esw@10110000"
WIFI = "/wmac@10300000"
SPI = "/palmbus@10000000/spi@b00"
BOARD = "yunxm,mp716"
LAN_SCRIPT = "etc/board.d/03_mp716_lan"
IMAGE_NAME = "MP716-OpenWrt-25.12.6-LAN-migration-TEST-sysupgrade.bin"


def check(condition, message):
    if not condition:
        raise ValueError(message)


def align(size, block):
    return (size + block - 1) // block * block


def fdt_properties(dtb):
    magic, total, tree, strings, _, _, _, _, string_len, tree_len = FDT_HEADER.unpack_from(dtb)
    check(magic == 0xD00DFEED and total == len(dtb), "Unexpected appended DTB")
    check(tree + tree_len <= strings and strings + string_len <= total, "Invalid DTB layout")
    props, nodes = {}, []
    pos = tree
    while pos < tree + tree_len:
        token = struct.unpack_from(">I", dtb, pos)[0]
        pos += 4
        if token == 1:
            end = dtb.index(0, pos)
            nodes.append(dtb[pos:end].decode())
            pos = align(end + 1, 4)
        elif token == 2:
            nodes.pop()
        elif token == 3:
            length, key_offset = struct.unpack_from(">II", dtb, pos)
            key_at = strings + key_offset
            key = dtb[key_at:dtb.index(0, key_at)].decode()
            props[("/".join(nodes), key)] = (pos, dtb[pos + 8:pos + 8 + length])
            pos += 8 + align(length, 4)
        elif token == 9:
            return props
        else:
            check(token == 4, f"Unexpected DTB token {token}")
    raise ValueError("Missing DTB end token")


def replace_status(dtb, node, value):
    position, old = fdt_properties(dtb)[(node, "status")]
    header = list(FDT_HEADER.unpack_from(dtb))
    start = position + 8
    changed = dtb[:position] + struct.pack(">I", len(value)) + dtb[position + 4:start]
    changed += value.ljust(align(len(value), 4), b"\x00") + dtb[start + align(len(old), 4):]
    difference = len(changed) - len(dtb)
    header[1] += difference
    header[3] += difference
    header[9] += difference
    return FDT_HEADER.pack(*header) + changed[FDT_HEADER.size:]


def split_kernel(blob):
    length = struct.unpack_from(">I", blob, 12)[0]
    kernel = lzma.decompress(blob[64:64 + length], format=lzma.FORMAT_ALONE, memlimit=128 << 20)
    dtb_at = kernel.rfind(b"\xd0\x0d\xfe\xed")
    check(dtb_at > 0, "MP716 DTB not found")
    dtb = kernel[dtb_at:]
    compatible = fdt_properties(dtb)[("", "compatible")][1].split(b"\0")
    check(compatible[0] == BOARD.encode(), "Image is not an MP716 build")
    return kernel[:dtb_at], dtb


def make_kernel(original, binary, dtb):
    uncompressed = binary + dtb
    filters = [dict(id=lzma.FILTER_LZMA1, dict_size=8 << 20, lc=1, lp=2, pb=2)]
    compressed = lzma.compress(uncompressed, format=lzma.FORMAT_ALONE, filters=filters)
    compressed = compressed[:5] + struct.pack("<Q", len(uncompressed)) + compressed[13:]
    check(compressed[:5] == original[64:69], "LZMA properties changed")
    check(lzma.decompress(compressed, format=lzma.FORMAT_ALONE) == uncompressed, "Kernel round trip failed")
    header = bytearray(original[:64])
    struct.pack_into(">I", header, 4, 0)
    struct.pack_into(">I", header, 12, len(compressed))
    struct.pack_into(">I", header, 24, zlib.crc32(compressed))
    struct.pack_into(">I", header, 4, zlib.crc32(header))
    return bytes(header) + compressed


def split_metadata(blob):
    magic, crc, kind, reserved, size = FWTOOL_TRAILER.unpack_from(blob, len(blob) - FWTOOL_TRAILER.size)
    check((magic, kind, reserved) == (b"FWx0", 1, bytes(3)), "Expected unsigned OpenWrt metadata")
    check(FWTOOL_TRAILER.size + 8 < size < len(blob), "Invalid metadata length")
    check(crc == (zlib.crc32(blob[:-FWTOOL_TRAILER.size]) ^ 0xFFFFFFFF), "Metadata CRC mismatch")
    record = blob[-size:-FWTOOL_TRAILER.size]
    check(record[:8] == bytes(8), "Unexpected metadata record header")
    metadata = json.loads(record[8:])
    check(metadata["supported_devices"] == [BOARD], "Wrong OpenWrt supported_devices")
    return blob[:-size], record


def rootfs_bytes(blob):
    structure = inspect_payload(blob)
    start = structure.squashfs_offset
    return blob[start:start + structure.squashfs_bytes_used]


def squashfs_tool(directory, name):
    return directory / (name + (".exe" if sys.platform == "win32" else ""))


def pack_rootfs(original, work, tools, lan_script):
    original_sqfs = work / "base.squashfs"
    original_sqfs.write_bytes(rootfs_bytes(original))
    base_tar = work / "base.tar"
    with base_tar.open("wb") as sink:
        subprocess.run([squashfs_tool(tools, "sqfs2tar"), "-r", ".", original_sqfs], stdout=sink, check=True)
    expected = tar_manifest(base_tar)
    check("etc/board.d" in expected and LAN_SCRIPT not in expected, "Unexpected rootfs board scripts")
    check(not {"etc/board.json", "etc/config/network"} & expected.keys(),
          "Preconfigured network would skip LAN detection")
    with tarfile.open(base_tar, "a") as root:
        entry = tarfile.TarInfo(LAN_SCRIPT)
        entry.mode, entry.size = 0o755, len(lan_script)
        root.addfile(entry, io.BytesIO(lan_script))
    rebuilt = work / "lan.squashfs"
    block_size = struct.unpack_from("<I", original_sqfs.read_bytes(), 12)[0]
    with base_tar.open("rb") as source:
        subprocess.run([squashfs_tool(tools, "tar2sqfs"), "-q", "-s", "-c", "xz", "-b", str(block_size), rebuilt],
                       stdin=source, check=True)
    return rebuilt.read_bytes(), expected


def tar_manifest(path):
    manifest = {}
    with tarfile.open(path) as archive:
        for item in archive:
            name = str(PurePosixPath(item.name))
            content = hashlib.sha256(archive.extractfile(item).read()).hexdigest() if item.isfile() else None
            xattrs = {k: v for k, v in item.pax_headers.items() if "xattr" in k}
            manifest[name] = (item.type, item.mode, item.uid, item.gid, item.linkname,
                              item.devmajor, item.devminor, content, xattrs)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--squashfs-tools", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    original = args.base.read_bytes()
    check(hashlib.sha256(original).hexdigest() == BASE_SHA256, "Unexpected input test image")
    original_body, record = split_metadata(original)
    check(original_body.endswith(JFFS_END) and (len(original_body) - 4) % ROOTFS_BLOCK_SIZE == 0,
          "Unexpected JFFS2 padding")
    kernel, base_dtb = split_kernel(original)
    check(fdt_properties(base_dtb)[(ETH, "status")][1] == b"disabled\0", "Unexpected baseline Ethernet status")
    dtb = replace_status(base_dtb, ETH, b"okay\0")
    # With no status property the inherited SoC switch is already available.
    if (SWITCH, "status") in fdt_properties(base_dtb):
        dtb = replace_status(dtb, SWITCH, b"okay\0")
    lan_script = (Path(__file__).resolve().parents[1] / "integration/ram-web/03_mp716_ram_web").read_bytes()
    lan_script = lan_script.replace(b"\r\n", b"\n")
    check(b"ucidef_set_interface_lan eth0\n" in lan_script, "Missing LAN initialization")
    args.output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output) as directory:
        work = Path(directory)
        rootfs, original_files = pack_rootfs(original, work, args.squashfs_tools, lan_script)
        body = make_kernel(original, kernel, dtb) + rootfs
        body = body.ljust(align(len(body), ROOTFS_BLOCK_SIZE), b"\xff") + JFFS_END + record
        crc = zlib.crc32(body) ^ 0xFFFFFFFF
        image = body + FWTOOL_TRAILER.pack(b"FWx0", crc, 1, bytes(3), len(record) + FWTOOL_TRAILER.size)
        check(len(image) <= PARTITION_BYTES, "Image exceeds the MP716 firmware partition")
        image_body, image_record = split_metadata(image)
        check(image_record == record and image_body.endswith(JFFS_END), "Footer or JFFS2 marker changed")
        structure = inspect_payload(image)
        check(structure.kernel_crc_ok, "uImage CRC check failed")
        roundtrip_kernel, roundtrip_dtb = split_kernel(image)
        check(roundtrip_kernel == kernel and roundtrip_dtb == dtb, "Unexpected kernel changes")
        base_props = fdt_properties(base_dtb)
        image_props = fdt_properties(roundtrip_dtb)
        changes = {k for k in base_props.keys() | image_props.keys() if
                   base_props.get(k, (0, None))[1] != image_props.get(k, (0, None))[1]}
        check(changes in ({(ETH, "status")}, {(ETH, "status"), (SWITCH, "status")}),
              f"Unexpected DTB property changes: {changes}")
        check(image_props[(ETH, "status")][1] == b"okay\0" and
              image_props.get((SWITCH, "status"), (0, b"okay\0"))[1] == b"okay\0" and
              image_props[(WIFI, "status")][1] == b"disabled\0" and
              image_props[(SPI, "status")][1] == b"okay\0", "Unexpected hardware configuration")
        readback = work / "extracted.squashfs"
        readback.write_bytes(rootfs_bytes(image))
        final_tar = work / "verified.tar"
        with final_tar.open("wb") as sink:
            subprocess.run([squashfs_tool(args.squashfs_tools, "sqfs2tar"), "-r", ".", readback],
                           stdout=sink, check=True)
        new_files = tar_manifest(final_tar)
        check(new_files.pop(LAN_SCRIPT) == (tarfile.REGTYPE, 0o755, 0, 0, "", 0, 0,
                                            hashlib.sha256(lan_script).hexdigest(), {}),
              "LAN initialization script is missing or changed")
        check(new_files == original_files, f"Repacked rootfs has unexpected changes: "
              f"{sorted(k for k in new_files.keys() | original_files.keys() if new_files.get(k) != original_files.get(k))[:10]}")

    digest = hashlib.sha256(image).hexdigest()
    report = {
        "type": "OpenWrt migration test image",
        "board": BOARD,
        "base_image_sha256": BASE_SHA256,
        "image_sha256": digest,
        "image_bytes": len(image),
        "partition_capacity_bytes": PARTITION_BYTES,
        "uimage_crc_verified": True,
        "openwrt_metadata_crc_verified": True,
        "squashfs_contents_verified": True,
        "preserved_rootfs_entries": len(original_files),
        "lan_device": "eth0",
        "expected_openwrt_lan_ip": "192.168.1.1",
        "vendor_web_upgrade_format_verified": False,
        "hardware_boot_verified": False,
    }
    files = {
        IMAGE_NAME: image,
        "SHA256SUMS": f"{digest}  {IMAGE_NAME}\n".encode(),
        "offline-verification.json": (json.dumps(report, indent=2) + "\n").encode(),
        "README.txt": (
            "MP716 OpenWrt 25.12.6 LAN migration TEST\n"
            "OpenWrt sysupgrade-format test image for yunxm,mp716.\n"
            "The eth0 interface is configured as LAN. Expected default IP: 192.168.1.1.\n"
            "Physical LAN ports and hardware boot remain untested. Test with an isolated PC link.\n"
            "Do not upload this test image to the vendor 014 web upgrade page.\n"
        ).encode(),
    }
    for name, data in files.items():
        (args.output / name).write_bytes(data)
    bundle = args.output / "MP716-OpenWrt-25.12.6-LAN-migration-TEST.zip"
    with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    with zipfile.ZipFile(bundle) as archive:
        check(archive.testzip() is None and archive.read(IMAGE_NAME) == image, "ZIP validation failed")
    print(json.dumps(report, indent=2))
    print(bundle.resolve())


if __name__ == "__main__":
    main()
