"""The staged native gateway must include its runtime dependency closure."""
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import unittest

PROJECT = Path(__file__).resolve().parents[2]
SOURCE = PROJECT / 'integration/ram-web'
spec = importlib.util.spec_from_file_location('native_admin_stage', SOURCE / 'stage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeAdminStageTests(unittest.TestCase):
    def setUp(self):
        (PROJECT / 'build').mkdir(exist_ok=True)
        self.work = tempfile.TemporaryDirectory(prefix='native-stage-', dir=PROJECT / 'build')
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name) / 'root'
        module.stage(SOURCE / 'web-input.zip', self.root)

    def test_all_native_module_and_hook_references_are_installed(self):
        files = list((self.root / 'usr/share/mp716').glob('*'))
        files += list((self.root / 'etc/init.d').glob('mp716-*'))
        missing = set()
        for file in files:
            if file.suffix not in ('.uc', '.sh') and file.parent.name != 'init.d':
                continue
            for absolute in re.findall(r'/usr/share/mp716/[A-Za-z0-9_.-]+\.(?:uc|sh|json)', file.read_text()):
                if not (self.root / absolute.lstrip('/')).is_file():
                    missing.add(f'{file.name}: {absolute}')
        self.assertEqual(missing, set())
        routes = json.loads((self.root / 'usr/share/mp716/native-routes.json').read_text())
        self.assertIn('POST system/sche-reboot', routes)
        self.assertIn('POST vpn/openvpn/upload', routes)

    def test_native_services_survive_boot_and_upgrade_configuration_retention(self):
        defaults = (self.root / 'etc/uci-defaults/98-mp716-admin').read_text()
        for service in ('mp716-admin', 'mp716-vpn'):
            self.assertIn(f'/etc/init.d/{service} enable', defaults)
            self.assertIn(f'/etc/init.d/{service} start', defaults)
            self.assertTrue((self.root / 'etc/init.d' / service).is_file())
        tick = (self.root / 'usr/share/mp716/admin-tick.uc').read_text()
        self.assertIn('tick_system()', tick)
        keep = (self.root / 'lib/upgrade/keep.d/mp716-admin').read_text()
        self.assertIn('/etc/mp716-vpn/', keep)
        self.assertIn('/etc/mp716-admin/', keep)

    @unittest.skipIf(os.name == 'nt', 'Windows does not preserve Unix executable mode bits')
    def test_hooks_and_services_are_executable(self):
        paths = list((self.root / 'usr/share/mp716').glob('*.sh'))
        paths += list((self.root / 'etc/init.d').glob('mp716-*'))
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(path.stat().st_mode & 0o777, 0o755)


if __name__ == '__main__':
    unittest.main()
