"""Offline guards for the opt-in Linux peer probe. No real command/socket runs."""
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[2] / 'scripts/vpn-netns-probe.py'
SPEC = importlib.util.spec_from_file_location('vpn_netns_probe', PATH)
lab = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lab)

NS = 'mp716-vpn-a1b2c3d4'
PEER = '10.71.60.1'


def xfrm(packets):
    # Fake key-shaped text must never appear in the public result.
    return ''.join(f'src 192.168.199.{i} dst 192.168.199.{3-i}\n'
                   f' proto esp spi 0x1234 reqid 902 mode transport\n'
                   f' auth-trunc hmac(sha256) DO_NOT_REPORT_KEYS 128\n'
                   f' lifetime current:\n  240(bytes), {packets}(packets)\n'
                   for i in (1, 2))


class FakeLinux:
    def __init__(self, route='ppp0', kind='ppp', ping=True, http=True, unchanged=True,
                 xfrm_grows=True, command_failure=False):
        self.route, self.kind, self.ping, self.good_http = route, kind, ping, http
        self.unchanged, self.xfrm_grows = unchanged, xfrm_grows
        self.command_failure = command_failure
        self.calls, self.snapshots, self.xfrms = [], 0, 0

    def assert_isolated(self, ns):
        self.calls.append(('isolate', ns));return 1001

    def host_snapshot(self):
        self.snapshots += 1
        return {'routes':'same', 'policy_rules':'same', 'dns':'same',
                'firewall':'changed' if not self.unchanged and self.snapshots > 1 else 'same'}

    def json(self, argv, stage, timeout=12):
        self.calls.append(tuple(argv))
        if stage == 'tunnel_link':
            return [{'ifindex':7,'mtu':1400,'flags':['UP','POINTOPOINT'],
                     'link_type':self.kind,'linkinfo':{'info_kind':'tun' if self.kind == 'none' else self.kind}}]
        if stage == 'tunnel_route':return [{'dst':PEER,'dev':self.route}]
        raise AssertionError('unexpected command')

    def run(self, argv, stage, timeout=12):
        self.calls.append(tuple(argv))
        if self.command_failure:raise lab.ProbeError(stage,'simulated_failure')
        if stage == 'icmp_data':
            return '3 packets transmitted, 3 received, 0% packet loss' if self.ping else '3 packets transmitted, 0 received, 100% packet loss'
        if stage in ('xfrm_before','xfrm_after'):
            self.xfrms += 1
            return xfrm(3 if self.xfrms == 1 or not self.xfrm_grows else 9)
        raise AssertionError('unexpected command')

    def http(self, namespace, interface, peer, port, inode):
        self.calls.append(('socket_in_namespace',namespace,interface,peer,port,inode))
        return {'same_namespace':True,'bound_to_interface':interface,'http_status':200 if self.good_http else 500,'received_bytes':64}


def run(fake, protocol='pptp', interface='ppp0'):
    return lab.probe(fake, NS, interface, PEER, 80, protocol)


class NetnsProbeTests(unittest.TestCase):
    def test_plan_has_no_execution_or_authentication_claim(self):
        value = lab.plan()
        self.assertFalse(value['executed'])
        self.assertTrue(any('dev null' in row for row in value['requires']))

    def test_rejects_host_namespace_injection_non_tunnel_or_public_destination(self):
        for ns, iface, peer in [('default','ppp0',PEER),(NS+';id','ppp0',PEER),(NS,'eth0',PEER),
                                (NS,'tun0','8.8.8.8'),(NS,'ppp0','127.0.0.1'),(NS,'ppp0','vpn.example.org')]:
            with self.subTest(ns=ns,iface=iface,peer=peer),self.assertRaises(lab.ProbeError):
                lab.validate(ns,iface,peer,80)

    def test_real_ppp_route_and_bidirectional_data_do_not_imply_authentication(self):
        fake=FakeLinux();result=run(fake)
        self.assertTrue(result['data_plane_passed'])
        self.assertFalse(result['protocol_identity_or_authentication_attested'])
        self.assertFalse(result['services_started'])
        self.assertEqual(fake.snapshots,2)
        self.assertEqual(result['icmp_received'],3)
        self.assertTrue(all(result['host_unchanged'].values()))

    def test_openvpn_requires_real_tun_not_dev_null_or_renamed_ethernet(self):
        self.assertTrue(run(FakeLinux(route='tun0',kind='none'),'openvpn','tun0')['data_plane_passed'])
        bad=run(FakeLinux(route='tun0',kind='ether'),'openvpn','tun0')
        self.assertFalse(bad['data_plane_passed'])
        self.assertEqual(bad['failed_stage'],'tunnel_link')

    def test_wrong_route_fails_before_sending_probe(self):
        fake=FakeLinux(route='eth0');result=run(fake)
        self.assertEqual(result['failed_stage'],'tunnel_route')
        self.assertFalse(any('ping' in call for call in fake.calls))
        self.assertEqual(fake.snapshots,2)

    def test_loss_is_failure_and_still_checks_host_state(self):
        fake=FakeLinux(ping=False);result=run(fake)
        self.assertEqual(result['failed_stage'],'icmp_data')
        self.assertEqual(fake.snapshots,2)

    def test_http_failure_is_not_hidden_by_successful_ping(self):
        self.assertEqual(run(FakeLinux(http=False))['failed_stage'],'http_data')

    def test_host_rule_change_fails_and_does_not_restore_somebody_elses_state(self):
        fake=FakeLinux(unchanged=False);result=run(fake)
        self.assertFalse(result['data_plane_passed'])
        self.assertEqual(result['failed_stage'],'host_guard')
        self.assertNotIn('restore',str(fake.calls))

    def test_l2tp_ipsec_requires_real_esp_transport_packet_growth_and_uses_nokeys(self):
        fake=FakeLinux();result=run(fake,'l2tp-ipsec')
        self.assertTrue(result['data_plane_passed'])
        self.assertEqual(result['ipsec']['packet_delta'],12)
        self.assertNotIn('DO_NOT_REPORT_KEYS',str(result))
        calls=[c for c in fake.calls if 'xfrm' in c]
        self.assertEqual(len(calls),2)
        self.assertTrue(all('nokeys' in call for call in calls))

    def test_plaintext_l2tp_success_cannot_be_misreported_as_ipsec(self):
        result=run(FakeLinux(xfrm_grows=False),'l2tp-ipsec')
        self.assertEqual(result['failed_stage'],'xfrm_after')
        self.assertFalse(result['data_plane_passed'])

    def test_failed_commands_still_recheck_host_and_no_raw_error_output(self):
        fake=FakeLinux(command_failure=True);result=run(fake)
        self.assertEqual(result['failed_stage'],'icmp_data')
        self.assertEqual(fake.snapshots,2)
        self.assertEqual(set(result)&{'stdout','stderr','credentials'},set())

    def test_nft_counter_noise_does_not_hide_semantic_rule_changes(self):
        before={'nftables':[{'metainfo':{'version':'1'}},{'rule':{'expr':[{'counter':{'packets':1,'bytes':20}},{'drop':None}]}}]}
        noise={'nftables':[{'metainfo':{'version':'2'}},{'rule':{'expr':[{'counter':{'packets':9,'bytes':80}},{'drop':None}]}}]}
        changed={'nftables':[{'rule':{'expr':[{'counter':{'packets':9,'bytes':80}},{'accept':None}]}}]}
        self.assertEqual(lab.stable_rules(before),lab.stable_rules(noise))
        self.assertNotEqual(lab.stable_rules(before),lab.stable_rules(changed))


if __name__=='__main__':unittest.main()
