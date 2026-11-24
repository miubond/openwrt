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

    def test_firmware_build_date_is_a_utc_timestamp_not_openwrt_description(self):
        version = (PROJECT / 'config/firmware.version').read_text(encoding='ascii').strip()
        stamp = (self.root / 'etc/mp716-build.date').read_text(encoding='ascii').strip()
        self.assertEqual((self.root / 'etc/mp716-build.version').read_text(encoding='ascii').strip(), version)
        self.assertRegex(stamp, r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')
        meta = (self.root / 'usr/share/mp716/build-meta.uc').read_text(encoding='utf-8')
        self.assertIn("'/etc/mp716-build.date'", meta)
        self.assertNotIn('DISTRIB_DESCRIPTION', meta)
        self.assertNotIn('(?:', meta)

    def test_firmware_build_date_honors_source_date_epoch(self):
        previous = os.environ.get('SOURCE_DATE_EPOCH')
        os.environ['SOURCE_DATE_EPOCH'] = '1700000000'

        def restore_epoch():
            if previous is None:
                os.environ.pop('SOURCE_DATE_EPOCH', None)
            else:
                os.environ['SOURCE_DATE_EPOCH'] = previous

        self.addCleanup(restore_epoch)
        module.stage(SOURCE / 'web-input.zip', self.root)
        self.assertEqual(
            (self.root / 'etc/mp716-build.date').read_text(encoding='ascii').strip(),
            '2023-11-14 22:13:20',
        )

    def test_native_services_survive_boot_and_upgrade_configuration_retention(self):
        defaults = (self.root / 'etc/uci-defaults/98-mp716-admin').read_text()
        for service in ('mp716-admin', 'mp716-vpn'):
            self.assertIn(f'/etc/init.d/{service} enable', defaults)
            self.assertIn(f'/etc/init.d/{service} start', defaults)
            self.assertTrue((self.root / 'etc/init.d' / service).is_file())
        tick = (self.root / 'usr/share/mp716/admin-tick.uc').read_text()
        self.assertIn('tick_system()', tick)
        self.assertIn('warm_api_cache', tick)
        keep = (self.root / 'lib/upgrade/keep.d/mp716-admin').read_text()
        self.assertIn('/etc/mp716-vpn/', keep)
        self.assertIn('/etc/mp716-admin/', keep)

    def test_root_and_legacy_entries_share_vue_assets_and_preserve_native_api(self):
        dist = Path(self.work.name) / 'dist'
        (dist / 'assets').mkdir(parents=True)
        html = b'<html><script src="/mp716/assets/app.js"></script></html>'
        (dist / 'index.html').write_bytes(html)
        (dist / 'assets/app.js').write_bytes(b'const api="/cgi-bin/mp716";')
        api = (self.root / 'www/cgi-bin/mp716').read_bytes()
        module.stage(SOURCE / 'web-input.zip', self.root, web_dist=dist)
        self.assertEqual((self.root / 'www/index.html').read_bytes(), html)
        self.assertEqual((self.root / 'www/mp716/index.html').read_bytes(), html)
        self.assertEqual((self.root / 'www/mp716/assets/app.js').read_bytes(),
                         (dist / 'assets/app.js').read_bytes())
        self.assertEqual((self.root / 'www/cgi-bin/mp716').read_bytes(), api)

    @unittest.skipIf(os.name == 'nt', 'Windows does not preserve Unix executable mode bits')
    def test_hooks_and_services_are_executable(self):
        paths = list((self.root / 'usr/share/mp716').glob('*.sh'))
        paths += list((self.root / 'etc/init.d').glob('mp716-*'))
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(path.stat().st_mode & 0o777, 0o755)


if __name__ == '__main__':
    unittest.main()
