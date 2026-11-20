"""Exercise the sectionless ELF ABI, not a strings-based version heuristic."""
import binascii
import contextlib
import importlib.util
import io
import json
import lzma
import os
from pathlib import Path
import shlex
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('native_vpn_plugin_check', ROOT / 'scripts/check-native-vpn-plugin.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
BASH = shutil.which('bash') or (r'D:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)
PORTS_BYTES = (ROOT / 'integration/ram-web/physical-ports.uc').read_bytes()


def elf():
    data = bytearray(1024)
    struct.pack_into('<16sHHIIIIIHHHHHH', data, 0, b'\x7fELF\x01\x01\x01' + bytes(9),
                     3, 8, 1, 0, 52, 0, 0x70001006, 52, 32, 3, 40, 0, 0)
    for i, p in enumerate([(1, 0, 0, 0, 1024, 1024, 7, 4096),
                           (2, 160, 160, 160, 96, 96, 4, 4),
                           (0x70000003, 320, 320, 320, 24, 24, 4, 8)]):
        struct.pack_into('<IIIIIIII', data, 52 + i * 32, *p)
    struct.pack_into('<H6B4I', data, 320, 0, 32, 2, 1, 0, 0, 3, 0, 0, 0, 0)
    strings = b'\0gmpdh_plugin_create\0gmpdh_plugin_version\0libstrongswan.so.0\0'
    data[384:384 + len(strings)] = strings
    for i, symbol in enumerate([(0, 0, 0, 0, 0, 0),
                                (1, 704, 4, 0x12, 0, 1),
                                (21, 640, 4, 0x11, 0, 2)]):
        struct.pack_into('<IIIBBH', data, 512 + i * 16, *symbol)
    struct.pack_into('<6I', data, 576, 1, 3, 1, 0, 2, 0)
    struct.pack_into('<II', data, 608, 640, 3)
    struct.pack_into('<I', data, 640, 672)
    data[672:678] = b'6.0.7\0'
    tags = [(1, 42), (4, 576), (5, 384), (6, 512), (10, len(strings)), (11, 16),
            (0x70000011, 3), (17, 608), (18, 8), (19, 8), (0, 0), (0, 0)]
    for i, tag in enumerate(tags):
        struct.pack_into('<II', data, 160 + i * 8, *tag)
    return data


def cpio(rows):
    output = bytearray()
    for index, (name, mode, data) in enumerate([*rows, ('TRAILER!!!', 0, b'')]):
        name = name.encode('ascii') + b'\0'
        fields = [index + 1, mode, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(name), 0]
        output += b'070701' + ''.join(f'{value:08x}' for value in fields).encode('ascii') + name
        output += bytes((-len(output)) % 4)
        output += data
        output += bytes((-len(output)) % 4)
    output += bytes((-len(output)) % 512)
    return bytes(output)


def inner_lzma(archive):
    return lzma.compress(archive, format=lzma.FORMAT_ALONE,
                         filters=[{'id': lzma.FILTER_LZMA1, 'dict_size': 1024 * 1024, 'lc': 1, 'lp': 2, 'pb': 2}])


def uimage(compressed):
    header = bytearray(64)
    struct.pack_into('>I', header, 0, 0x27051956)
    struct.pack_into('>I', header, 12, len(compressed))
    struct.pack_into('>I', header, 24, binascii.crc32(compressed) & 0xffffffff)
    header[28:32] = bytes((5, 5, 2, 3))
    struct.pack_into('>I', header, 4, binascii.crc32(header) & 0xffffffff)
    return bytes(header) + compressed


def ram_image(rows=None, *, kernel=None, ports_rows=None):
    if kernel is None:
        rows = rows if rows is not None else [(m.PLUGIN, 0o100755, elf())]
        ports_rows = ports_rows if ports_rows is not None else [(m.PHYSICAL_PORTS, 0o100644, PORTS_BYTES)]
        kernel = b'pinned-kernel-prefix' + inner_lzma(cpio([*rows, *ports_rows])) + b'kernel-tail'
    return uimage(lzma.compress(kernel, format=lzma.FORMAT_ALONE))


class NativeVpnPluginTests(unittest.TestCase):
    def reject(self, data, message):
        with self.assertRaisesRegex(ValueError, message):
            m.inspect_plugin(bytes(data))

    def test_correct_sectionless_exports_and_local_version_pointer_pass(self):
        report = m.inspect_plugin(elf())
        self.assertEqual(report['strongswan_version'], '6.0.7')
        self.assertEqual(report['needed'], ['libstrongswan.so.0'])
        self.assertEqual(report['test_status'], 'UNVERIFIED')
        self.assertFalse(report['tunnel_interoperability_validated'])
        self.assertFalse(report['flash_write'])

    def test_optional_mips16_flag_does_not_change_abi(self):
        data = elf()
        struct.pack_into('<I', data, 36, 0x74001005)
        self.assertTrue(m.inspect_plugin(data)['ok'])

    def test_missing_version_is_rejected_even_if_version_literal_and_create_exist(self):
        data = elf()
        data[384 + 21] = ord('x')
        self.reject(data, 'Missing dynamic symbol gmpdh_plugin_version')

    def test_undefined_local_hidden_or_wrong_kind_exports_are_rejected(self):
        for index, field, value in [(2, 'section', 0), (2, 'info', 1), (2, 'other', 2),
                                    (2, 'info', 0x12), (1, 'info', 0x11), (1, 'section', 0)]:
            with self.subTest(index=index, field=field):
                data = elf()
                offsets = {'info': (12, 'B'), 'other': (13, 'B'), 'section': (14, 'H')}
                offset, fmt = offsets[field]
                struct.pack_into('<' + fmt, data, 512 + index * 16 + offset, value)
                self.reject(data, 'defined GLOBAL DEFAULT')

    def test_version_object_must_be_one_pointer(self):
        data = elf()
        struct.pack_into('<I', data, 512 + 32 + 8, 8)
        self.reject(data, 'one O32 pointer')

    def test_wrong_version_pointer_is_rejected_despite_correct_literal_elsewhere(self):
        data = elf()
        data[688:694] = b'6.0.6\0'
        struct.pack_into('<I', data, 640, 688)
        self.reject(data, 'does not point to pinned')

    def test_unmapped_version_pointer_is_rejected(self):
        data = elf()
        struct.pack_into('<I', data, 640, 0xf0000000)
        self.reject(data, 'unmapped ELF virtual')

    def test_missing_wrong_external_and_duplicate_version_relocations_are_rejected(self):
        for offset, info in [(644, 3), (640, 2), (640, 0x103)]:
            with self.subTest(offset=offset, info=info):
                data = elf()
                struct.pack_into('<II', data, 608, offset, info)
                self.reject(data, 'exactly one local R_MIPS_REL32')
        data = elf()
        struct.pack_into('<I', data, 160 + 8 * 8 + 4, 16)
        struct.pack_into('<II', data, 616, 640, 3)
        self.reject(data, 'exactly one local R_MIPS_REL32')

    def test_wrong_endianness_architecture_abi_or_float_is_rejected(self):
        for offset, fmt, value in [(5, 'B', 2), (18, 'H', 62), (36, 'I', 0x50001006),
                                   (36, 'I', 0x70002006), (36, 'I', 0x70001026), (327, 'B', 1)]:
            with self.subTest(offset=offset, value=value):
                data = elf()
                struct.pack_into('<' + fmt, data, offset, value)
                self.reject(data, 'Expected')

    def test_truncated_or_ambiguous_load_mapping_is_rejected(self):
        self.reject(elf()[:600], 'outside the delivered file')
        data = elf()
        struct.pack_into('<IIIIIIII', data, 52 + 2 * 32, 1, 0, 0, 0, 1024, 1024, 7, 4096)
        self.reject(data, 'Missing MIPS ABI flags')

    def test_dynamic_symbol_count_disagreement_is_rejected(self):
        data = elf()
        struct.pack_into('<I', data, 580, 2)
        self.reject(data, 'symbol/hash count mismatch')

    def test_ram_extraction_checks_final_image_instead_of_unrelated_build_tree_cpio(self):
        with tempfile.TemporaryDirectory() as temporary:
            tree = Path(temporary) / 'tree'
            output = Path(temporary) / 'output'
            output.mkdir()
            archive = tree / 'build_dir/target-mips/linux-ramips_mt76x8/linux-6/usr/initramfs_data.cpio'
            archive.parent.mkdir(parents=True)
            archive.write_bytes(cpio([(m.PLUGIN, 0o100755, elf())]))
            image = output / 'openwrt-ramips-mt76x8-yunxm_mp716-initramfs-ram-web-kernel.bin'
            image.write_bytes(ram_image())
            with mock.patch.object(m.subprocess, 'run') as run:
                data, source = m.extract_plugin(tree, output, 'initramfs')
            run.assert_not_called()
            self.assertTrue(m.inspect_plugin(data)['ok'])
            self.assertEqual(source['source'], 'delivered initramfs embedded CPIO')
            self.assertEqual(source['image_type'], 'initramfs')
            self.assertEqual(source['image_sha256'], m.hashlib.sha256(image.read_bytes()).hexdigest())
            broken = elf()
            broken[384 + 21] = ord('x')
            image.write_bytes(ram_image([(m.PLUGIN, 0o100755, broken)]))
            data, _ = m.extract_plugin(tree, output, 'initramfs')
            self.reject(data, 'Missing dynamic symbol gmpdh_plugin_version')
            (output / 'openwrt-ramips-mt76x8-yunxm_mp716-initramfs-rx-kernel.bin').write_bytes(ram_image())
            with self.assertRaisesRegex(ValueError, 'one delivered initramfs image'):
                m.extract_plugin(tree, output, 'initramfs')

    def test_duplicate_missing_or_symlink_ram_plugin_members_are_rejected(self):
        for rows, message in [([], 'one exact gmpdh member'),
                              ([(m.PLUGIN, 0o100755, elf()), ('./' + m.PLUGIN, 0o100755, elf())], 'one exact gmpdh member'),
                              ([(m.PLUGIN, 0o120777, b'other.so')], 'regular plugin file')]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                m.embedded_ram_plugin(ram_image(rows))

    def test_invalid_crc_length_and_truncated_ram_image_are_rejected(self):
        original = ram_image()
        cases = []
        bad = bytearray(original);bad[4] ^= 1;cases.append((bad, 'header CRC'))
        bad = bytearray(original);bad[-1] ^= 1;cases.append((bad, 'kernel CRC'))
        cases.extend([(original[:-1], 'payload length'), (original + b'extra', 'payload length'),
                      (b'not an image', 'uImage size')])
        for data, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                m.embedded_ram_plugin(data)

    def test_missing_ambiguous_or_corrupt_embedded_cpio_is_rejected(self):
        stream = inner_lzma(cpio([(m.PLUGIN, 0o100755, elf())]))
        for kernel, message in [(b'not a CPIO', 'Missing or ambiguous'),
                                (stream + b'kernel-between' + stream, 'Missing or ambiguous'),
                                (inner_lzma(b'070701' + b'z' * 104), 'Invalid newc header')]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                m.embedded_ram_plugin(ram_image(kernel=kernel))

    def test_ram_decoder_is_bounded_and_rejects_trailing_lzma_data(self):
        payload = ram_image()
        with mock.patch.object(m, 'MAX_DECODED_BYTES', 16):
            with self.assertRaisesRegex(ValueError, 'oversized embedded LZMA'):
                m.embedded_ram_plugin(payload)
        with self.assertRaisesRegex(ValueError, 'trailing uImage LZMA'):
            m.embedded_ram_plugin(uimage(payload[64:] + b'trailing'))

    def test_multiple_embedded_archives_stop_at_the_second_stream(self):
        stream = inner_lzma(cpio([(m.PLUGIN, 0o100755, elf())]))
        with mock.patch.object(m, 'decode_lzma', wraps=m.decode_lzma) as decode:
            with self.assertRaisesRegex(ValueError, 'Missing or ambiguous'):
                m.embedded_ram_plugin(ram_image(kernel=stream * 3))
        self.assertEqual(decode.call_count, 3)  # Outer kernel and two archives.

    def test_ram_requires_exact_delivered_physical_port_module(self):
        for rows, message in [([], 'one exact physical-ports.uc'),
                              ([(m.PHYSICAL_PORTS, 0o100644, b'stale')], 'differs from the current source'),
                              ([(m.PHYSICAL_PORTS, 0o120777, b'elsewhere')], 'regular module file'),
                              ([(m.PHYSICAL_PORTS, 0o100644, PORTS_BYTES), ('./' + m.PHYSICAL_PORTS, 0o100644, PORTS_BYTES)], 'one exact physical-ports.uc')]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                m.embedded_ram_plugin(ram_image(ports_rows=rows))
        _, delivery = m.embedded_ram_plugin(ram_image())
        self.assertEqual(delivery['physical_ports_sha256'], m.hashlib.sha256(PORTS_BYTES).hexdigest())

    def test_lan_extraction_uses_structurally_validated_rootfs_offset(self):
        from packer.image_format import inspect_payload
        # The existing payload fixture has valid uImage CRC and squashfs header.
        from tests.support.images import uimage_payload
        payload = uimage_payload()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image = root / 'openwrt-ramips-mt76x8-yunxm_mp716-squashfs-sysupgrade.bin'
            image.write_bytes(payload)
            with mock.patch.object(m.subprocess, 'run', side_effect=[
                    subprocess.CompletedProcess([], 0, bytes(elf()), b''),
                    subprocess.CompletedProcess([], 0, PORTS_BYTES, b'')]) as run:
                data, source = m.extract_plugin(root, root, 'sysupgrade')
            self.assertTrue(m.inspect_plugin(data)['ok'])
            offset = inspect_payload(payload).squashfs_offset
            self.assertEqual([call.args[0][-5:] for call in run.call_args_list],
                             [['-offset', str(offset), '-cat', str(image), path] for path in (m.PLUGIN, m.PHYSICAL_PORTS)])
            self.assertEqual(source['rootfs_offset'], offset)
            self.assertEqual(source['image_type'], 'sysupgrade')
            self.assertEqual(source['physical_ports_sha256'], m.hashlib.sha256(PORTS_BYTES).hexdigest())
            image.write_bytes(b'hsqs' + bytes(512))
            with mock.patch.object(m.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'Invalid sysupgrade payload'):
                    m.extract_plugin(root, root, 'sysupgrade')
                run.assert_not_called()

    def test_lan_rejects_missing_or_stale_delivered_physical_port_module(self):
        from tests.support.images import uimage_payload
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'openwrt-ramips-mt76x8-yunxm_mp716-squashfs-sysupgrade.bin').write_bytes(uimage_payload())
            for code, content, message in [(1, b'', 'physical-ports.uc rootfs extraction failed'),
                                           (0, b'stale', 'differs from the current source')]:
                with self.subTest(code=code), mock.patch.object(m.subprocess, 'run', side_effect=[
                        subprocess.CompletedProcess([], 0, bytes(elf()), b''),
                        subprocess.CompletedProcess([], code, content, b'')]):
                    with self.assertRaisesRegex(ValueError, message):
                        m.extract_plugin(root, root, 'sysupgrade')

    def test_abi_failure_writes_unverified_report_and_nonzero(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plugin = root / 'plugin.so'
            plugin.write_bytes(b'not an ELF')
            report = root / 'report.json'
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(m.main(['--elf', str(plugin), '--report', str(report)]), 2)
            data = json.loads(report.read_text())
            self.assertFalse(data['ok'])
            self.assertFalse(data['flash_write'])
            self.assertEqual(data['test_status'], 'UNVERIFIED')

    def test_both_abi_reports_enter_versioned_release_and_final_checksums(self):
        from tests.integration.test_versioned_release import VersionedReleaseTests, release
        fixture = VersionedReleaseTests('test_both_profiles_publish_with_integrity_checks_and_no_private_key')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        for kind, directory, _ in fixture.images:
            image = next(directory.glob('*.bin'))
            report = {**m.inspect_plugin(elf()), 'openwrt_commit': m.PIN,
                      'delivery': {'image_type': kind, 'image': image.name,
                                   'image_sha256': m.hashlib.sha256(image.read_bytes()).hexdigest()}}
            (directory / 'vpn-plugin-abi-report.json').write_text(json.dumps(report) + '\n')
        target = release.stage(fixture.output, fixture.images, fixture.commit, fixture.signed)
        checksums = (target / 'sha256sums').read_text()
        for kind, directory, _ in fixture.images:
            name = 'reports/' + kind + '/vpn-plugin-abi-report.json'
            self.assertEqual((target / name).read_bytes(), (directory / 'vpn-plugin-abi-report.json').read_bytes())
            self.assertIn(release.sha256(target / name) + '  ' + name + '\n', checksums)
        self.assertEqual(release.read_json(target / 'release-manifest.json')['test_status'], 'UNVERIFIED')

    @unittest.skipUnless(BASH and Path(BASH).is_file(), 'bash not available')
    def test_failed_build_or_abi_check_cannot_leave_old_validated_marker(self):
        script = (ROOT / 'scripts/build-openwrt-cached.sh').read_text()
        invalidate = 'rm -f -- "$cache/validated"'
        build = 'bash "$project/scripts/build-openwrt-test.sh"'
        self.assertLess(script.index(invalidate), script.index(build))
        tail = script[script.index(build):]
        (ROOT / 'build').mkdir(exist_ok=True)
        for build_rc, check_rc in [(7, 0), (0, 2), (0, 0)]:
            with self.subTest(build_rc=build_rc, check_rc=check_rc), tempfile.TemporaryDirectory(dir=ROOT / 'build') as temporary:
                root = Path(temporary)
                marker = root / 'validated'
                marker.write_text('old image')
                path = root.resolve().as_posix()
                if len(path) > 1 and path[1] == ':':
                    path = '/' + path[0].lower() + path[2:]
                harness = ('set -euo pipefail\ncache=' + shlex.quote(path) + '\nproject=' + shlex.quote(path) + '\ntree=' + shlex.quote(path) + '\n'
                           'bash() { return ' + str(build_rc) + '; }\n'
                           'python3() { return ' + str(check_rc) + '; }\n' + invalidate + '\n' + tail)
                result = subprocess.run([BASH, '-c', harness, '--', '--ram-web', 'web', 'profile', path],
                                        capture_output=True, timeout=8)
                self.assertEqual(result.returncode, build_rc or check_rc, result.stderr.decode(errors='replace'))
                self.assertEqual(marker.exists(), build_rc == check_rc == 0)


if __name__ == '__main__':
    unittest.main()
