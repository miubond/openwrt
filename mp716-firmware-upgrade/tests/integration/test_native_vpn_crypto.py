"""Test final-image crypto delivery, including positive built-in evidence."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('native_vpn_crypto', ROOT / 'scripts/check-native-vpn-crypto.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class NativeVpnCryptoTests(unittest.TestCase):
    def setUp(self):
        (ROOT / 'build').mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT / 'build', prefix='vpn-crypto-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = self.root / 'openwrt.config'
        self.config.write_text(''.join('CONFIG_PACKAGE_' + name + '=y\n' for name in checker.PACKAGES))
        self.listing = self.root / 'files.txt'
        self.version = '6.12.112'

    def files(self, prefix='', omit=(), compression=''):
        return [prefix + 'lib/modules/' + self.version + '/' + name + '.ko' + compression
                for name in checker.MODULES if name not in omit]

    def write_listing(self, paths):
        self.listing.write_text('\n'.join(paths) + '\n')

    def test_normal_ram_and_lan_images_have_required_crypto_modules(self):
        for prefix, compression in [('./', ''), ('squashfs-root/', '.zst')]:
            with self.subTest(prefix=prefix):
                self.write_listing(self.files(prefix, compression=compression))
                result = checker.check(self.config, self.listing)
                self.assertTrue(result['ok'])
                self.assertEqual(result['test_status'], 'UNVERIFIED')
                self.assertFalse(result['flash_write'])

    def test_each_missing_module_requires_review(self):
        for module in checker.MODULES:
            with self.subTest(module=module):
                self.write_listing(self.files(omit=[module]))
                with self.assertRaisesRegex(ValueError, 'REVIEW_REQUIRED: ' + module):
                    checker.check(self.config, self.listing)

    def test_each_missing_or_disabled_package_is_rejected_even_with_modules(self):
        self.write_listing(self.files())
        original = self.config.read_text()
        for package in checker.PACKAGES:
            for replacement in ['', '# CONFIG_PACKAGE_' + package + ' is not set']:
                with self.subTest(package=package, replacement=replacement):
                    self.config.write_text(original.replace('CONFIG_PACKAGE_' + package + '=y', replacement))
                    with self.assertRaisesRegex(ValueError, 'Missing final package selection'):
                        checker.check(self.config, self.listing)

    def test_delivered_builtin_content_proves_modules_without_ko_files(self):
        proof = self.root / 'modules.builtin'
        proof.write_text('\n'.join('kernel/' + path for path in checker.MODULES.values()) + '\n')
        self.write_listing(['squashfs-root/lib/modules/' + self.version + '/modules.builtin'])
        result = checker.check(self.config, self.listing, builtins={self.version: proof})
        self.assertTrue(result['ok'])
        self.assertTrue(all(item['delivery'] == 'builtin' for item in result['modules'].values()))

    def test_listing_modules_builtin_without_content_is_not_proof(self):
        self.write_listing(['lib/modules/' + self.version + '/modules.builtin'])
        with self.assertRaisesRegex(ValueError, 'no delivered modules.builtin content'):
            checker.check(self.config, self.listing)

    def test_unlisted_builtin_proof_or_incorrect_module_path_is_rejected(self):
        proof = self.root / 'modules.builtin'
        proof.write_text('unrelated/sha256_generic.ko\n')
        self.write_listing(self.files(omit=['sha256_generic']))
        with self.assertRaisesRegex(ValueError, 'not listed in the delivered kernel'):
            checker.check(self.config, self.listing, builtins={self.version: proof})
        self.write_listing(self.files(omit=['sha256_generic']) + ['lib/modules/' + self.version + '/modules.builtin'])
        with self.assertRaisesRegex(ValueError, 'REVIEW_REQUIRED: sha256_generic'):
            checker.check(self.config, self.listing, builtins={self.version: proof})

    def test_mixed_kernel_versions_cannot_satisfy_delivery(self):
        paths = self.files()
        paths[0] = paths[0].replace(self.version, '6.12.999')
        self.write_listing(paths)
        with self.assertRaisesRegex(ValueError, 'different kernel versions'):
            checker.check(self.config, self.listing)

    def test_failure_report_is_retained_with_nonzero_result(self):
        self.write_listing(self.files(omit=['xcbc']))
        report = self.root / 'vpn-crypto-report.json'
        with contextlib.redirect_stdout(io.StringIO()):
            status = checker.main([str(self.config), str(self.listing), '--report', str(report)])
        self.assertEqual(status, 2)
        result = json.loads(report.read_text())
        self.assertFalse(result['ok'])
        self.assertIn('xcbc', result['error'])

    def test_different_openwrt_pin_requires_review(self):
        self.write_listing(self.files())
        with self.assertRaisesRegex(ValueError, 'only verified for OpenWrt'):
            checker.check(self.config, self.listing, pin='0' * 40)


if __name__ == '__main__':
    unittest.main()
