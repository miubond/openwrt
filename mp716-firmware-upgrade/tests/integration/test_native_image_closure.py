"""Reject incomplete final-image listings without starting target services."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
BASH = shutil.which('bash') or (r'D:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)
SOURCE = (ROOT / 'scripts/build-openwrt-test.sh').read_text()
CONTRACT = SOURCE.split('# BEGIN NATIVE ROOTFS CLOSURE\n', 1)[1].split('# END NATIVE ROOTFS CLOSURE', 1)[0]


def shell_path(path):
    path = path.resolve().as_posix()
    return '/' + path[0].lower() + path[2:] if len(path) > 1 and path[1] == ':' else path


@unittest.skipUnless(BASH and Path(BASH).is_file(), 'bash not available')
class NativeImageClosureTests(unittest.TestCase):
    def check_listing(self, mutation='', prefix='', compression=''):
        (ROOT / 'build').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='image-closure-', dir=ROOT / 'build') as directory:
            harness = 'set -eu\n' + CONTRACT + r'''
listing="$TEST_DIR/listing"
for entry in "${native_entries[@]}"; do printf '%s%s\n' "$TEST_PREFIX" "$entry"; done > "$listing"
for plugin in pptp pppoe pppol2tp; do
 printf '%susr/lib/pppd/2.5.2/%s.so\n' "$TEST_PREFIX" "$plugin" >> "$listing"
done
for module in ppp_generic ppp_async pppox pppoe pptp ppp_mppe gre ip_gre l2tp_core l2tp_netlink l2tp_ppp tun xfrm_user esp4 nft_xfrm wireguard; do
 printf '%slib/modules/6.12.112/%s.ko%s\n' "$TEST_PREFIX" "$module" "$TEST_COMPRESSION" >> "$listing"
done
# Stock init scripts are retained for inspection; their rc.d links are forbidden.
printf '%setc/init.d/openvpn\n' "$TEST_PREFIX" >> "$listing"
''' + mutation + '\ncheck_native_rootfs "$listing" "$TEST_PREFIX"\n'
            env = {**os.environ, 'TEST_DIR': shell_path(Path(directory)),
                   'TEST_PREFIX': prefix, 'TEST_COMPRESSION': compression}
            return subprocess.run([BASH, '-c', harness], env=env, text=True, capture_output=True)

    def test_complete_ram_and_lan_listings_pass_the_same_contract(self):
        for prefix, compression in [('', ''), ('squashfs-root/', '.zst')]:
            with self.subTest(prefix=prefix):
                result = self.check_listing(prefix=prefix, compression=compression)
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_native_runtime_module_is_rejected(self):
        result = self.check_listing(r'''sed -i '/usr\/share\/mp716\/apply-task.uc$/d' "$listing"''')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('apply-task.uc', result.stderr)

    def test_pppd_without_its_pptp_plugin_is_rejected(self):
        result = self.check_listing(r'''sed -i '/\/pptp.so$/d' "$listing"''')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('pptp', result.stderr)

    def test_missing_ipsec_crypto_plugin_or_load_config_is_rejected(self):
        for name in ['libstrongswan-kdf.so', 'sha2.conf']:
            with self.subTest(name=name):
                result = self.check_listing(f"sed -i '/{name}$/d' \"$listing\"")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)

    def test_missing_kernel_xfrm_guard_support_is_rejected(self):
        result = self.check_listing(r'''sed -i '/\/nft_xfrm.ko$/d' "$listing"''')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('nft_xfrm', result.stderr)

    def test_missing_wireguard_kernel_module_or_tool_is_rejected(self):
        for pattern, name in [(r'\/wireguard.ko$', 'wireguard'), (r'usr\/bin\/wg$', 'usr/bin/wg')]:
            with self.subTest(name=name):
                result = self.check_listing(f"sed -i '/{pattern}/d' \"$listing\"")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(name, result.stderr)

    def test_stock_vpn_start_and_stop_links_are_rejected_in_both_images(self):
        for prefix in ['', 'squashfs-root/']:
            for link in ['S60pptpd', 'S60xl2tpd', 'S90openvpn', 'S90ipsec', 'K10ipsec']:
                with self.subTest(prefix=prefix, link=link):
                    result = self.check_listing(f"printf '%setc/rc.d/{link}\\n' \"$TEST_PREFIX\" >> \"$listing\"", prefix)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('autostart conflicts', result.stderr)

    def test_missing_managed_service_start_link_is_rejected(self):
        result = self.check_listing(r'''sed -i '/\/S59mp716-vpn$/d' "$listing"''')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('S59mp716-vpn', result.stderr)


if __name__ == '__main__':
    unittest.main()
