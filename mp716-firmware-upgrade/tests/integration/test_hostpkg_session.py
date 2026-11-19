"""Exercise session-only hostpkg retention without compiling or executing targets."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = shutil.which('bash') or (r'D:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)
CACHED = (ROOT / 'scripts/build-openwrt-cached.sh').read_text()
GUARD = CACHED.split('# BEGIN HOSTPKG SESSION GUARD\n', 1)[1].split('# END HOSTPKG SESSION GUARD', 1)[0]
BUILD = (ROOT / 'scripts/build-ci-images.sh').read_text()
GENERATE = BUILD.split('# BEGIN HOSTPKG BUILD SESSION\n', 1)[1].split('# END HOSTPKG BUILD SESSION', 1)[0]
FIRST, SECOND = 'a' * 32, 'b' * 32


def shell_path(path):
    path = Path(path).resolve().as_posix()
    return '/' + path[0].lower() + path[2:] if len(path) > 1 and path[1] == ':' else path


@unittest.skipUnless(BASH and Path(BASH).is_file(), 'bash not available')
class HostPackageSessionTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'build').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='hostpkg-session-', dir=ROOT / 'build')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.cache = self.root / 'cache'
        self.tree = self.cache / 'openwrt'
        self.cache.mkdir()
        self.marker = self.cache / 'hostpkg-session'
        self.hostpkg = [self.tree / 'build_dir/hostpkg/proof', self.tree / 'staging_dir/hostpkg/proof']
        self.protected = [self.tree / path for path in [
            'build_dir/host/proof', 'staging_dir/host/proof', 'build_dir/toolchain-mipsel_test/proof',
            'staging_dir/toolchain-mipsel_test/proof', 'files/etc/mp716-upgrade/upgrade.pub',
            'package/mp716-sysupgrade/proof', 'bin/targets/ramips/mt76x8/proof']]
        for file in self.protected:
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'unchanged')
        self.seed_hostpkg()

    def seed_hostpkg(self):
        for file in self.hostpkg:
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'host-tool')

    def run_guard(self, session):
        script = 'set -euo pipefail\ncache=' + repr(shell_path(self.cache)) + '\ntree="$cache/openwrt"\n'
        # The isolated test owns its own descriptor, like the production guard;
        # no other fixture or production cache is accessed.
        script += 'exec 9>"$cache/build.lock"\n' + GUARD
        env = {key: value for key, value in os.environ.items() if key != 'MP716_HOSTPKG_SESSION'}
        if session is not None:
            env['MP716_HOSTPKG_SESSION'] = session
        result = subprocess.run([BASH, '-c', script], env=env, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        for file in self.protected:
            self.assertEqual(file.read_bytes(), b'unchanged', 'Session guard changed target overlay/toolchain: ' + str(file))

    def test_first_profile_cleans_old_state_and_second_same_session_preserves_host_tools(self):
        self.run_guard(FIRST)
        self.assertTrue(all(not file.exists() for file in self.hostpkg))
        self.assertEqual(self.marker.read_text(), FIRST + '\n')
        self.seed_hostpkg()
        self.run_guard(FIRST)
        self.assertTrue(all(file.read_bytes() == b'host-tool' for file in self.hostpkg))

    def test_changed_session_cleans_both_host_directories_and_replaces_marker(self):
        self.marker.write_text(FIRST + '\n')
        self.run_guard(SECOND)
        self.assertTrue(all(not file.exists() for file in self.hostpkg))
        self.assertEqual(self.marker.read_text(), SECOND + '\n')

    def test_missing_or_invalid_session_restores_original_cleanup_behavior(self):
        for session in [None, '', 'not-hex', 'A' * 32, 'a' * 31, 'a' * 33]:
            with self.subTest(session=session):
                self.seed_hostpkg()
                self.marker.write_text(FIRST + '\n')
                self.run_guard(session)
                self.assertTrue(all(not file.exists() for file in self.hostpkg))
                self.assertFalse(self.marker.exists())

    def test_invalid_saved_marker_does_not_authorize_retention(self):
        self.marker.write_text(FIRST + '\nextra-session\n')
        self.run_guard(FIRST)
        self.assertTrue(all(not file.exists() for file in self.hostpkg))
        self.assertEqual(self.marker.read_text(), FIRST + '\n')

    def test_symlink_marker_is_not_trusted_or_followed_for_writes(self):
        outside = self.root / 'outside-marker'
        outside.write_text(FIRST + '\n')
        try:
            self.marker.symlink_to(outside)
        except OSError as error:
            self.skipTest('Host does not permit creating a real symlink: ' + str(error))
        self.run_guard(FIRST)
        self.assertTrue(all(not file.exists() for file in self.hostpkg))
        self.assertFalse(self.marker.is_symlink())
        self.assertEqual(outside.read_text(), FIRST + '\n')
        self.assertEqual(self.marker.read_text(), FIRST + '\n')

    def test_guard_is_after_the_shared_lock_and_does_not_replace_target_cleanup(self):
        self.assertLess(CACHED.index('flock 9'), CACHED.index('# BEGIN HOSTPKG SESSION GUARD'))
        after = CACHED.split('# END HOSTPKG SESSION GUARD', 1)[1]
        self.assertIn('rm -rf -- "$tree/files" "$tree/package/mp716-sysupgrade"', after)
        self.assertIn('"$tree/bin/targets/ramips/mt76x8"', after)

    def test_each_build_invocation_exports_fresh_session_even_if_one_was_inherited(self):
        binary = self.root / 'bin'
        binary.mkdir()
        python = binary / 'python3'
        python.write_text('#!/bin/bash\nexec "$TEST_PYTHON" "$@"\n', newline='\n')
        python.chmod(0o755)
        script = 'set -euo pipefail\nexport PATH="$TEST_BIN:$PATH"\n' + GENERATE + '\nbash -c \'printf "%s" "$MP716_HOSTPKG_SESSION"\'\n'
        env = {**os.environ, 'TEST_BIN': shell_path(binary), 'TEST_PYTHON': shell_path(sys.executable),
               'MP716_HOSTPKG_SESSION': FIRST}
        sessions = []
        for _ in range(2):
            result = subprocess.run([BASH, '-c', script], env=env, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
            session = result.stdout.decode().strip()
            self.assertRegex(session, r'^[0-9a-f]{32}$')
            self.assertNotEqual(session, FIRST)
            sessions.append(session)
        self.assertNotEqual(*sessions)


if __name__ == '__main__':
    unittest.main()
