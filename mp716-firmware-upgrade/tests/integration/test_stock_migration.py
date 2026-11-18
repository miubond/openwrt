import copy
import importlib.util
import shlex
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('stock_migration', ROOT / 'scripts/plan-stock-migration.py')
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


def source():
    values = {
        'network': """config interface lan
option ifname eth0.1
option ipaddr 192.168.199.1
option netmask 255.255.255.0
option macaddr 02:11:22:33:44:02
config interface wan
option ifname eth0.2
option proto dhcp
option macaddr 02:11:22:33:44:03
option mtu 1499
""",
        'system': """config mode mode
option wan_type wired
option opmode 0
config system system
option hostname MP716
config timeserver ntp
option enabled 1
list server time.example.test
""",
        'dhcp': """config dhcp lan
option start 1
option limit 254
option leasetime 7200
config host
option mac 02:11:22:33:55:66
option ip 192.168.199.50
option leasetime 0
""",
        'wireless': """config wifi-device radio0
option disabled 0
option channel 6
config wifi-iface radio0_0
option network lan
option mode ap
option ssid "Example AP"
option key "example-password"
option encryption psk-mixed+ccmp
option disabled 0
""",
        'upnpd': """config upnpd config
option enable_upnp 1
option enable_natpmp 1
option secure_mode 1
config perm_rule
option action allow
option ext_ports 1024-65535
config perm_rule
option action deny
option ext_ports 0-65535
""",
        'huayi_firewall': """config firewall remote
option remote_enable 1
option port 80
""",
        'openvpn': """package openvpn
config openvpn unused
option enabled 0
""",
    }
    return {name: migration.parse_uci(text) for name, text in values.items()}


class StockMigrationTests(unittest.TestCase):
    def test_plan_preserves_wan_and_excludes_router_from_dhcp_pool(self):
        batch, report = migration.plan(source())
        entries = [shlex.split(line)[1].split('=', 1) for line in batch.splitlines() if line.startswith('set ')]
        values = dict(entries)
        self.assertEqual(values['network.wan.device'], 'eth0.2')
        self.assertEqual(values['network.wan.mtu'], '1499')
        self.assertEqual(values['dhcp.lan.start'], '2')
        self.assertEqual(values['dhcp.lan.limit'], '253')
        self.assertEqual(values['dhcp.mp716_stock_0.leasetime'], 'infinite')
        self.assertEqual(values['wireless.default_radio0.key'], 'example-password')
        self.assertEqual(values['upnpd.config.enabled'], '1')
        self.assertEqual(values['firewall.mp716_stock_http.dest_port'], '80')
        self.assertNotIn('example-password', str(report))
        self.assertFalse(report['configuration_applied'])

    def test_active_unsupported_vpn_blocks_plan(self):
        configs = source()
        configs['openvpn'][0]['options']['enabled'] = '1'
        with self.assertRaisesRegex(ValueError, 'openvpn'):
            migration.plan(configs)

    def test_unmeasured_topology_is_not_silently_converted(self):
        configs = source()
        configs['network'][1]['options']['proto'] = 'pppoe'
        with self.assertRaisesRegex(ValueError, 'DHCP WAN'):
            migration.plan(configs)

    def test_wifi_quotes_are_data_and_control_characters_are_rejected(self):
        configs = source()
        value = "AP 'quoted' $(echo test);"
        configs['wireless'][1]['options']['ssid'] = value
        batch, _ = migration.plan(configs)
        command = next(line for line in batch.splitlines() if '.ssid=' in line)
        self.assertEqual(shlex.split(command)[1].split('=', 1)[1], value)
        configs['wireless'][1]['options']['key'] = 'example\ncommit firewall'
        with self.assertRaisesRegex(ValueError, 'Control characters'):
            migration.plan(configs)

    def test_nonstandard_upnp_rule_layout_requires_review(self):
        configs = source()
        configs['upnpd'].append(copy.deepcopy(configs['upnpd'][-1]))
        with self.assertRaisesRegex(ValueError, 'permission rule'):
            migration.plan(configs)
