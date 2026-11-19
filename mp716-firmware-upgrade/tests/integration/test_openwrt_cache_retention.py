"""Fault-inject cache qualification; no OpenWrt build or target execution."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = shutil.which('bash') or (r'D:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)
SOURCE = (ROOT / 'scripts/build-openwrt-cached.sh').read_text()
CONTRACT = SOURCE.split('# BEGIN VERIFIED TOOLCHAIN CACHE\n', 1)[1].split('# END VERIFIED TOOLCHAIN CACHE', 1)[0]


def shell_path(path):
    path = path.resolve().as_posix()
    return '/' + path[0].lower() + path[2:] if len(path) > 1 and path[1] == ':' else path


@unittest.skipUnless(BASH and Path(BASH).is_file(), 'bash not available')
class OpenWrtCacheRetentionTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'build').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='cache-retention-', dir=ROOT / 'build')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / ('a' * 64)
        self.tree = self.cache / 'openwrt'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        # Inject compiler and inspector failures, rather than requiring a real
        # MIPS toolchain on the test host. CI runs the actual compiler/readelf.
        inspector = self.bin / 'readelf'
        inspector.write_text('#!/bin/bash\ncat "$TEST_HEADER"\n', newline='\n')
        inspector.chmod(0o755)
        self.header = self.root / 'header'
        self.header.write_text('  Class: ELF32\n  Data: 2\'s complement, little endian\n  Machine: MIPS R3000\n  Type: EXEC (Executable file)\n')
        self.compiler('one', 'while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; output=$1; fi; shift; done\n' +
                      'printf \'#!/bin/bash\\n: > "$TEST_EXECUTED"\\n\' > "$output"\nchmod +x "$output"\n')

    def compiler(self, name, body):
        path = self.tree / ('staging_dir/toolchain-mipsel_' + name) / 'bin/mipsel-openwrt-linux-musl-gcc'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#!/bin/bash\nset -eu\n' + body, newline='\n')
        path.chmod(0o755)
        return path

    def run_exit(self, status, contract=None):
        self.cache.mkdir(parents=True, exist_ok=True)
        script = self.root / 'test.sh'
        script.write_text('set -euo pipefail\nexport PATH="$TEST_BIN:$PATH"\ncache=' + repr(shell_path(self.cache)) + '\ntree="$cache/openwrt"\nkey=' + 'a' * 64 + '\nexec 9>"$cache/build.lock"\n' + (contract or CONTRACT) + '\nexit ' + str(status) + '\n', newline='\n')
        env = {**os.environ, 'TEST_BIN': shell_path(self.bin),
               'TEST_HEADER': shell_path(self.header), 'TEST_EXECUTED': shell_path(self.root / 'executed'),
               'GITHUB_OUTPUT': shell_path(self.root / 'outputs')}
        return subprocess.run([BASH, shell_path(script)], env=env, capture_output=True, timeout=8)

    def test_target_failure_keeps_verified_toolchain_and_original_error(self):
        result = self.run_exit(7)
        self.assertEqual(result.returncode, 7, result.stderr.decode())
        self.assertIn('format=ELF32-LSB-MIPS', (self.cache / 'toolchain-verified').read_text())
        self.assertIn('image status 7', result.stdout.decode())
        self.assertFalse((self.cache / 'validated').exists())
        self.assertFalse((self.root / 'executed').exists(), 'Target executable must never be run')
        self.assertFalse(list(self.cache.glob('toolchain-probe.*')))

    def test_success_remains_success(self):
        result = self.run_exit(0)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertTrue((self.cache / 'toolchain-verified').is_file())

    def test_link_failure_invalidates_old_marker_without_masking_target_error(self):
        (self.cache / 'toolchain-verified').write_text('stale')
        self.compiler('one', 'exit 1\n')
        result = self.run_exit(23)
        self.assertEqual(result.returncode, 23)
        self.assertFalse((self.cache / 'toolchain-verified').exists())

    def test_incorrect_elf_class_endianness_or_machine_is_not_cacheable(self):
        original = self.header.read_text()
        for old, new in [('ELF32', 'ELF64'), ('little endian', 'big endian'), ('MIPS R3000', 'Advanced Micro Devices X86-64')]:
            with self.subTest(header=new):
                self.header.write_text(original.replace(old, new))
                result = self.run_exit(2)
                self.assertEqual(result.returncode, 2)
                self.assertFalse((self.cache / 'toolchain-verified').exists())

    def test_ambiguous_or_missing_cross_compiler_is_not_cacheable(self):
        second = self.compiler('two', 'exit 0\n')
        self.assertEqual(self.run_exit(2).returncode, 2)
        self.assertFalse((self.cache / 'toolchain-verified').exists())
        second.unlink()
        for path in self.tree.glob('staging_dir/toolchain-*/bin/*gcc'):
            path.unlink()
        self.assertEqual(self.run_exit(2).returncode, 2)
        self.assertFalse((self.cache / 'toolchain-verified').exists())

    def test_hung_compiler_has_bounded_check_and_preserves_status(self):
        self.compiler('one', 'exec sleep 5\n')
        result = self.run_exit(19, CONTRACT.replace('timeout -s KILL 30s ', 'timeout -s KILL 0.1s '))
        self.assertEqual(result.returncode, 19)
        self.assertFalse((self.cache / 'toolchain-verified').exists())

    def test_workflow_saves_on_failure_only_after_marker_check(self):
        workflow = (ROOT.parent / '.github/workflows/mp716-firmware.yml').read_text()
        self.assertIn('uses: actions/cache/restore@v5', workflow)
        self.assertIn('uses: actions/cache/save@v5', workflow)
        section = workflow.split('- name: Save verified toolchain', 1)[1].split('- name:', 1)[0]
        self.assertIn('always() && !cancelled()', section)
        self.assertIn("steps.toolchain-cache.outputs.cache-hit != 'true'", section)
        self.assertIn("steps.toolchain-ready.outputs.ready == 'true'", section)
        self.assertIn('continue-on-error: true', section)
        self.assertIn('toolchain-verified', section)
        for forbidden in ('/files', '/bin/targets', '/build_dir/target-', '.priv', 'build/ci-release'):
            self.assertNotIn(forbidden, section)
