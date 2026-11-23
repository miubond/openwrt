"""Local fake RAS tests: no DLL calls, entries, sockets, routes or VPN traffic."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('windows_vpn_peer', ROOT / 'scripts/mp716-windows-vpn-peer.py')
peer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(peer)


def snapshot():
    return {'adapters': [{'ifIndex': 9, 'Status': 1}],
            'interfaces': [{'InterfaceIndex': 9, 'InterfaceMetric': 25}],
            'addresses': [{'InterfaceIndex': 9, 'IPAddress': '192.0.2.10'}],
            'dns': [{'InterfaceIndex': 9, 'AddressFamily': 2, 'ServerAddresses': ['192.0.2.1']}],
            'dnsGlobal': {'SuffixSearchList': []},
            'routes': [{'InterfaceIndex': 9, 'DestinationPrefix': '0.0.0.0/0', 'NextHop': '192.0.2.1'}]}


class FakeRas:
    def __init__(self, fail=None):
        self.fail, self.closed, self.active = fail, [], False
        self.book, self.name, self.wiped, self.erased = None, None, False, False
        self.checks = 0
        self.foreign = [(777, 'foreign.pbk', 'foreign-entry')]

    def devices(self):
        return [('vpn', 'WAN Miniport (PPTP)'), ('vpn', 'WAN Miniport (PPTP)'), ('vpn', 'WAN Miniport (L2TP)')]

    def connections(self):
        return self.foreign + ([(42, str(self.book), self.name)] if self.active else [])

    def profiles(self):
        return []

    def create(self, book, name, entry):
        self.book, self.name = book, name
        book.write_text('[temporary]\n', encoding='ascii')
        if self.fail == 'create':
            raise peer.PeerError('entry_creation_failed', 5)

    def cached_password(self, *_args):
        self.checks += 1
        return self.fail == 'cached' and self.checks == 2

    def start(self, _book, _name, _credentials, handle):
        handle.value, self.active = 42, True
        if self.fail == 'start':
            raise peer.PeerError('ras_dial_failed', 691)

    def wait(self, _timeout):
        if self.fail == 'timeout':
            raise peer.PeerError('ras_dial_timeout')
        if self.fail == 'auth':
            raise peer.PeerError('ras_authentication_failed', 691)

    def projection(self, _handle):
        return {'local_ip': '10.71.60.10', 'peer_ip': '10.71.60.1', 'mschapv2': True,
                'mppe128_send': self.fail != 'weak', 'mppe128_receive': True}

    def hangup(self, handle):
        if handle.value:
            self.closed.append(handle.value)
        if self.fail == 'hangup':
            raise peer.PeerError('ras_hangup_timeout')
        self.active = False

    def wipe(self):
        self.wiped = True

    def erase(self, *_args):
        self.erased = True
        if self.fail == 'erase':
            raise peer.PeerError('credential_clear_failed')


class AttestableRas(FakeRas):
    def __init__(self, projection_changes=None, verified=True):
        super().__init__()
        self.projection_changes = projection_changes or {}
        self.verified = verified

    def create(self, *args):
        super().create(*args)
        return self.verified

    def projection(self, handle):
        result = super().projection(handle)
        result.update(mschapv2=False, lcp_authentication_protocol=0, lcp_authentication_data=0,
                      lcp_eap_type_id=0, lcp_server_authentication_protocol=0xC223,
                      lcp_server_authentication_data=0x81, lcp_server_eap_type_id=0,
                      lcp_local_options=0, lcp_peer_options=0)
        result.update(self.projection_changes)
        return {key: value for key, value in result.items() if value is not DELETE}


DELETE = object()


class WindowsVpnPeerTests(unittest.TestCase):
    def bound_socket_fixture(self, sock):
        sock.getsockopt.side_effect = [41, 41]
        sock.getsockname.return_value = ('10.71.60.10', 50000)
        sock.getpeername.return_value = ('10.71.60.1', 80)
        sock.recv.return_value = b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK'

    def bound_probe_result(self, query_verified=False):
        return {'source_bound_tcp_connected': True, 'ras_interface_route_verified': query_verified,
            'interface_index': 41, 'interface_bound_probe_opt_in': True, 'socket_binding_verified': True,
            'route_query': {'status': 'verified' if query_verified else 'query_error',
                            'interface_indices': [41] if query_verified else None,
                            'error': None if query_verified else 'network_inventory_failed'},
            'socket_binding': {'option': 31, 'set_interface_index': 41, 'set_network_byte_order': True,
                'get_before_connect': 41, 'get_after_connect': 41, 'get_host_byte_order': True,
                'local_ip': '10.71.60.10', 'local_port': 50000, 'peer_ip': '10.71.60.1', 'peer_port': 80},
            'datapath_basis': 'route-query-and-source-bound-socket' if query_verified else 'interface-and-source-bound-socket',
            'http_status': 200, 'received_bytes': 40, 'icmp_source_ip': '10.71.60.10', 'icmp_peer_ip': '10.71.60.1',
            'icmp': {'sent': 3, 'received': 3, 'statuses': [0, 0, 0], 'round_trip_ms': [1, 1, 1]}}

    def run_bound_fake(self, callback, result=None):
        class VerifiedRas(FakeRas):
            def create(self, *args):
                super().create(*args)
                return True
        api = VerifiedRas()
        with tempfile.TemporaryDirectory(prefix='vpn-bound-probe-test-', dir=ROOT) as work:
            with patch.object(peer, 'network_snapshot', side_effect=[snapshot()] * 3), \
                 patch.object(peer, 'default_pbk_fingerprints', return_value={'default': 'same'}), \
                 patch.object(peer, 'peer_probe', return_value=result or self.bound_probe_result()):
                report = peer.run_peer(api, '192.0.2.1', '10.71.60.1', 9, ('user', 'secret'), Path(work),
                    allow_interface_bound_probe=True, on_connected=callback)
                remaining = list(Path(work).iterdir())
        return report, remaining, api

    def test_opt_in_preserves_route_error_or_false_and_verifies_native_socket_readbacks(self):
        for query in ('network_inventory_failed', 'network_inventory_invalid', [9], []):
            with self.subTest(query=query):
                before, during = self.outer_route_fixture()
                kwargs = {'side_effect': peer.PeerError(query)} if isinstance(query, str) else {'return_value': query}
                with patch.object(peer, 'powershell', **kwargs), patch.object(peer.socket, 'socket') as factory, \
                     patch.object(peer, 'icmp_probe', return_value={'sent': 3, 'received': 3}) as icmp:
                    sock = factory.return_value.__enter__.return_value
                    self.bound_socket_fixture(sock)
                    result = peer.peer_probe(before, during, {'local_ip': '10.71.60.10'}, '10.71.60.1', 80,
                        allow_interface_bound_probe=True)
                    self.assertFalse(result['ras_interface_route_verified'])
                    self.assertTrue(result['socket_binding_verified'])
                    self.assertEqual(result['datapath_basis'], 'interface-and-source-bound-socket')
                    self.assertEqual(result['socket_binding']['get_before_connect'], 41)
                    self.assertEqual(result['socket_binding']['get_after_connect'], 41)
                    self.assertEqual(result['route_query']['error'], query if isinstance(query, str) else None)
                    self.assertEqual(result['route_query']['interface_indices'], None if isinstance(query, str) else query)
                    sock.setsockopt.assert_called_once_with(peer.socket.IPPROTO_IP, 31, peer.struct.pack('!I', 41))
                    self.assertEqual(sock.getsockopt.call_count, 2)
                    sock.bind.assert_called_once_with(('10.71.60.10', 0))
                    sock.connect.assert_called_once_with(('10.71.60.1', 80))
                    icmp.assert_called_once_with('10.71.60.10', '10.71.60.1')
                    self.assertNotIn(b'Authorization', sock.sendall.call_args.args[0])

    def test_default_query_error_remains_strict_and_records_partial_diagnostic(self):
        before, during = self.outer_route_fixture()
        diagnostic = {}
        with patch.object(peer, 'powershell', side_effect=peer.PeerError('network_inventory_failed')), \
             patch.object(peer.socket, 'socket') as factory:
            with self.assertRaisesRegex(peer.PeerError, 'network_inventory_failed'):
                peer.peer_probe(before, during, {'local_ip': '10.71.60.10'}, '10.71.60.1', 80, diagnostic=diagnostic)
            factory.assert_not_called()
        self.assertFalse(diagnostic['ras_interface_route_verified'])
        self.assertEqual(diagnostic['route_query']['error'], 'network_inventory_failed')

    def test_opt_in_does_not_catch_unknown_query_errors_or_accept_malformed_query_rows(self):
        for value in (peer.PeerError('unrelated_gate_failed'), OSError('PRIVATE_QUERY'), [True], ['41'], [41, 41], {'token': 'PRIVATE_QUERY'}):
            with self.subTest(value=type(value).__name__):
                before, during = self.outer_route_fixture()
                kwargs = {'side_effect': value} if isinstance(value, Exception) else {'return_value': value}
                with patch.object(peer, 'powershell', **kwargs), patch.object(peer.socket, 'socket') as factory:
                    with self.assertRaises((peer.PeerError, OSError)):
                        peer.peer_probe(before, during, {'local_ip': '10.71.60.10'}, '10.71.60.1', 80,
                            allow_interface_bound_probe=True)
                    factory.assert_not_called()

    def test_opt_in_rejects_every_socket_binding_endpoint_connect_or_http_failure_without_retry(self):
        for change in ('before-index', 'network-order-get', 'after-index', 'local-address', 'local-port',
                       'peer-address', 'peer-port', 'connect', 'http-401', 'http-500', 'invalid-http', 'receive'):
            with self.subTest(change=change):
                before, during = self.outer_route_fixture()
                with patch.object(peer, 'powershell', return_value=[9]), patch.object(peer.socket, 'socket') as factory, \
                     patch.object(peer, 'icmp_probe') as icmp:
                    sock = factory.return_value.__enter__.return_value
                    self.bound_socket_fixture(sock)
                    if change == 'before-index': sock.getsockopt.side_effect = [9]
                    if change == 'network-order-get': sock.getsockopt.side_effect = [41 << 24]
                    if change == 'after-index': sock.getsockopt.side_effect = [41, 9]
                    if change == 'local-address': sock.getsockname.return_value = ('192.0.2.10', 50000)
                    if change == 'local-port': sock.getsockname.return_value = ('10.71.60.10', 0)
                    if change == 'peer-address': sock.getpeername.return_value = ('192.0.2.1', 80)
                    if change == 'peer-port': sock.getpeername.return_value = ('10.71.60.1', 81)
                    if change == 'connect': sock.connect.side_effect = OSError('connect failed')
                    if change == 'http-401': sock.recv.return_value = b'HTTP/1.1 401 Unauthorized\r\n\r\n'
                    if change == 'http-500': sock.recv.return_value = b'HTTP/1.1 500 Failed\r\n\r\n'
                    if change == 'invalid-http': sock.recv.return_value = b'not-http'
                    if change == 'receive': sock.recv.side_effect = OSError('receive failed')
                    with self.assertRaises((peer.PeerError, OSError)):
                        peer.peer_probe(before, during, {'local_ip': '10.71.60.10'}, '10.71.60.1', 80,
                            allow_interface_bound_probe=True)
                    self.assertEqual(factory.call_count, 1)
                    icmp.assert_not_called()

    def test_opt_in_false_query_requires_exact_true_controller_and_keeps_raw_query_false(self):
        for verdict in (True, False, None, 1, 'yes', {}):
            with self.subTest(verdict=verdict):
                seen = []
                def callback(report):
                    self.assertFalse(report['probe']['ras_interface_route_verified'])
                    self.assertTrue(report['probe']['socket_binding_verified'])
                    self.assertTrue(report['controller_data_path_proof_required'])
                    self.assertFalse(report['controller_data_path_proven'])
                    seen.append(True)
                    return verdict
                result, remaining, api = self.run_bound_fake(callback)
                self.assertEqual(result['ok'], verdict is True)
                self.assertFalse(result['probe']['ras_interface_route_verified'])
                if verdict is True:
                    self.assertTrue(result['controller_data_path_proven'])
                    self.assertEqual(result['datapath_basis'], 'interface-bound-socket-and-controller-ppp-proof')
                else:
                    self.assertEqual(result['error'], 'controller_data_path_not_proven')
                self.assertEqual(seen, [True])
                self.assertTrue(result['disconnected'])
                self.assertTrue(result['temporary_book_removed'])
                self.assertTrue(all(result['after'].values()))
                self.assertEqual(api.closed, [42])
                self.assertEqual(remaining, [])

    def test_opt_in_socket_or_icmp_failure_never_calls_controller_and_cleans(self):
        for change in ('socket', 'icmp-received', 'icmp-sent'):
            with self.subTest(change=change):
                probe = self.bound_probe_result()
                if change == 'socket': probe['socket_binding_verified'] = False
                if change == 'icmp-received': probe['icmp']['received'] = 2
                if change == 'icmp-sent': probe['icmp']['sent'] = 4
                called = []
                result, remaining, api = self.run_bound_fake(lambda r: called.append(r) or True, probe)
                self.assertFalse(result['ok'])
                self.assertEqual(called, [])
                self.assertTrue(result['disconnected'])
                self.assertEqual(api.closed, [42])
                self.assertEqual(remaining, [])

    def test_opt_in_known_route_query_needs_no_alternate_controller_proof(self):
        result, remaining, _api = self.run_bound_fake(lambda report: None, self.bound_probe_result(query_verified=True))
        self.assertTrue(result['ok'])
        self.assertFalse(result['controller_data_path_proof_required'])
        self.assertTrue(result['probe']['ras_interface_route_verified'])
        self.assertEqual(remaining, [])

    def test_opt_in_controller_exception_is_sanitized_and_cleans(self):
        def callback(_report):
            raise RuntimeError('PRIVATE_CALLBACK')
        result, remaining, api = self.run_bound_fake(callback)
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'peer_operation_failed')
        self.assertNotIn('PRIVATE_CALLBACK', json.dumps(result))
        self.assertFalse(result['controller_data_path_proven'])
        self.assertTrue(result['disconnected'])
        self.assertEqual(api.closed, [42])
        self.assertEqual(remaining, [])

    def test_opt_in_rejects_nonunique_or_preexisting_ras_identity_before_route_query(self):
        for change in ('duplicate-ip', 'hidden-old-index', 'missing-family', 'duplicate-interface'):
            with self.subTest(change=change):
                before, during = self.outer_route_fixture()
                if change == 'duplicate-ip': during['addresses'].append(dict(during['addresses'][-1]))
                if change == 'hidden-old-index': before['adapters'].append({'ifIndex': 41, 'Status': 1})
                if change == 'missing-family': during['addresses'][-1].pop('AddressFamily')
                if change == 'duplicate-interface': during['interfaces'].append(dict(during['interfaces'][-1]))
                with patch.object(peer, 'powershell') as query, patch.object(peer.socket, 'socket') as factory:
                    with self.assertRaisesRegex(peer.PeerError, 'ras_interface_not_unique'):
                        peer.peer_probe(before, during, {'local_ip': '10.71.60.10'}, '10.71.60.1', 80,
                            allow_interface_bound_probe=True)
                    query.assert_not_called();factory.assert_not_called()

    def test_opt_in_requires_callable_pptp_controller_and_port80_before_inventory(self):
        cases = [dict(allow_interface_bound_probe=True), dict(allow_interface_bound_probe=1, on_connected=lambda r: True),
            dict(allow_interface_bound_probe=True, on_connected=lambda r: True, probe_port=81),
            dict(allow_interface_bound_probe=True, on_connected=lambda r: True, protocol='l2tp-ipsec',
                 preshared_key='A' * 32, on_disconnected=lambda r: True)]
        for options in cases:
            with self.subTest(options=list(options)):
                with patch.object(peer, 'network_snapshot') as inventory, patch.object(peer, 'OwnedBook') as book:
                    with self.assertRaisesRegex(peer.PeerError, 'interface_bound_probe_requires_pptp_controller'):
                        peer.run_peer(FakeRas(), '192.0.2.1', '10.71.60.1', 9, ('user', 'secret'), ROOT, **options)
                    inventory.assert_not_called();book.assert_not_called()

    def test_opt_in_unproven_entry_readback_rejects_before_dial_and_cleans_book(self):
        api, called = FakeRas(), []
        result, remaining = self.run_fake(api, hook=lambda r: called.append(r) or True,
            allow_interface_bound_probe=True)
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'interface_bound_probe_entry_policy_unproven')
        self.assertEqual(api.closed, [])
        self.assertFalse(api.active)
        self.assertEqual(called, [])
        self.assertTrue(result['temporary_book_removed'])
        self.assertEqual(remaining, [])

    def outer_route_fixture(self):
        before = snapshot()
        before['interfaces'][0]['AddressFamily'] = 2
        before['addresses'][0].update(AddressFamily=2, PrefixLength=24, SkipAsSource=False)
        before['routes'] = [dict(InterfaceIndex=9, AddressFamily=2, DestinationPrefix='0.0.0.0/0',
            NextHop='192.0.2.1', Protocol=3, RouteMetric=25),
            dict(InterfaceIndex=9, AddressFamily=2, DestinationPrefix='192.0.2.0/24',
            NextHop='0.0.0.0', Protocol=2, RouteMetric=256)]
        during = json.loads(json.dumps(before))
        during['interfaces'].append({'InterfaceIndex': 41, 'AddressFamily': 2, 'InterfaceMetric': 9999})
        during['addresses'].append({'InterfaceIndex': 41, 'AddressFamily': 2, 'IPAddress': '10.71.60.10', 'PrefixLength': 32})
        for prefix in ('10.71.60.10/32', '224.0.0.0/4', '255.255.255.255/32'):
            during['routes'].append(dict(InterfaceIndex=41, AddressFamily=2, DestinationPrefix=prefix,
                NextHop='0.0.0.0', Protocol=2, RouteMetric=256))
        during['routes'].append(dict(InterfaceIndex=9, AddressFamily=2, DestinationPrefix='192.0.2.1/32',
            NextHop='0.0.0.0', Protocol=3, RouteMetric=1))
        return before, during

    def outer_proof(self, before, during):
        return peer.automatic_outer_host_route_proof(before, during, {'local_ip': '10.71.60.10'},
            '192.0.2.1', 9, peer.outer_server_preflight(before, '192.0.2.1', 9))

    def test_exact_automatic_outer_route_has_distinct_effective_proof_without_changing_raw(self):
        before, during = self.outer_route_fixture()
        proof = self.outer_proof(before, during)
        self.assertIs(proof['verified'], True)
        self.assertIs(proof['route_write_performed'], False)
        self.assertEqual(proof['ras_interface_index'], 41)
        self.assertEqual(proof['preflight']['control_network'], '192.0.2.0/24')
        observed = []
        def authenticate(report):
            self.assertFalse(report['during']['routes_unchanged'])
            self.assertTrue(all(report['during_effective'].values()))
            self.assertIs(report['original_network_preserved'], True)
            self.assertEqual(report['automatic_outer_host_route_proof'], proof)
            observed.append(True)
            return True
        result, remaining = self.run_fake(AttestableRas(), inventory=[before, during, before],
            authentication_validator=authenticate)
        self.assertTrue(result['ok'], result)
        self.assertFalse(result['during']['routes_unchanged'])
        self.assertTrue(result['during_effective']['routes_unchanged'])
        self.assertEqual(result['network_diffs']['during']['routes']['after_only_count'], 4)
        self.assertTrue(all(result['after'].values()))
        self.assertEqual(observed, [True])
        self.assertEqual(remaining, [])

    def test_outer_preflight_rejects_existing_host_route_wrong_subnet_gateway_or_competing_route(self):
        for change in ('host', 'subnet', 'gateway', 'competing', 'skip-source'):
            with self.subTest(change=change):
                before, during = self.outer_route_fixture()
                if change == 'host': before['routes'].append(dict(during['routes'][-1], InterfaceIndex=77))
                if change == 'subnet': before['addresses'][0]['IPAddress'] = '198.51.100.10'
                if change == 'gateway': before['routes'][1]['NextHop'] = '192.0.2.254'
                if change == 'competing': before['routes'].append(dict(before['routes'][1], InterfaceIndex=77))
                if change == 'skip-source': before['addresses'][0]['SkipAsSource'] = True
                self.assertFalse(peer.outer_server_preflight(before, '192.0.2.1', 9)['verified'])
                self.assertIsNone(self.outer_proof(before, during))

    def test_outer_proof_rejects_every_unobserved_underlay_route_field_and_duplicates(self):
        changes = [('InterfaceIndex', 8), ('AddressFamily', 23), ('DestinationPrefix', '192.0.2.2/32'),
            ('NextHop', '192.0.2.254'), ('Protocol', 2), ('RouteMetric', 2), ('RouteMetric', True)]
        for field, value in changes:
            with self.subTest(field=field, value=value):
                before, during = self.outer_route_fixture()
                during['routes'][-1][field] = value
                self.assertIsNone(self.outer_proof(before, during))
        before, during = self.outer_route_fixture()
        during['routes'].append(dict(during['routes'][-1]))
        self.assertIsNone(self.outer_proof(before, during))

    def test_outer_proof_rejects_route_removal_other_original_addition_default_or_foreign_new_interface(self):
        for change in ('removed', 'extra-old', 'default', 'foreign-new', 'original-address'):
            with self.subTest(change=change):
                before, during = self.outer_route_fixture()
                if change == 'removed': during['routes'].pop(1)
                if change == 'extra-old': during['routes'].append(dict(during['routes'][-1], DestinationPrefix='198.51.100.1/32'))
                if change == 'default': during['routes'].append(dict(during['routes'][2], DestinationPrefix='0.0.0.0/0'))
                if change == 'foreign-new': during['routes'].append(dict(during['routes'][2], InterfaceIndex=42))
                if change == 'original-address': during['addresses'][0]['IPAddress'] = '192.0.2.11'
                self.assertIsNone(self.outer_proof(before, during))

    def test_outer_proof_rejects_nonunique_or_existing_ras_identity_and_truncated_diffs(self):
        for change in ('duplicate-ip', 'duplicate-iface', 'old-index', 'large-diff'):
            with self.subTest(change=change):
                before, during = self.outer_route_fixture()
                if change == 'duplicate-ip': during['addresses'].append(dict(during['addresses'][-1]))
                if change == 'duplicate-iface': during['interfaces'].append(dict(during['interfaces'][-1]))
                if change == 'old-index': before['adapters'].append({'ifIndex': 41, 'Status': 1})
                if change == 'large-diff': during['routes'] += [dict(during['routes'][2], DestinationPrefix=f'198.51.100.{n}/32') for n in range(40)]
                self.assertIsNone(self.outer_proof(before, during))

    def test_direct_preservation_still_has_raw_and_effective_equal_without_any_outer_exception(self):
        result, remaining = self.run_fake(FakeRas())
        self.assertTrue(result['ok'])
        self.assertEqual(result['during'], result['during_effective'])
        self.assertIs(result['original_network_preserved'], True)
        self.assertIsNone(result['automatic_outer_host_route_proof'])
        self.assertEqual(remaining, [])

    def test_active_preserves_hidden_adapter_without_ip_interface_and_rejects_its_changes(self):
        before = snapshot()
        before['adapters'].append({'ifIndex': 20, 'InterfaceGuid': 'original-hidden-guid', 'Status': 2, 'AdminStatus': 1})
        during = json.loads(json.dumps(before))
        during['adapters'].append({'ifIndex': 55, 'InterfaceGuid': 'new-ras-guid', 'Status': 1, 'AdminStatus': 1})
        during['interfaces'].append({'InterfaceIndex': 55, 'AddressFamily': 2})
        self.assertTrue(all(peer.preservation(before, during, active=True).values()))
        for field, value in [('InterfaceGuid', 'other-guid'), ('Status', 1), ('AdminStatus', 2)]:
            with self.subTest(field=field):
                changed = json.loads(json.dumps(during))
                changed['adapters'][1][field] = value
                self.assertFalse(peer.preservation(before, changed, active=True)['adapters_unchanged'])
        during['adapters'].pop(1)
        self.assertFalse(peer.preservation(before, during, active=True)['adapters_unchanged'])

    def test_new_adapter_is_ignored_only_on_new_index(self):
        before = snapshot()
        before['adapters'] = []
        after = json.loads(json.dumps(before))
        after['adapters'] = [{'ifIndex': 55, 'Status': 1}]
        self.assertTrue(peer.preservation(before, after, active=True)['adapters_unchanged'])
        after['adapters'][0]['ifIndex'] = 9
        self.assertFalse(peer.preservation(before, after, active=True)['adapters_unchanged'])

    def test_active_outer_host_route_is_reported_and_remains_rejected(self):
        before, during = snapshot(), snapshot()
        added = {'InterfaceIndex': 9, 'AddressFamily': 2, 'DestinationPrefix': '192.0.2.1/32',
                 'NextHop': '0.0.0.0', 'RouteMetric': 1, 'Protocol': 3}
        during['routes'].append(added)
        result, remaining = self.run_fake(FakeRas(), inventory=[before, during, before])
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'original_network_changed_during_tunnel')
        self.assertFalse(result['during']['routes_unchanged'])
        self.assertTrue(result['during']['default_routes_unchanged'])
        self.assertEqual(result['network_diffs']['during']['routes']['after_only'], [added])
        self.assertTrue(all(result['after'].values()))
        self.assertEqual(result['network_diffs']['after']['routes']['after_only_count'], 0)
        self.assertEqual(remaining, [])

    def test_network_diffs_are_whitelisted_bounded_and_keep_duplicate_counts(self):
        before, after = snapshot(), snapshot()
        after['routes'] = [dict(before['routes'][0], RouteMetric=n,
            Password='PRIVATE_PASSWORD', Token='PRIVATE_TOKEN', MacAddress='PRIVATE_MAC', SSID='PRIVATE_SSID')
            for n in range(80)]
        result = peer.network_differences(before, after)['routes']
        self.assertEqual(result['before_only_count'], 1)
        self.assertEqual(result['after_only_count'], 80)
        self.assertLessEqual(len(result['before_only']) + len(result['after_only']), 32)
        self.assertTrue(result['truncated'])
        self.assertNotIn('PRIVATE_', json.dumps(result))
        after = snapshot()
        after['routes'].append(dict(after['routes'][0]))
        result = peer.network_differences(before, after)['routes']
        self.assertEqual(result['after_only_count'], 1)
        self.assertEqual(result['before_only_count'], 0)

    def test_preexisting_collection_index_without_ip_interface_is_still_strict(self):
        before = snapshot()
        row = {'InterfaceIndex': 77, 'DestinationPrefix': '198.51.100.1/32', 'NextHop': '0.0.0.0'}
        before['routes'].append(row)
        after = json.loads(json.dumps(before))
        self.assertTrue(peer.preservation(before, after, active=True)['routes_unchanged'])
        after['routes'][1]['NextHop'] = '192.0.2.1'
        self.assertFalse(peer.preservation(before, after, active=True)['routes_unchanged'])

    def assert_clean_failure(self, result, remaining, api):
        self.assertFalse(result['ok'])
        self.assertFalse(result['server_attested_client_mschapv2'])
        self.assertNotIn('probe', result)
        self.assertTrue(result['disconnected'])
        self.assertTrue(result['temporary_book_removed'])
        self.assertEqual(api.closed, [42])
        self.assertEqual(remaining, [])

    def test_attestation_is_explicit_before_probe_and_preserves_raw_result(self):
        api, events = AttestableRas(), []

        def authenticate(report):
            self.assertTrue(api.active)
            self.assertTrue(report['windows_entry_policy_verified'])
            self.assertFalse(report['projection']['mschapv2'])
            self.assertFalse(report['server_attested_client_mschapv2'])
            self.assertNotIn('probe', report)
            self.assertTrue(all(report['during'].values()))
            self.assertNotIn('secret', json.dumps(report))
            events.append('authenticate')
            report['projection']['mschapv2'] = True  # Detached caller copy only.
            return True

        def connected(report):
            self.assertEqual(events, ['authenticate'])
            self.assertTrue(report['server_attested_client_mschapv2'])
            self.assertFalse(report['projection']['mschapv2'])
            self.assertIn('probe', report)
            events.append('connected')

        result, remaining = self.run_fake(api, connected, authentication_validator=authenticate)
        self.assertTrue(result['ok'], result)
        self.assertFalse(result['projection']['mschapv2'])
        self.assertTrue(result['server_attested_client_mschapv2'])
        self.assertEqual(events, ['authenticate', 'connected'])
        self.assertTrue(result['temporary_book_removed'])
        self.assertEqual(remaining, [])

    def test_observed_server_fields_alone_never_pass(self):
        api = AttestableRas()
        result, remaining = self.run_fake(api)
        self.assertEqual(result['error'], 'negotiated_security_mismatch')
        self.assert_clean_failure(result, remaining, api)

    def test_every_unknown_auth_or_options_value_rejects_without_callback(self):
        cases = [('lcp_authentication_protocol', 0xC223), ('lcp_authentication_data', 0x81),
                 ('lcp_eap_type_id', 25), ('lcp_server_authentication_protocol', 0xC023),
                 ('lcp_server_authentication_data', 0x80), ('lcp_server_eap_type_id', 25),
                 ('lcp_local_options', 1), ('lcp_peer_options', 1),
                 ('lcp_authentication_protocol', DELETE), ('lcp_authentication_data', False),
                 ('lcp_eap_type_id', 0.0), ('lcp_server_authentication_data', '129'),
                 ('mppe128_send', False), ('mppe128_receive', False), ('mschapv2', None)]
        for key, value in cases:
            with self.subTest(key=key, value=repr(value)):
                api, called = AttestableRas({key: value}), []
                result, remaining = self.run_fake(api, authentication_validator=lambda r: called.append(r) or True)
                self.assertEqual(result['error'], 'negotiated_security_mismatch')
                self.assertEqual(called, [])
                self.assert_clean_failure(result, remaining, api)

    def test_entry_readback_requires_exact_true_for_attestation(self):
        for verified in (None, False, 1, 'yes'):
            with self.subTest(verified=verified):
                api, called = AttestableRas(verified=verified), []
                result, remaining = self.run_fake(api, authentication_validator=lambda r: called.append(r) or True)
                self.assertEqual(called, [])
                self.assertEqual(result['error'], 'negotiated_security_mismatch')
                self.assert_clean_failure(result, remaining, api)

    def test_callback_requires_exact_true_and_still_cleans(self):
        for verdict in (False, None, 1, 'yes', {}, [True]):
            with self.subTest(verdict=verdict):
                api = AttestableRas()
                result, remaining = self.run_fake(api, authentication_validator=lambda r: verdict)
                self.assertEqual(result['error'], 'server_client_authentication_not_proven')
                self.assert_clean_failure(result, remaining, api)

    def test_callback_exception_and_interrupt_are_sanitized_and_clean(self):
        for error in (RuntimeError('PRIVATE_MARKER'), KeyboardInterrupt(), peer.PeerError('PRIVATE_MARKER')):
            with self.subTest(error=type(error).__name__):
                def authenticate(_report):
                    raise error
                api = AttestableRas()
                result, remaining = self.run_fake(api, authentication_validator=authenticate)
                self.assertNotIn('PRIVATE_MARKER', json.dumps(result))
                self.assertEqual(result['error'], 'server_client_authentication_not_proven')
                self.assert_clean_failure(result, remaining, api)

    def test_documented_local_authentication_does_not_use_callback(self):
        called = []
        result, remaining = self.run_fake(FakeRas(), authentication_validator=lambda r: called.append(r) or False)
        self.assertTrue(result['ok'], result)
        self.assertEqual(called, [])
        self.assertFalse(result['server_attested_client_mschapv2'])
        self.assertEqual(remaining, [])

    def test_peer_or_original_network_mismatch_prevents_attestation(self):
        for change_peer in (True, False):
            with self.subTest(change_peer=change_peer):
                called = []
                changed = snapshot()
                changed['dns'][0]['ServerAddresses'] = ['198.51.100.53']
                api = AttestableRas({'peer_ip': '10.71.60.2'} if change_peer else {})
                inventory = None if change_peer else [snapshot(), changed, snapshot()]
                result, remaining = self.run_fake(api, inventory=inventory,
                    authentication_validator=lambda r: called.append(r) or True)
                self.assertEqual(called, [])
                self.assertIn(result['error'], ('ppp_peer_address_mismatch', 'original_network_changed_during_tunnel'))
                self.assert_clean_failure(result, remaining, api)

    def test_invalid_callback_or_l2tp_callback_rejected_before_entry(self):
        for options in ({'authentication_validator': True},
                        {'protocol': 'l2tp-ipsec', 'preshared_key': 'A' * 32,
                         'on_connected': lambda r: True, 'on_disconnected': lambda r: True,
                         'authentication_validator': lambda r: True}):
            with self.subTest(options=list(options)):
                api = AttestableRas()
                with self.assertRaisesRegex(peer.PeerError, 'authentication_validator_invalid'):
                    peer.run_peer(api, '192.0.2.1', '10.71.60.1', 9, ('user', 'secret'), ROOT, **options)
                self.assertIsNone(api.book)

    def test_projection_retains_numeric_lcp_diagnostics_without_weakening_authentication(self):
        expected = {'lcp_authentication_protocol': 0xC223, 'lcp_authentication_data': 0x80,
                    'lcp_eap_type_id': 11, 'lcp_server_authentication_protocol': 0xC227,
                    'lcp_server_authentication_data': 0x81, 'lcp_server_eap_type_id': 25,
                    'lcp_local_options': 3, 'lcp_peer_options': 7}

        class ProjectionDll:
            def RasGetProjectionInfoW(self, _handle, projection_type, ptr, _size):
                if projection_type == 0x8021:
                    row = peer.C.cast(ptr, peer.C.POINTER(peer.RASPPPIPW)).contents
                    row.szIpAddress, row.szServerIpAddress = '10.71.60.10', '10.71.60.1'
                elif projection_type == 0xC021:
                    row = peer.C.cast(ptr, peer.C.POINTER(peer.RASPPPLCPW)).contents
                    row.dwAuthenticationProtocol = expected['lcp_authentication_protocol']
                    row.dwAuthenticationData = expected['lcp_authentication_data']
                    row.dwEapTypeId = expected['lcp_eap_type_id']
                    row.dwServerAuthenticationProtocol = expected['lcp_server_authentication_protocol']
                    row.dwServerAuthenticationData = expected['lcp_server_authentication_data']
                    row.dwServerEapTypeId = expected['lcp_server_eap_type_id']
                    row.dwOptions, row.dwServerOptions = expected['lcp_local_options'], expected['lcp_peer_options']
                    row.szReplyMessage = 'PRIVATE_TEXT_MUST_NOT_BE_RETURNED'
                else:
                    row = peer.C.cast(ptr, peer.C.POINTER(peer.RASPPPCCP)).contents
                    row.dwOptions = row.dwServerOptions = 0x40
                return 0

        api = object.__new__(peer.RasApi)
        api.dll = ProjectionDll()
        for protocol in ('pptp', 'l2tp'):
            with self.subTest(protocol=protocol):
                result = api.projection(peer.C.c_void_p(42), protocol)
                self.assertFalse(result['mschapv2'])
                self.assertEqual({key: result[key] for key in expected}, expected)
                self.assertTrue(all(type(result[key]) is int for key in expected))
                self.assertNotIn('PRIVATE_TEXT', json.dumps(result))
                self.assertEqual(set(result), set(expected) | {'local_ip', 'peer_ip', 'mschapv2'} |
                                 ({'mppe128_send', 'mppe128_receive'} if protocol == 'pptp' else set()))
        expected['lcp_authentication_data'] = 0x81
        self.assertTrue(api.projection(peer.C.c_void_p(42))['mschapv2'])

    def normalized_entry(self):
        expected = peer.make_entry('192.0.2.1', 'WAN Miniport (PPTP)', '192.0.2.53')
        actual = peer.RASENTRYW.from_buffer_copy(bytes(expected))
        actual.dwfOptions |= 0x00011C00
        actual.dwSubEntries = 1
        return expected, actual

    def test_observed_windows_summary_normalization_is_accepted(self):
        expected, actual = self.normalized_entry()
        peer.validate_entry_readback(expected, actual)

    def test_readback_rejects_pap_chap_mschap1_eap_default_or_unknown_option(self):
        for bit in (0x40000, 0x8000000, 0x10000000, 0x20000, 0x10, 0x200):
            with self.subTest(bit=hex(bit)):
                expected, actual = self.normalized_entry()
                actual.dwfOptions |= bit
                with self.assertRaisesRegex(peer.PeerError, 'entry_safety_readback_mismatch'):
                    peer.validate_entry_readback(expected, actual)

    def test_readback_rejects_removed_requested_bit(self):
        expected, actual = self.normalized_entry()
        actual.dwfOptions &= ~0x20000000
        with self.assertRaises(peer.PeerError):
            peer.validate_entry_readback(expected, actual)

    def test_readback_rejects_dns_registration_cache_default_or_policy_change(self):
        for field, value in [('dwfOptions2', peer.RASEO2_SAFE | 0x4000),
                             ('dwfOptions2', peer.RASEO2_SAFE | 0x02000000),
                             ('dwfOptions2', peer.RASEO2_SAFE | 0x2000),
                             ('dwfNetProtocols', 12), ('dwVpnStrategy', 2),
                             ('dwEncryptionType', 3), ('dwIPv4InterfaceMetric', 1),
                             ('dwSubEntries', 2)]:
            with self.subTest(field=field, value=value):
                expected, actual = self.normalized_entry()
                setattr(actual, field, value)
                with self.assertRaises(peer.PeerError):
                    peer.validate_entry_readback(expected, actual)

    def test_readback_rejects_dns_address_suffix_and_script_changes(self):
        for field in ('ipaddrDns', 'ipaddrDnsAlt', 'ipaddrWins'):
            with self.subTest(field=field):
                expected, actual = self.normalized_entry()
                getattr(actual, field).octets[0] ^= 1
                with self.assertRaises(peer.PeerError):
                    peer.validate_entry_readback(expected, actual)
        for field in ('szDnsSuffix', 'szScript'):
            expected, actual = self.normalized_entry()
            setattr(actual, field, 'unexpected')
            with self.assertRaises(peer.PeerError):
                peer.validate_entry_readback(expected, actual)

    def test_entry_requires_mschapv2_mppe128_without_default_dns_registration_or_cache(self):
        entry = peer.make_entry('192.0.2.1', 'WAN Miniport (PPTP)', '192.0.2.53')
        self.assertEqual(entry.dwfOptions, 0x20000004)
        self.assertEqual(entry.dwEncryptionType, 2)
        self.assertEqual(entry.dwVpnStrategy, 1)
        self.assertEqual(entry.dwfNetProtocols, 4)
        for unsafe in (0x100, 0x2000, 0x4000, 0x8000, 0x02000000, 0x10):
            self.assertFalse(entry.dwfOptions2 & unsafe)
        self.assertTrue(entry.dwfOptions2 & 0x80000)
        self.assertEqual(bytes(entry.ipaddrDns), bytes([192, 0, 2, 53]))

    @unittest.skipUnless(os.name == 'nt', 'Microsoft native WCHAR ABI')
    def test_sdk_x64_sizes_and_offsets(self):
        peer.check_abi()
        self.assertEqual(peer.RASENTRYW.dwVpnStrategy.offset, 4044)
        self.assertEqual(peer.RASENTRYW.dwfOptions2.offset, 4048)
        self.assertEqual(peer.RASDIALPARAMSW.dwCallbackId.offset, 2100)
        self.assertEqual(peer.RASDIALPARAMSW.szEncPassword.offset, 2112)
        self.assertEqual(peer.RASCONNW.hrasconn.offset, 4)
        self.assertEqual(peer.C.sizeof(peer.RASENTRYNAMEW), 1048)

    def test_invalid_secret_never_appears_in_error(self):
        for value in [{'username': 'user', 'password': 'must-not-print\n'},
                      {'username': '', 'password': 'must-not-print'},
                      {'username': 'user', 'password': 'x', 'psk': 'must-not-print'}]:
            with self.assertRaises(peer.PeerError) as cm:
                peer.validate_credentials(value)
            self.assertEqual(str(cm.exception), 'credential_input_invalid')

    def test_credential_utf16_limit(self):
        with self.assertRaises(peer.PeerError):
            peer.validate_credentials({'username': 'user', 'password': '\U0001f600' * 129})

    def test_active_new_default_route_fails_even_when_on_new_interface(self):
        before, after = snapshot(), snapshot()
        after['routes'].append({'InterfaceIndex': 55, 'DestinationPrefix': '0.0.0.0/0', 'NextHop': '0.0.0.0'})
        check = peer.preservation(before, after, active=True)
        self.assertTrue(check['routes_unchanged'])
        self.assertFalse(check['default_routes_unchanged'])

    def test_physical_dns_or_mtu_change_is_detected(self):
        before, after = snapshot(), snapshot()
        after['dns'][0]['ServerAddresses'] = ['198.51.100.53']
        after['interfaces'][0]['NlMtu'] = 1400
        check = peer.preservation(before, after, active=True)
        self.assertFalse(check['dns_unchanged'])
        self.assertFalse(check['interfaces_unchanged'])

    def run_fake(self, api, hook=None, inventory=None, **kwargs):
        with tempfile.TemporaryDirectory(prefix='vpn-peer-test-', dir=ROOT) as work:
            with patch.object(peer, 'network_snapshot', side_effect=inventory or [snapshot(), snapshot(), snapshot()]), \
                 patch.object(peer, 'default_pbk_fingerprints', return_value={'default': 'same'}), \
                 patch.object(peer, 'peer_probe', return_value={'source_bound_tcp_connected': True, 'icmp': {'sent': 3, 'received': 3}}):
                result = peer.run_peer(api, '192.0.2.1', '10.71.60.1', 9, ('user', 'secret'), Path(work), on_connected=hook, **kwargs)
                remaining = list(Path(work).iterdir())
            return result, remaining

    def test_success_calls_controller_while_connected_then_only_hangs_up_own_handle(self):
        api = FakeRas()
        seen = []
        def hook(report):
            self.assertTrue(api.active)
            self.assertTrue(report['connected'])
            seen.append(True)
        result, remaining = self.run_fake(api, hook)
        self.assertTrue(result['ok'], result)
        self.assertTrue(result['temporary_book_removed'])
        self.assertEqual(api.closed, [42])
        self.assertTrue(api.wiped)
        self.assertEqual(remaining, [])
        self.assertEqual(seen, [True])
        self.assertNotIn('secret', json.dumps(result))

    def test_failures_after_returned_handle_all_disconnect_and_clean(self):
        for fail, expected in [('start', 'ras_dial_failed'), ('auth', 'ras_authentication_failed'),
                               ('timeout', 'ras_dial_timeout'), ('weak', 'negotiated_security_mismatch'),
                               ('cached', 'password_was_cached')]:
            with self.subTest(fail=fail):
                api = FakeRas(fail)
                result, remaining = self.run_fake(api)
                self.assertFalse(result['ok'])
                self.assertEqual(result['error'], expected)
                self.assertEqual(api.closed, [42])
                self.assertFalse(api.active)
                self.assertEqual(remaining, [])

    def test_partial_create_failure_cleans_without_any_hangup(self):
        api = FakeRas('create')
        result, remaining = self.run_fake(api)
        self.assertFalse(result['ok'])
        self.assertTrue(api.erased)
        self.assertEqual(api.closed, [])
        self.assertEqual(remaining, [])

    def test_controller_exception_is_sanitized_and_cleans(self):
        api = FakeRas()
        def hook(_report):
            raise RuntimeError('must-not-print')
        result, remaining = self.run_fake(api, hook)
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'peer_operation_failed')
        self.assertNotIn('must-not-print', json.dumps(result))
        self.assertEqual(api.closed, [42])
        self.assertEqual(remaining, [])

    def test_unproven_disconnect_keeps_entry_and_never_touches_foreign_handle(self):
        api = FakeRas('hangup')
        result, remaining = self.run_fake(api)
        self.assertFalse(result['ok'])
        self.assertEqual(result['cleanup_error'], 'ras_hangup_timeout')
        self.assertFalse(api.erased)
        self.assertFalse(result['temporary_book_removed'])
        self.assertEqual(api.closed, [42])
        self.assertTrue(remaining)

    def test_original_network_drift_is_failure_but_owned_book_still_removed(self):
        api, changed = FakeRas(), snapshot()
        changed['dns'][0]['ServerAddresses'] = ['198.51.100.1']
        result, remaining = self.run_fake(api, inventory=[snapshot(), snapshot(), changed])
        self.assertFalse(result['ok'])
        self.assertEqual(result['cleanup_error'], 'original_network_not_restored')
        self.assertTrue(result['temporary_book_removed'])
        self.assertEqual(remaining, [])

    def test_unknown_file_and_wrong_owner_are_never_deleted(self):
        with tempfile.TemporaryDirectory(prefix='vpn-peer-owner-test-', dir=ROOT) as work:
            book = peer.OwnedBook(work)
            extra = book.path / 'foreign'
            extra.write_text('do not delete')
            with self.assertRaisesRegex(peer.PeerError, 'temporary_book_unexpected_files'):
                book.cleanup()
            self.assertTrue(extra.exists())
            extra.unlink()
            book.owner.write_text('different owner')
            with self.assertRaisesRegex(peer.PeerError, 'temporary_book_ownership_lost'):
                book.cleanup()
            self.assertTrue(book.pbk.exists())

    def test_probe_rejects_physical_interface_before_any_socket(self):
        before, after = snapshot(), snapshot()
        after['addresses'].append({'InterfaceIndex': 55, 'IPAddress': '10.71.60.10'})
        with patch.object(peer, 'powershell', return_value=[9]), patch.object(peer.socket, 'socket') as sock:
            with self.assertRaisesRegex(peer.PeerError, 'peer_route_not_ras_interface'):
                peer.peer_probe(before, after, {'local_ip': '10.71.60.10'}, '10.71.60.1', 80)
            sock.assert_not_called()

    def test_http_probe_pins_interface_and_source_without_authorization_or_redirect(self):
        before, after = snapshot(), snapshot()
        after['addresses'].append({'InterfaceIndex': 55, 'IPAddress': '10.71.60.10'})
        with patch.object(peer, 'powershell', return_value=[55]), \
             patch.object(peer.socket, 'socket') as factory, \
             patch.object(peer, 'icmp_probe', return_value={'sent': 3, 'received': 3}):
            sock = factory.return_value.__enter__.return_value
            sock.recv.return_value = b'HTTP/1.1 302 Found\r\nLocation: /login\r\n\r\n'
            result = peer.peer_probe(before, after, {'local_ip': '10.71.60.10'}, '10.71.60.1', 80)
            self.assertEqual(result['interface_index'], 55)
            self.assertEqual(result['http_status'], 302)
            self.assertGreater(result['received_bytes'], 0)
            sock.setsockopt.assert_called_once_with(peer.socket.IPPROTO_IP, 31, b'\x00\x00\x00\x37')
            sock.bind.assert_called_once_with(('10.71.60.10', 0))
            sock.connect.assert_called_once_with(('10.71.60.1', 80))
            self.assertNotIn(b'Authorization', sock.sendall.call_args.args[0])
            sock.sendall.assert_called_once()

    def test_icmp_parses_only_fixed_reply_prefix_and_closes_own_handle(self):
        class Fn:
            def __init__(self, call):
                self.call = call
            def __call__(self, *args):
                return self.call(*args)
        class Dll:
            pass
        dll, closed = Dll(), []
        dll.IcmpCreateFile = Fn(lambda: 88)
        dll.IcmpCloseHandle = Fn(lambda h: closed.append(h) or 1)
        def echo(handle, event, callback, context, source, target, payload, size, options, reply, capacity, timeout):
            self.assertEqual(handle, 88)
            self.assertEqual(source, int.from_bytes(bytes([10, 71, 60, 10]), 'little'))
            self.assertIsNone(event)
            self.assertIsNone(callback)
            self.assertGreaterEqual(capacity, 4096)
            peer.struct.pack_into('<IIIH', reply, 0, target, 0, 7, size)
            return 1
        dll.IcmpSendEcho2Ex = Fn(echo)
        result = peer.icmp_probe('10.71.60.10', '10.71.60.1', dll=dll)
        self.assertEqual(result['sent'], 3)
        self.assertEqual(result['received'], 3)
        self.assertEqual(result['round_trip_ms'], [7, 7, 7])
        self.assertEqual(closed, [88])

    def test_l2tp_entry_uses_only_l2tp_psk_and_never_plain_fallback(self):
        entry = peer.make_entry('192.0.2.1', 'WAN Miniport (L2TP)', '192.0.2.53', 'l2tp-ipsec')
        self.assertEqual(entry.dwVpnStrategy, 3)
        self.assertTrue(entry.dwfOptions2 & 0x10)
        self.assertFalse(entry.dwfOptions2 & 0x02000000)
        self.assertEqual(entry.dwEncryptionType, 2)
        with self.assertRaisesRegex(peer.PeerError, 'vpn_protocol_unsupported'):
            peer.make_entry('192.0.2.1', 'WAN Miniport (L2TP)', '192.0.2.53', 'l2tp-plain')

    def test_l2tp_missing_revoke_or_sa_hook_fails_before_inventory_or_book(self):
        with patch.object(peer, 'network_snapshot') as inventory, patch.object(peer, 'OwnedBook') as book:
            with self.assertRaisesRegex(peer.PeerError, 'l2tp_requires_random_key_and_sa_revoke_controller'):
                peer.run_peer(FakeRas(), '192.0.2.1', '10.71.60.1', 9, ('u', 'p'), ROOT,
                              protocol='l2tp-ipsec', preshared_key='a' * 48)
            inventory.assert_not_called()
            book.assert_not_called()

    def l2tp_api(self, fail=None):
        class L2tpRas(FakeRas):
            def __init__(self):
                super().__init__(fail)
                self.events, self.psk = [], False
            def set_psk(self, _pbk, _name, _key):
                self.events.append('set-psk')
                self.psk = True
            def clear_psk(self, _pbk, _name):
                self.events.append('clear-psk')
                if fail == 'psk-clear':
                    raise peer.PeerError('temporary_psk_clear_not_proven')
                self.psk = False
            def projection(self, _handle, protocol):
                self.assert_protocol = protocol
                return {'local_ip': '10.71.60.10', 'peer_ip': '10.71.60.1', 'mschapv2': True,
                        'lcp_local_options': 0, 'lcp_peer_options': 0}
            def hangup(self, handle):
                self.events.append('hangup')
                super().hangup(handle)
            def erase(self, *_args):
                self.events.append('erase-entry')
                super().erase(*_args)
        return L2tpRas()

    def test_l2tp_requires_actual_controller_sa_proof_then_revokes_before_clearing_psk(self):
        api = self.l2tp_api()
        def connected(report):
            self.assertNotIn('mppe128_send', report['projection'])
            api.events.append('sa-proven')
            return True
        def revoked(_report):
            self.assertFalse(api.active)
            self.assertTrue(api.psk)
            api.events.append('router-revoked')
            return True
        result, remaining = self.run_fake(api, connected, protocol='l2tp-ipsec',
                    preshared_key='a' * 48, on_disconnected=revoked)
        self.assertTrue(result['ok'], result)
        self.assertTrue(result['router_ipsec_sa_proven'])
        self.assertTrue(result['router_test_key_revoked'])
        self.assertTrue(result['psk_cleared'])
        self.assertEqual(api.events, ['set-psk', 'sa-proven', 'hangup', 'router-revoked', 'clear-psk', 'erase-entry'])
        self.assertNotIn('a' * 48, json.dumps(result))
        self.assertEqual(remaining, [])

    def test_l2tp_absent_sa_proof_rejects_pass_and_still_revokes_cleans(self):
        api = self.l2tp_api()
        result, remaining = self.run_fake(api, lambda _r: None, protocol='l2tp-ipsec',
                    preshared_key='a' * 48, on_disconnected=lambda _r: True)
        self.assertFalse(result['ok'])
        self.assertEqual(result['error'], 'router_ipsec_sa_not_proven')
        self.assertTrue(result['disconnected'])
        self.assertTrue(result['psk_cleared'])
        self.assertEqual(remaining, [])

    def test_l2tp_revocation_failure_is_not_pass_but_local_secret_is_cleared(self):
        api = self.l2tp_api()
        def revoke(_report):
            raise RuntimeError('private material must not escape')
        result, remaining = self.run_fake(api, lambda _r: True, protocol='l2tp-ipsec',
                    preshared_key='a' * 48, on_disconnected=revoke)
        self.assertFalse(result['ok'])
        self.assertEqual(result['revocation_error'], 'router_test_key_revocation_not_proven')
        self.assertTrue(result['psk_cleared'])
        self.assertTrue(result['temporary_book_removed'])
        self.assertNotIn('private material', json.dumps(result))
        self.assertEqual(remaining, [])

    def test_l2tp_unproven_psk_clear_keeps_owned_book_for_recovery(self):
        api = self.l2tp_api('psk-clear')
        result, remaining = self.run_fake(api, lambda _r: True, protocol='l2tp-ipsec',
                    preshared_key='a' * 48, on_disconnected=lambda _r: True)
        self.assertFalse(result['ok'])
        self.assertEqual(result['cleanup_error'], 'temporary_psk_clear_not_proven')
        self.assertFalse(api.erased)
        self.assertFalse(result['temporary_book_removed'])
        self.assertTrue(remaining)

    def test_native_psk_set_clear_use_separate_mask16_and_verify_presence(self):
        class Fn:
            def __init__(self, fn):
                self.fn = fn
            def __call__(self, *args):
                return self.fn(*args)
        class Dll:
            pass
        api = object.__new__(peer.RasApi)
        api.dll, present, calls = Dll(), [False], []
        def get(_pbk, _name, ptr):
            row = peer.C.cast(ptr, peer.C.POINTER(peer.RASCREDENTIALSW)).contents
            self.assertEqual(row.dwMask, 0x10)
            row.dwMask = 0x10 if present[0] else 0
            row.szPassword = 'opaque-handle' if present[0] else ''
            return 0
        def set_(_pbk, _name, ptr, clear):
            row = peer.C.cast(ptr, peer.C.POINTER(peer.RASCREDENTIALSW)).contents
            self.assertEqual(row.dwMask, 0x10)
            self.assertEqual(row.szUserName, '')
            self.assertEqual(row.szDomain, '')
            calls.append(bool(clear))
            present[0] = not clear
            return 0
        api.dll.RasGetCredentialsW = Fn(get)
        api.dll.RasSetCredentialsW = Fn(set_)
        api.set_psk(Path('private.pbk'), 'unique-entry', 'a' * 48)
        self.assertTrue(api.has_psk(Path('private.pbk'), 'unique-entry'))
        api.clear_psk(Path('private.pbk'), 'unique-entry')
        self.assertFalse(api.has_psk(Path('private.pbk'), 'unique-entry'))
        self.assertEqual(calls, [False, True])


if __name__ == '__main__':
    unittest.main()
