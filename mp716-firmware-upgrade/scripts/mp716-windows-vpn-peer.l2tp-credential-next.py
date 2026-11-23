#!/usr/bin/env python3
"""Temporary Windows RAS peer; no default PBK or global security-policy writes.

Read-only: python scripts/mp716-windows-vpn-peer.py preflight
Authorized dial: ... run --server 192.168.199.1 --peer-ip 10.71.60.1
  --control-ifindex 9 --credentials-stdin
stdin is one JSON object containing username/password (never command-line secrets).
Without --credentials-stdin both values are prompted using getpass.

The CLI provides PPTP. The imported run_peer() also supports protocol='l2tp-ipsec'
with a random test preshared_key and a mandatory on_disconnected callback that
revokes the test key on the router before local credential cleanup. That mode
temporarily stores only its own entry's PSK through official RAS credential APIs;
it requires controller-side proof of real XFRM SAs. Plain L2TP is unsupported.
The L2TP branch persists a private baseline and fresh phonebook owner/inode/nonce
digests before RAS writes. A nonzero initial PSK GET remains unknown; only this
proven new empty private entry permits diagnostic SET, followed by successful GET
with exactly the PSK mask. Cleanup uses clear16/7, delete, and explicit private
enumeration; a failed router revocation never prevents local cleanup attempts or
becomes a success. Password-cache GET errors still fail closed. This separate
L2TP test may explicitly enable only the automatic 192.168.240.0/24 class route
after a complete prefix-conflict check. Four exact RAS routes and an optional
known transport host route must match; no route API is called. Interface-bound
HTTP fallback requires socket readbacks/endpoints, source ICMP, and exactly True
from independent controller PPP/ESP proof. Native L2TP MSCHAPv2 is the default.
Imported L2TP callers alone may set allow_l2tp_server_auth_attestation=True with
authentication_validator(report) to request server attestation for the one
observed LCP tuple, after typed fresh-entry/PSK/cache evidence and strict
preservation. The validator must return exactly True before probes.
Raw mschapv2=False is retained; the resulting evidence basis is recorded apart.
The separately explicit allow_l2tp_observed_postprojection_mask option admits
only the observed 0x80000000 returned mask in that same attestation scope. It is
recorded as unknown, never as no-password-cache proof or a named SDK flag. The
opaque credential content is never read. All private-entry cleanup still runs.
An imported PPTP controller may supply authentication_validator(report). Only the
observed zero-local/MSCHAPv2-server LCP result can request independent server-side
proof, after strict entry readback and MPPE128 in both directions. Its return
must be exactly True. Raw RAS authentication fields and mschapv2 remain intact.
PPTP, and this explicitly scoped L2TP class-route test, may opt into an interface-
bound HTTP probe when its route query fails or disagrees. Both readbacks/endpoints
must match, and the controller must then return exactly True for its independent
PPP data proof. Defaults and L2TP still require the original route query.
RasHangUp only receives the handle returned by this process's RasDial. Keep the
process alive through its bounded cleanup; force-killing it bypasses finally.

Definitions: Microsoft SDK 10.0.26100.0 um/Ras.h, pack(4), WINVER=0x0A00.
Sizes/offsets cross-checked against that header with Clang's record-layout dump.
https://learn.microsoft.com/en-us/windows/win32/api/ras/nf-ras-rasdialw
https://learn.microsoft.com/en-us/windows/win32/api/ras/nf-ras-rassetentrypropertiesw
https://learn.microsoft.com/en-us/windows/win32/api/ras/nf-ras-rashangupw
https://learn.microsoft.com/en-us/previous-versions/windows/desktop/legacy/aa377274(v=vs.85)
"""
import argparse
from collections import Counter
import ctypes as C
import getpass
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
CLASS_TEST_SUBNET = '192.168.240.0/24'
CLASS_TEST_PEER = '192.168.240.1'
CLASS_TEST_LOCALS = {'192.168.240.10', '192.168.240.11'}
D = C.c_uint32
W = C.c_wchar
P = C.c_void_p
ERROR_BUFFER_TOO_SMALL = 603
ERROR_INVALID_HANDLE = 6
ERROR_CANNOT_FIND_PHONEBOOK_ENTRY = 623
RASCS_CONNECTED = 0x2000
RASCS_DISCONNECTED = 0x2001
RASCM_PASSWORD = 2
RASCM_PRESHARED_KEY = 0x10  # Must be used alone; never Default/Server/DDM flags.
RASNP_IP = 4
RASFP_PPP = 1
RASET_VPN = 2
VS_PPTP_ONLY = 1
ET_REQUIRE_MAX = 2
RASEO_REQUIRE_MSCHAP2 = 0x20000000
RASEO_SPECIFIC_NAME_SERVERS = 4
RASEO2_SAFE = 0x00000001 | 0x00000002 | 0x00000004 | 0x00000008 | 0x00000040 | 0x00080000 | 0x00010000
RDEOPT_SAFE = 0x40 | 0x80 | 0x100


class Packed(C.Structure):
    _pack_ = 4


class GUID(Packed):
    _fields_ = [('a', D), ('b', C.c_uint16), ('c', C.c_uint16), ('d', C.c_ubyte * 8)]


class IP4(Packed):
    _fields_ = [('octets', C.c_ubyte * 4)]


class RASENTRYW(Packed):
    _fields_ = [(x, D) for x in ['dwSize', 'dwfOptions', 'dwCountryID', 'dwCountryCode']] + [
        ('szAreaCode', W * 11), ('szLocalPhoneNumber', W * 129), ('dwAlternateOffset', D)
    ] + [(x, IP4) for x in ['ipaddr', 'ipaddrDns', 'ipaddrDnsAlt', 'ipaddrWins', 'ipaddrWinsAlt']] + [
        (x, D) for x in ['dwFrameSize', 'dwfNetProtocols', 'dwFramingProtocol']
    ] + [(x, W * 260) for x in ['szScript', 'szAutodialDll', 'szAutodialFunc']] + [
        ('szDeviceType', W * 17), ('szDeviceName', W * 129), ('szX25PadType', W * 33)
    ] + [(x, W * 201) for x in ['szX25Address', 'szX25Facilities', 'szX25UserData']] + [
        (x, D) for x in ['dwChannels', 'dwReserved1', 'dwReserved2', 'dwSubEntries', 'dwDialMode',
                         'dwDialExtraPercent', 'dwDialExtraSampleSeconds', 'dwHangUpExtraPercent',
                         'dwHangUpExtraSampleSeconds', 'dwIdleDisconnectSeconds', 'dwType',
                         'dwEncryptionType', 'dwCustomAuthKey']
    ] + [('guidId', GUID), ('szCustomDialDll', W * 260)] + [
        (x, D) for x in ['dwVpnStrategy', 'dwfOptions2', 'dwfOptions3']
    ] + [('szDnsSuffix', W * 256), ('dwTcpWindowSize', D), ('szPrerequisitePbk', W * 260),
         ('szPrerequisiteEntry', W * 257), ('dwRedialCount', D), ('dwRedialPause', D),
         ('ipv6addrDns', C.c_ubyte * 16), ('ipv6addrDnsAlt', C.c_ubyte * 16),
         ('dwIPv4InterfaceMetric', D), ('dwIPv6InterfaceMetric', D), ('ipv6addr', C.c_ubyte * 16),
         ('dwIPv6PrefixLength', D), ('dwNetworkOutageTime', D), ('szIDi', W * 257),
         ('szIDr', W * 257), ('fIsImsConfig', D), ('IdiType', D), ('IdrType', D),
         ('fDisableIKEv2Fragmentation', D)]


class RASDIALPARAMSW(Packed):
    _fields_ = [('dwSize', D), ('szEntryName', W * 257), ('szPhoneNumber', W * 129),
                ('szCallbackNumber', W * 129), ('szUserName', W * 257), ('szPassword', W * 257),
                ('szDomain', W * 16), ('dwSubEntry', D), ('dwCallbackId', C.c_size_t),
                ('dwIfIndex', D), ('szEncPassword', P)]


class Blob(Packed):
    _fields_ = [('size', D), ('data', P)]


class RASDIALEXTENSIONS(Packed):
    _fields_ = [('dwSize', D), ('dwfOptions', D), ('hwndParent', P), ('reserved', C.c_size_t),
                ('reserved1', C.c_size_t), ('RasEapInfo', Blob), ('fSkipPppAuth', D),
                ('RasDevSpecificInfo', Blob)]


class RASDEVINFOW(Packed):
    _fields_ = [('dwSize', D), ('szDeviceType', W * 17), ('szDeviceName', W * 129)]


class RASCONNW(Packed):
    _fields_ = [('dwSize', D), ('hrasconn', P), ('szEntryName', W * 257),
                ('szDeviceType', W * 17), ('szDeviceName', W * 129), ('szPhonebook', W * 260),
                ('dwSubEntry', D), ('guidEntry', GUID), ('dwFlags', D), ('luid', D * 2),
                ('guidCorrelationId', GUID)]


class RASENTRYNAMEW(Packed):
    _fields_ = [('dwSize', D), ('szEntryName', W * 257), ('dwFlags', D), ('szPhonebookPath', W * 261)]


class RASCONNSTATUSW(Packed):
    _fields_ = [('dwSize', D), ('rasconnstate', D), ('dwError', D), ('szDeviceType', W * 17),
                ('szDeviceName', W * 129), ('szPhoneNumber', W * 129),
                ('localEndPoint', D * 5), ('remoteEndPoint', D * 5), ('rasconnsubstate', D)]


class RASPPPIPW(Packed):
    _fields_ = [('dwSize', D), ('dwError', D), ('szIpAddress', W * 16),
                ('szServerIpAddress', W * 16), ('dwOptions', D), ('dwServerOptions', D)]


class RASPPPLCPW(Packed):
    _fields_ = [(x, D) for x in ['dwSize', 'fBundled', 'dwError', 'dwAuthenticationProtocol',
        'dwAuthenticationData', 'dwEapTypeId', 'dwServerAuthenticationProtocol',
        'dwServerAuthenticationData', 'dwServerEapTypeId', 'fMultilink',
        'dwTerminateReason', 'dwServerTerminateReason']] + [
        ('szReplyMessage', W * 1024), ('dwOptions', D), ('dwServerOptions', D)]


class RASPPPCCP(Packed):
    _fields_ = [(x, D) for x in ['dwSize', 'dwError', 'dwCompressionAlgorithm', 'dwOptions',
                                'dwServerCompressionAlgorithm', 'dwServerOptions']]


class RASCREDENTIALSW(Packed):
    _fields_ = [('dwSize', D), ('dwMask', D), ('szUserName', W * 257),
                ('szPassword', W * 257), ('szDomain', W * 16)]


class PeerError(Exception):
    """A fixed public code, never configuration/credential content."""
    def __init__(self, code, ras_error=None):
        self.code, self.ras_error = code, ras_error
        super().__init__(code)


def sized(cls):
    row = cls()
    row.dwSize = C.sizeof(cls)
    return row


def check_abi():
    if os.name != 'nt' or C.sizeof(P) != 8 or C.sizeof(W) != 2:
        raise PeerError('windows_x64_required')
    expected = {RASENTRYW: 6724, RASDIALPARAMSW: 2120, RASDIALEXTENSIONS: 60,
                RASDEVINFOW: 296, RASCONNW: 1388, RASCONNSTATUSW: 608,
                RASPPPIPW: 80, RASPPPLCPW: 2104, RASPPPCCP: 24, RASCREDENTIALSW: 1068,
                RASENTRYNAMEW: 1048}
    if any(C.sizeof(k) != v for k, v in expected.items()):
        raise PeerError('ras_abi_mismatch')


def check_rc(code, operation):
    if code:
        raise PeerError(operation, int(code))


def make_entry(server, device, dns, protocol='pptp', allow_class_based_test_route=False):
    if type(allow_class_based_test_route) is not bool or (allow_class_based_test_route and protocol != 'l2tp-ipsec'):
        raise PeerError('class_route_requires_explicit_l2tp_test')
    if protocol not in ('pptp', 'l2tp-ipsec'):
        raise PeerError('vpn_protocol_unsupported')
    ipaddress.IPv4Address(server)
    ipaddress.IPv4Address(dns)
    entry = sized(RASENTRYW)
    entry.szLocalPhoneNumber, entry.szDeviceType, entry.szDeviceName = server, 'vpn', device
    entry.dwfOptions = RASEO_REQUIRE_MSCHAP2 | RASEO_SPECIFIC_NAME_SERVERS
    entry.dwfOptions2 = RASEO2_SAFE | (0x10 if protocol == 'l2tp-ipsec' else 0)
    if allow_class_based_test_route:
        entry.dwfOptions2 &= ~0x80000
    entry.ipaddrDns.octets[:] = ipaddress.IPv4Address(dns).packed
    entry.dwfNetProtocols, entry.dwFramingProtocol = RASNP_IP, RASFP_PPP
    entry.dwType, entry.dwEncryptionType = RASET_VPN, ET_REQUIRE_MAX
    entry.dwVpnStrategy = VS_PPTP_ONLY if protocol == 'pptp' else 3  # SDK VS_L2tpOnly.
    entry.dwIPv4InterfaceMetric = 9999
    return entry


def validate_entry_readback(expected, actual):
    # The authorized local no-dial diagnostic observed Windows adding only
    # RequireEncryptedPw/MsEncryptedPw/DataEncryption/SecureLocalFiles summary
    # bits. Modern auth selectors remain MSCHAPv2 only. Accept that specific
    # normalization without relaxing any other bit or dropping requested bits.
    summary_bits = 0x00011C00
    modern_auth_selectors = 0x780E0000  # CHAP/MSCHAP/MSCHAP2/W95/EAP/PAP/SPAP.
    added = actual.dwfOptions & ~expected.dwfOptions
    removed = expected.dwfOptions & ~actual.dwfOptions
    exact_numbers = ['dwfOptions2', 'dwfOptions3', 'dwfNetProtocols', 'dwFramingProtocol',
        'dwType', 'dwEncryptionType', 'dwVpnStrategy', 'dwIPv4InterfaceMetric', 'dwIPv6InterfaceMetric',
        'dwCustomAuthKey', 'dwDialMode', 'dwRedialCount', 'dwRedialPause', 'dwIdleDisconnectSeconds']
    exact_text = ['szLocalPhoneNumber', 'szDeviceType', 'szDeviceName', 'szDnsSuffix', 'szScript',
        'szAutodialDll', 'szAutodialFunc', 'szCustomDialDll', 'szPrerequisitePbk', 'szPrerequisiteEntry']
    exact_addresses = ['ipaddr', 'ipaddrDns', 'ipaddrDnsAlt', 'ipaddrWins', 'ipaddrWinsAlt',
                       'ipv6addrDns', 'ipv6addrDnsAlt', 'ipv6addr']
    if (removed or added & ~summary_bits
        or actual.dwfOptions & modern_auth_selectors != RASEO_REQUIRE_MSCHAP2
        or any(getattr(actual, key) != getattr(expected, key) for key in exact_numbers + exact_text)
        or any(bytes(getattr(actual, key)) != bytes(getattr(expected, key)) for key in exact_addresses)
        or actual.dwSubEntries not in (expected.dwSubEntries, 1)):
        raise PeerError('entry_safety_readback_mismatch')


class RasApi:
    def __init__(self):
        check_abi()
        self.dll = C.WinDLL('rasapi32.dll', use_last_error=True)
        for name, args in {
            'RasEnumDevicesW': [P, C.POINTER(D), C.POINTER(D)],
            'RasEnumConnectionsW': [P, C.POINTER(D), C.POINTER(D)],
            'RasEnumEntriesW': [C.c_wchar_p, C.c_wchar_p, P, C.POINTER(D), C.POINTER(D)],
            'RasValidateEntryNameW': [C.c_wchar_p, C.c_wchar_p],
            'RasSetEntryPropertiesW': [C.c_wchar_p, C.c_wchar_p, P, D, P, D],
            'RasGetEntryPropertiesW': [C.c_wchar_p, C.c_wchar_p, P, C.POINTER(D), P, P],
            'RasDialW': [P, C.c_wchar_p, P, D, P, C.POINTER(P)],
            'RasGetConnectStatusW': [P, P], 'RasHangUpW': [P],
            'RasGetProjectionInfoW': [P, D, P, C.POINTER(D)],
            'RasGetCredentialsW': [C.c_wchar_p, C.c_wchar_p, P],
            'RasSetCredentialsW': [C.c_wchar_p, C.c_wchar_p, P, D],
            'RasDeleteEntryW': [C.c_wchar_p, C.c_wchar_p],
        }.items():
            fn = getattr(self.dll, name)
            fn.argtypes, fn.restype = args, D

    def enum(self, name, cls, prefix=()):
        capacity = 1
        for _ in range(5):
            buf = (cls * capacity)()
            for row in buf:
                row.dwSize = C.sizeof(cls)
            size, count = D(C.sizeof(buf)), D()
            rc = getattr(self.dll, name)(*prefix, buf, C.byref(size), C.byref(count))
            if rc == ERROR_BUFFER_TOO_SMALL:
                capacity = max(capacity + 1, (size.value + C.sizeof(cls) - 1) // C.sizeof(cls))
                continue
            check_rc(rc, 'ras_enumeration_failed')
            if count.value > capacity:
                raise PeerError('ras_enumeration_size_invalid')
            return list(buf[:count.value])
        raise PeerError('ras_enumeration_unstable')

    def devices(self):
        return [(r.szDeviceType, r.szDeviceName) for r in self.enum('RasEnumDevicesW', RASDEVINFOW)]

    def connections(self):
        return [(r.hrasconn, r.szPhonebook, r.szEntryName) for r in self.enum('RasEnumConnectionsW', RASCONNW)]

    def profiles(self):
        # NULL is used only for this read-only enumeration of existing default
        # profiles. Every create/dial/credential/delete call uses our own PBK.
        return sorted((r.szPhonebookPath, r.szEntryName, int(r.dwFlags))
                      for r in self.enum('RasEnumEntriesW', RASENTRYNAMEW, (None, None)))

    def create(self, pbk, name, entry):
        check_rc(self.dll.RasValidateEntryNameW(str(pbk), name), 'entry_validation_failed')
        check_rc(self.dll.RasSetEntryPropertiesW(str(pbk), name, C.byref(entry), C.sizeof(entry), None, 0), 'entry_creation_failed')
        actual, size = sized(RASENTRYW), D(C.sizeof(RASENTRYW))
        check_rc(self.dll.RasGetEntryPropertiesW(str(pbk), name, C.byref(actual), C.byref(size), None, None), 'entry_readback_failed')
        validate_entry_readback(entry, actual)
        return True  # Explicit proof consumed only by independent PPTP attestation.

    def cached_password(self, pbk, name):
        row = sized(RASCREDENTIALSW)
        row.dwMask = RASCM_PASSWORD
        try:
            check_rc(self.dll.RasGetCredentialsW(str(pbk), name, C.byref(row)), 'credential_check_failed')
            return bool(row.dwMask & RASCM_PASSWORD)
        finally:
            C.memset(C.byref(row), 0, C.sizeof(row))

    def has_psk(self, pbk, name):
        row = sized(RASCREDENTIALSW)
        row.dwMask = RASCM_PRESHARED_KEY
        try:
            check_rc(self.dll.RasGetCredentialsW(str(pbk), name, C.byref(row)), 'psk_presence_check_failed')
            return bool(row.dwMask & RASCM_PRESHARED_KEY)
        finally:
            C.memset(C.byref(row), 0, C.sizeof(row))

    def set_psk(self, pbk, name, key):
        if self.has_psk(pbk, name):
            raise PeerError('unexpected_existing_psk')
        row = sized(RASCREDENTIALSW)
        row.dwMask, row.szPassword = RASCM_PRESHARED_KEY, key
        try:
            check_rc(self.dll.RasSetCredentialsW(str(pbk), name, C.byref(row), False), 'temporary_psk_store_failed')
        finally:
            C.memset(C.byref(row), 0, C.sizeof(row))
        if not self.has_psk(pbk, name):
            raise PeerError('temporary_psk_store_not_proven')

    def clear_psk(self, pbk, name):
        row = sized(RASCREDENTIALSW)
        row.dwMask = RASCM_PRESHARED_KEY
        try:
            rc = self.dll.RasSetCredentialsW(str(pbk), name, C.byref(row), True)
            if rc == ERROR_CANNOT_FIND_PHONEBOOK_ENTRY:
                return
            check_rc(rc, 'temporary_psk_clear_failed')
        finally:
            C.memset(C.byref(row), 0, C.sizeof(row))
        if self.has_psk(pbk, name):
            raise PeerError('temporary_psk_clear_not_proven')

    def start(self, pbk, name, credentials, handle):
        self.params, self.ext = sized(RASDIALPARAMSW), sized(RASDIALEXTENSIONS)
        self.params.szEntryName = name
        self.params.szUserName, self.params.szPassword = credentials
        self.ext.dwfOptions = RDEOPT_SAFE
        self.done, self.dial_error, self.dial_state = threading.Event(), 0, None
        callback_type = C.WINFUNCTYPE(None, P, D, D, D, D)
        def notify(_handle, _message, state, error, _extended):
            self.dial_state, self.dial_error = int(state), int(error)
            if error or state >= 0x1000:
                self.done.set()
        self.callback = callback_type(notify)
        check_rc(self.dll.RasDialW(C.byref(self.ext), str(pbk), C.byref(self.params), 1,
                                  C.cast(self.callback, P), C.byref(handle)), 'ras_dial_failed')

    def wait(self, timeout):
        if not self.done.wait(timeout):
            raise PeerError('ras_dial_timeout')
        check_rc(self.dial_error, 'ras_authentication_failed')
        if self.dial_state != RASCS_CONNECTED:
            raise PeerError('ras_not_connected')

    def projection(self, handle, protocol='pptp'):
        rows = []
        protocols = [(0x8021, RASPPPIPW), (0xC021, RASPPPLCPW)]
        if protocol == 'pptp':
            protocols.append((0x80FD, RASPPPCCP))
        for projection_type, cls in protocols:
            row, size = sized(cls), D(C.sizeof(cls))
            check_rc(self.dll.RasGetProjectionInfoW(handle, projection_type, C.byref(row), C.byref(size)), 'ras_projection_failed')
            check_rc(row.dwError, 'ras_projection_protocol_failed')
            rows.append(row)
        ip, lcp = rows[:2]
        # Client authentication is dwAuthentication*, not server mutual-auth fields.
        result = {'local_ip': ip.szIpAddress, 'peer_ip': ip.szServerIpAddress,
                  'mschapv2': lcp.dwAuthenticationProtocol == 0xC223 and lcp.dwAuthenticationData == 0x81,
                  'lcp_authentication_protocol': int(lcp.dwAuthenticationProtocol),
                  'lcp_authentication_data': int(lcp.dwAuthenticationData),
                  'lcp_eap_type_id': int(lcp.dwEapTypeId),
                  'lcp_server_authentication_protocol': int(lcp.dwServerAuthenticationProtocol),
                  'lcp_server_authentication_data': int(lcp.dwServerAuthenticationData),
                  'lcp_server_eap_type_id': int(lcp.dwServerEapTypeId),
                  'lcp_local_options': int(lcp.dwOptions),
                  'lcp_peer_options': int(lcp.dwServerOptions)}
        if protocol == 'pptp':
            result.update(mppe128_send=bool(rows[2].dwOptions & 0x40),
                          mppe128_receive=bool(rows[2].dwServerOptions & 0x40))
        # Numeric LCP diagnostics establish neither successful authentication
        # nor IPsec; existing security checks and controller SA proof still apply.
        return result

    def hangup(self, handle, timeout=15):
        if not handle.value:
            return
        rc = self.dll.RasHangUpW(handle)
        if rc == ERROR_INVALID_HANDLE:
            return
        check_rc(rc, 'ras_hangup_failed')
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            row = sized(RASCONNSTATUSW)
            rc = self.dll.RasGetConnectStatusW(handle, C.byref(row))
            if rc == ERROR_INVALID_HANDLE:
                return
            check_rc(rc, 'ras_hangup_status_failed')
            time.sleep(0.1)
        raise PeerError('ras_hangup_timeout')

    def erase(self, pbk, name):
        row = sized(RASCREDENTIALSW)
        row.dwMask = 7
        rc = self.dll.RasSetCredentialsW(str(pbk), name, C.byref(row), True)
        if rc not in (0, ERROR_CANNOT_FIND_PHONEBOOK_ENTRY):
            raise PeerError('credential_clear_failed', rc)
        if rc == 0 and self.cached_password(pbk, name):
            raise PeerError('credential_clear_not_proven')
        rc = self.dll.RasDeleteEntryW(str(pbk), name)
        if rc not in (0, ERROR_CANNOT_FIND_PHONEBOOK_ENTRY, 123):
            raise PeerError('entry_delete_failed', rc)

    def wipe(self):
        if hasattr(self, 'params'):
            C.memset(C.byref(self.params), 0, C.sizeof(self.params))


def powershell(code):
    executable = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    proc = subprocess.run([str(executable), '-NoProfile', '-NonInteractive', '-Command',
                           "$ErrorActionPreference='Stop';" + code], capture_output=True,
                          encoding='utf-8', timeout=25)
    if proc.returncode:
        raise PeerError('network_inventory_failed')
    try:
        return json.loads(proc.stdout.lstrip('\ufeff'))
    except (ValueError, TypeError):
        raise PeerError('network_inventory_invalid') from None


def network_snapshot():
    # No MAC/SSID, lease timers, traffic counters, or other volatile/secret fields.
    return powershell(r"""
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$x=[ordered]@{
 adapters=@(Get-NetAdapter -IncludeHidden | Select-Object ifIndex,InterfaceGuid,Status,AdminStatus)
 interfaces=@(Get-NetIPInterface | Select-Object InterfaceIndex,AddressFamily,ConnectionState,NlMtu,InterfaceMetric,Dhcp,Forwarding)
 addresses=@(Get-NetIPAddress | Select-Object InterfaceIndex,AddressFamily,IPAddress,PrefixLength,PrefixOrigin,SuffixOrigin,SkipAsSource)
 dns=@(Get-DnsClientServerAddress | Select-Object InterfaceIndex,AddressFamily,ServerAddresses)
 dnsGlobal=(Get-DnsClientGlobalSetting | Select-Object SuffixSearchList,UseDevolution,DevolutionLevel)
 routes=@(Get-NetRoute -PolicyStore ActiveStore | Select-Object InterfaceIndex,AddressFamily,DestinationPrefix,NextHop,RouteMetric,Protocol)
}
$x | ConvertTo-Json -Depth 7 -Compress
""")


def rows(value):
    return [] if value is None else value if isinstance(value, list) else [value]


def canonical(value):
    return sorted(json.dumps(r, sort_keys=True, separators=(',', ':')) for r in rows(value))


def preservation(before, after, active=False):
    original_interfaces = {r['InterfaceIndex'] for r in rows(before['interfaces'])}
    result = {}
    for key in ['adapters', 'interfaces', 'addresses', 'dns', 'routes']:
        a, b = rows(before[key]), rows(after[key])
        if active:
            field = 'ifIndex' if key == 'adapters' else 'InterfaceIndex'
            # Include hidden adapters and other preexisting collection rows
            # even when they have no NetIPInterface entry. Existing IP indices
            # remain protected, so routes gain no additional exemption.
            original = original_interfaces | {r[field] for r in a}
            b = [r for r in b if r[field] in original]
        result[key + '_unchanged'] = canonical(a) == canonical(b)
    result['dns_global_unchanged'] = before['dnsGlobal'] == after['dnsGlobal']
    result['default_routes_unchanged'] = canonical([r for r in rows(before['routes']) if r['DestinationPrefix'] in ('0.0.0.0/0', '::/0')]) == canonical([r for r in rows(after['routes']) if r['DestinationPrefix'] in ('0.0.0.0/0', '::/0')])
    return result


NETWORK_FIELDS = {
    'adapters': ('ifIndex', 'InterfaceGuid', 'Status', 'AdminStatus'),
    'interfaces': ('InterfaceIndex', 'AddressFamily', 'ConnectionState', 'NlMtu', 'InterfaceMetric', 'Dhcp', 'Forwarding'),
    'addresses': ('InterfaceIndex', 'AddressFamily', 'IPAddress', 'PrefixLength', 'PrefixOrigin', 'SuffixOrigin', 'SkipAsSource'),
    'dns': ('InterfaceIndex', 'AddressFamily', 'ServerAddresses'),
    'dnsGlobal': ('SuffixSearchList', 'UseDevolution', 'DevolutionLevel'),
    'routes': ('InterfaceIndex', 'AddressFamily', 'DestinationPrefix', 'NextHop', 'RouteMetric', 'Protocol'),
}


def network_differences(before, after):
    """Actual snapshot differences, with at most 32 whitelisted rows per key."""
    result = {}
    for key, fields in NETWORK_FIELDS.items():
        a, b = [Counter(canonical([{f: row[f] for f in fields if f in row} for row in rows(value[key])]))
                for value in (before, after)]
        removed, added = sorted((a - b).elements()), sorted((b - a).elements())
        removed_limit = min(len(removed), 16 if added else 32)
        added_limit = min(len(added), 32 - removed_limit)
        removed_limit = min(len(removed), 32 - added_limit)
        result[key] = {'before_only': [json.loads(row) for row in removed[:removed_limit]],
                       'after_only': [json.loads(row) for row in added[:added_limit]],
                       'before_only_count': len(removed), 'after_only_count': len(added),
                       'truncated': len(removed) + len(added) > removed_limit + added_limit}
    return result


def outer_server_preflight(before, server, control_ifindex):
    """Prove the transport server was already on-link before any RAS entry."""
    try:
        if type(control_ifindex) is not int or control_ifindex <= 0:
            return {'verified': False, 'reason': 'control_interface_invalid'}
        address = ipaddress.IPv4Address(server)
        host_prefix = str(address) + '/32'
        if any(row.get('DestinationPrefix') == host_prefix for row in rows(before['routes'])):
            return {'verified': False, 'reason': 'baseline_server_host_route_present'}
        candidates = []
        for row in rows(before['addresses']):
            if row.get('InterfaceIndex') != control_ifindex or row.get('AddressFamily') != 2:
                continue
            if type(row.get('PrefixLength')) is not int or not 1 <= row['PrefixLength'] <= 30:
                continue
            if row.get('SkipAsSource') is not False:
                continue
            local = ipaddress.IPv4Address(row['IPAddress'])
            network = ipaddress.IPv4Network((local, row['PrefixLength']), strict=False)
            if address in network and address not in (local, network.network_address, network.broadcast_address):
                candidates.append((str(local), row['PrefixLength'], network))
        if len(candidates) != 1:
            return {'verified': False, 'reason': 'control_subnet_not_unique'}
        local, prefix_length, network = candidates[0]
        matches = []
        for row in rows(before['routes']):
            if row.get('AddressFamily') != 2:
                continue
            route_network = ipaddress.IPv4Network(row['DestinationPrefix'], strict=True)
            if address in route_network:
                matches.append((route_network.prefixlen, row))
        best = [row for prefix, row in matches if prefix == max((item[0] for item in matches), default=-1)]
        if (len(best) != 1 or best[0].get('InterfaceIndex') != control_ifindex
            or best[0].get('NextHop') != '0.0.0.0' or best[0].get('DestinationPrefix') != str(network)):
            return {'verified': False, 'reason': 'baseline_best_route_not_unique_control_onlink'}
        if any(type(best[0].get(key)) is not int for key in ('InterfaceIndex', 'AddressFamily', 'RouteMetric', 'Protocol')):
            return {'verified': False, 'reason': 'baseline_onlink_route_types_invalid'}
        return {'verified': True, 'server_ipv4': str(address), 'control_interface_index': control_ifindex,
                'control_ipv4_address': local, 'control_ipv4_prefix_length': prefix_length,
                'control_network': str(network), 'baseline_onlink_route': {k: best[0][k] for k in NETWORK_FIELDS['routes']},
                'baseline_server_host_route_absent': True}
    except (KeyError, TypeError, ValueError):
        return {'verified': False, 'reason': 'baseline_onlink_evidence_invalid'}


def automatic_outer_host_route_proof(before, during, projection, server, control_ifindex, preflight):
    """Recognize only the observed automatic RAS outer route; never edit routes."""
    if preflight.get('verified') is not True or outer_server_preflight(before, server, control_ifindex) != preflight:
        return None
    checks = preservation(before, during, active=True)
    if checks.get('routes_unchanged') is not False or any(value is not True for key, value in checks.items() if key != 'routes_unchanged'):
        return None
    original = {row['InterfaceIndex'] for row in rows(before['interfaces'])}
    for key in ('adapters', 'addresses', 'dns', 'routes'):
        field = 'ifIndex' if key == 'adapters' else 'InterfaceIndex'
        original.update(row[field] for row in rows(before[key]))
    local = projection.get('local_ip')
    try:
        local_address = ipaddress.IPv4Address(local)
        if local_address.is_unspecified or local_address.is_multicast:
            return None
    except (TypeError, ValueError):
        return None
    if any(row.get('IPAddress') == local for row in rows(before['addresses'])):
        return None
    local_rows = [row for row in rows(during['addresses']) if row.get('IPAddress') == local and row.get('AddressFamily') == 2]
    if len(local_rows) != 1:
        return None
    ras_index = local_rows[0].get('InterfaceIndex')
    if type(ras_index) is not int or ras_index <= 0 or ras_index in original:
        return None
    for key in ('adapters', 'interfaces', 'addresses', 'dns', 'routes'):
        field = 'ifIndex' if key == 'adapters' else 'InterfaceIndex'
        if any(row[field] not in original and row[field] != ras_index for row in rows(during[key])):
            return None
    if len([row for row in rows(during['interfaces']) if row.get('InterfaceIndex') == ras_index and row.get('AddressFamily') == 2]) != 1:
        return None
    expected = {'InterfaceIndex': control_ifindex, 'AddressFamily': 2, 'DestinationPrefix': server + '/32',
                'NextHop': '0.0.0.0', 'RouteMetric': 1, 'Protocol': 3}
    a, b = Counter(canonical(before['routes'])), Counter(canonical(during['routes']))
    if a - b:
        return None
    added = [json.loads(row) for row in (b - a).elements()]
    existing_added = [row for row in added if row.get('InterfaceIndex') in original]
    if existing_added != [expected] or any(type(existing_added[0].get(key)) is not int for key in ('InterfaceIndex', 'AddressFamily', 'RouteMetric', 'Protocol')):
        return None
    if any(row != expected and row.get('InterfaceIndex') != ras_index for row in added):
        return None
    delta = network_differences(before, during)['routes']
    if delta['truncated'] or delta['before_only_count'] != 0:
        return None
    return {'verified': True, 'route': expected, 'ras_interface_index': ras_index, 'ras_local_ipv4': local,
            'preflight': preflight, 'no_route_removed': True, 'only_one_existing_index_route_added': True,
            'new_ras_interface_unique': True, 'route_write_performed': False}


def class_based_test_route_preflight(before):
    """Complete bounded inventory; no overlapping IPv4 route or address prefix."""
    target = ipaddress.IPv4Network(CLASS_TEST_SUBNET)
    try:
        route_rows, address_rows = rows(before['routes']), rows(before['addresses'])
        if len(route_rows) > 128 or len(address_rows) > 64:
            return {'verified': False, 'subnet': CLASS_TEST_SUBNET, 'reason': 'inventory_too_large'}
        checked, defaults, addresses, indices = [], [], [], set()
        for key in ('adapters', 'interfaces', 'addresses', 'dns', 'routes'):
            field = 'ifIndex' if key == 'adapters' else 'InterfaceIndex'
            for row in rows(before[key]):
                value = row[field]
                if type(value) is not int or not 0 <= value < 2**31:
                    raise ValueError('invalid interface index')
                indices.add(value)
        if len(indices) > 128:
            return {'verified': False, 'subnet': CLASS_TEST_SUBNET, 'reason': 'inventory_too_large'}
        for row in route_rows:
            if set(row) != set(NETWORK_FIELDS['routes']):
                raise ValueError('route schema')
            if any(type(row[k]) is not int for k in ('InterfaceIndex', 'AddressFamily', 'RouteMetric', 'Protocol')):
                raise ValueError('route number')
            if not 0 <= row['RouteMetric'] < 2**31 or not 0 <= row['Protocol'] < 2**31:
                raise ValueError('route range')
            network, hop = ipaddress.ip_network(row['DestinationPrefix'], strict=True), ipaddress.ip_address(row['NextHop'])
            if row['AddressFamily'] != (2 if network.version == 4 else 23) or hop.version != network.version:
                raise ValueError('route family')
            record = dict(row, DestinationPrefix=str(network), NextHop=str(hop))
            if network.prefixlen == 0:
                defaults.append(record)
                continue
            if network.version == 4 and network.overlaps(target):
                return {'verified': False, 'subnet': CLASS_TEST_SUBNET, 'reason': 'route_overlap', 'conflicting_prefix': str(network)}
            checked.append(record)
        for row in address_rows:
            record = {k: row[k] for k in ('InterfaceIndex', 'AddressFamily', 'IPAddress', 'PrefixLength')}
            address = ipaddress.ip_address(record['IPAddress'])
            if (type(record['AddressFamily']) is not int or record['AddressFamily'] != (2 if address.version == 4 else 23)
                or type(record['PrefixLength']) is not int or not 0 <= record['PrefixLength'] <= address.max_prefixlen):
                raise ValueError('address family or prefix')
            network = ipaddress.ip_network((address, record['PrefixLength']), strict=False)
            if address.version == 4 and network.overlaps(target):
                return {'verified': False, 'subnet': CLASS_TEST_SUBNET, 'reason': 'address_overlap', 'conflicting_prefix': str(network)}
            addresses.append(dict(record, IPAddress=str(address)))
        return {'verified': True, 'subnet': CLASS_TEST_SUBNET,
                'checked_routes': [json.loads(row) for row in canonical(checked)],
                'excluded_default_routes': [json.loads(row) for row in canonical(defaults)],
                'checked_addresses': [json.loads(row) for row in canonical(addresses)],
                'original_interface_indices': sorted(indices), 'route_count': len(route_rows), 'address_count': len(address_rows)}
    except (KeyError, TypeError, ValueError):
        return {'verified': False, 'subnet': CLASS_TEST_SUBNET, 'reason': 'inventory_invalid'}


def class_based_test_route_proof(before, during, projection, peer_ip, server, control_ifindex, preflight):
    if preflight.get('verified') is not True or class_based_test_route_preflight(before) != preflight:
        return None
    local = projection.get('local_ip')
    if local not in CLASS_TEST_LOCALS or peer_ip != CLASS_TEST_PEER or projection.get('peer_ip') != CLASS_TEST_PEER:
        return None
    checks = preservation(before, during, active=True)
    if any(value is not True for key, value in checks.items() if key != 'routes_unchanged'):
        return None
    original = set(preflight['original_interface_indices'])
    local_rows = [row for row in rows(during['addresses']) if row.get('IPAddress') == local and row.get('AddressFamily') == 2]
    if len(local_rows) != 1:
        return None
    index = local_rows[0].get('InterfaceIndex')
    if type(index) is not int or not 0 < index < 2**31 or index in original:
        return None
    for key in ('adapters', 'interfaces', 'addresses', 'dns', 'routes'):
        field = 'ifIndex' if key == 'adapters' else 'InterfaceIndex'
        if any(row[field] not in original and row[field] != index for row in rows(during[key])):
            return None
    if len([row for row in rows(during['interfaces']) if row.get('InterfaceIndex') == index and row.get('AddressFamily') == 2]) != 1:
        return None
    a, b = Counter(canonical(before['routes'])), Counter(canonical(during['routes']))
    if a - b:
        return None
    added = [json.loads(row) for row in (b - a).elements()]
    ras_rows = [row for row in added if row.get('InterfaceIndex') == index]
    expected_prefixes = {CLASS_TEST_SUBNET, local + '/32', '224.0.0.0/4', '255.255.255.255/32'}
    if len(ras_rows) != 4 or {row.get('DestinationPrefix') for row in ras_rows} != expected_prefixes:
        return None
    for row in ras_rows:
        if (set(row) != set(NETWORK_FIELDS['routes']) or row['AddressFamily'] != 2
            or any(type(row[k]) is not int for k in ('InterfaceIndex', 'AddressFamily', 'RouteMetric', 'Protocol'))):
            return None
        if row['DestinationPrefix'] == CLASS_TEST_SUBNET:
            # Actual Windows PPTP12 route: peer next-hop, Protocol 3, Metric 1.
            if row['NextHop'] != CLASS_TEST_PEER or row['Protocol'] != 3 or row['RouteMetric'] != 1:
                return None
        elif row['NextHop'] != '0.0.0.0' or row['Protocol'] != 2 or row['RouteMetric'] != 256:
            return None
    existing = [row for row in added if row.get('InterfaceIndex') in original]
    outer = None
    if existing:
        outer_proof = automatic_outer_host_route_proof(before, during, projection, server, control_ifindex,
            outer_server_preflight(before, server, control_ifindex))
        if outer_proof is None or existing != [outer_proof['route']]:
            return None
        outer = outer_proof['route']
    if len(added) != len(ras_rows) + len(existing) or network_differences(before, during)['routes']['truncated']:
        return None
    return {'verified': True, 'subnet': CLASS_TEST_SUBNET, 'local_ipv4': local, 'peer_ipv4': peer_ip,
            'ras_interface_index': index, 'preflight': preflight,
            'added_ras_routes': [json.loads(row) for row in canonical(ras_rows)], 'automatic_outer_host_route': outer,
            'route_write_performed': False, 'no_route_removed': True, 'new_ras_interface_unique': True,
            'entry_disable_class_based_static_route': False, 'entry_remote_default_gateway': False,
            'entry_other_options_exact': True}


def default_pbk_fingerprints(extra_paths=()):
    result = {}
    paths = set(extra_paths)
    for root in [os.environ.get('APPDATA'), os.environ.get('PROGRAMDATA')]:
        if root:
            paths.add(str(Path(root) / 'Microsoft/Network/Connections/Pbk/rasphone.pbk'))
    for value in paths:
        path = Path(value)
        if not path.is_absolute() or str(path).startswith(('\\\\', '//')):
            raise PeerError('nonlocal_existing_phonebook_unsupported')
        result[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    return result


def _l2tp_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class L2tpEvidence:
    def __init__(self, workspace, baseline, report):
        workspace = Path(workspace).resolve(strict=True)
        if not workspace.is_relative_to(ROOT) or not safe_directory(workspace):
            raise PeerError('workspace_invalid')
        self.path = Path(tempfile.mkdtemp(prefix='l2tp-peer-evidence-', dir=workspace))
        self.identity = self.path.stat().st_ino
        report['l2tp_peer_evidence'] = {'directory': str(self.path), 'helper_source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
        value = {'network': baseline['network'], 'default_phonebooks': baseline['phonebooks'],
                 'default_profiles_sha256': _l2tp_hash(baseline['profiles']), 'default_profile_count': len(baseline['profiles']),
                 'ras_connections_sha256': _l2tp_hash(baseline['connections']), 'ras_connection_count': len(baseline['connections'])}
        report['l2tp_peer_evidence']['before_sha256'] = self.write('before.private.json', value)
        report['l2tp_baseline_persisted_before_entry_write'] = True
        self.save(report, strict=True)

    def write(self, name, value):
        if not safe_directory(self.path) or self.path.stat().st_ino != self.identity:
            raise PeerError('l2tp_evidence_directory_changed')
        raw = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
        target, temporary = self.path / name, self.path / (name + '.new')
        with temporary.open('xb') as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        temporary.replace(target)
        return hashlib.sha256(raw).hexdigest()

    def save(self, report, strict=False):
        try:
            self.write('state.private.json', report)
        except (OSError, ValueError, PeerError):
            report['l2tp_evidence_write_failed'] = True
            if strict:
                raise PeerError('l2tp_evidence_write_failed') from None


def l2tp_book_identity(book):
    book.verify()
    for path in (book.owner, book.pbk):
        if path == book.pbk and not path.exists():
            continue
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
            raise PeerError('l2tp_private_book_file_unsafe')
    directory, owner = book.path.lstat(), book.owner.lstat()
    return {'directory': str(book.path), 'directory_dev': str(directory.st_dev), 'directory_inode': str(directory.st_ino),
            'owner_dev': str(owner.st_dev), 'owner_inode': str(owner.st_ino),
            'owner_sha256': hashlib.sha256(book.owner.read_bytes()).hexdigest(),
            'entry_name_sha256': hashlib.sha256(book.name.encode()).hexdigest()}


def l2tp_require_book(book, report):
    if l2tp_book_identity(book) != report['l2tp_peer_evidence']['private_book']:
        raise PeerError('l2tp_private_book_identity_changed')


def l2tp_record(report, evidence, stage, rc, requested=None, returned=None, count=None):
    # Every field is a fixed label, integer, null or boolean. Failed API calls
    # never contribute a returned mask. No credential or opaque handle is read.
    row = {'stage': stage, 'rc': int(rc), 'requested_mask': requested,
           'returned_mask': returned if rc == 0 else None,
           'preshared_key_mask_set': bool(returned & 16) if rc == 0 and returned is not None else None,
           'entry_count': count if rc == 0 else None}
    report['psk_operations'].append(row)
    evidence.save(report)
    return row


def l2tp_private_entries(api, book, report, evidence, stage):
    array = (RASENTRYNAMEW * 4)()
    for row in array:
        row.dwSize = C.sizeof(RASENTRYNAMEW)
    size, count = D(C.sizeof(array)), D()
    rc = int(api.dll.RasEnumEntriesW(None, str(book.pbk), array, C.byref(size), C.byref(count)))
    l2tp_record(report, evidence, stage, rc, count=count.value)
    check_rc(rc, 'l2tp_private_entry_enumeration_failed')
    if count.value > 4:
        raise PeerError('l2tp_private_entry_enumeration_invalid')
    return list(array[:count.value])


def l2tp_get_mask(api, book, report, evidence, stage, mask):
    row = sized(RASCREDENTIALSW)
    row.dwMask = mask
    try:
        rc = int(api.dll.RasGetCredentialsW(str(book.pbk), book.name, C.byref(row)))
        return l2tp_record(report, evidence, stage, rc, requested=mask, returned=int(row.dwMask) if rc == 0 else None)
    finally:
        C.memset(C.byref(row), 0, C.sizeof(row))


def l2tp_set_fresh_psk(api, book, key, report, evidence):
    l2tp_require_book(book, report)
    before = l2tp_get_mask(api, book, report, evidence, 'get-before', 16)
    if before['rc'] == 0 and before['returned_mask'] != 0:
        raise PeerError('unexpected_fresh_entry_psk_or_scope')
    report['initial_psk_get_absence_claimed'] = False
    evidence.save(report, strict=True)
    row = sized(RASCREDENTIALSW)
    row.dwMask, row.szPassword = 16, key
    try:
        rc = int(api.dll.RasSetCredentialsW(str(book.pbk), book.name, C.byref(row), False))
        l2tp_record(report, evidence, 'set-key', rc, requested=16)
        check_rc(rc, 'temporary_psk_store_failed')
        report['temporary_psk_set_returned_success'] = True
    finally:
        C.memset(C.byref(row), 0, C.sizeof(row))
    after = l2tp_get_mask(api, book, report, evidence, 'get-after', 16)
    if after['rc'] != 0 or after['returned_mask'] != 16:
        raise PeerError('temporary_psk_store_not_proven', after['rc'] or None)
    report['psk_temporarily_stored'] = True
    evidence.save(report)


def l2tp_cached_password(api, book, report, evidence, stage):
    result = l2tp_get_mask(api, book, report, evidence, stage, 2)
    check_rc(result['rc'], 'credential_check_failed')
    if result['returned_mask'] not in (0, 2):
        raise PeerError('credential_check_scope_invalid')
    return result['returned_mask'] == 2


L2TP_ATTESTED_LCP = {'lcp_authentication_protocol': 0, 'lcp_authentication_data': 0,
    'lcp_eap_type_id': 0, 'lcp_server_authentication_protocol': 0xC223,
    'lcp_server_authentication_data': 0x81, 'lcp_server_eap_type_id': 0,
    'lcp_local_options': 67, 'lcp_peer_options': 64}
L2TP_OBSERVED_POSTPROJECTION_MASK = 0x80000000


def l2tp_postprojection_observation_matches(report, row):
    observation = report.get('postprojection_credential_observation')
    fields = {'state', 'requested_mask', 'returned_mask', 'no_password_cache_proven', 'content_read'}
    if (type(observation) is not dict or set(observation) != fields or observation['content_read'] is not False
        or type(observation['requested_mask']) is not int or observation['requested_mask'] != 2
        or type(row.get('requested_mask')) is not int or row['requested_mask'] != 2
        or type(row.get('rc')) is not int or row['rc'] != 0 or row.get('entry_count') is not None
        or type(observation['returned_mask']) is not int or type(row.get('returned_mask')) is not int
        or observation['returned_mask'] != row['returned_mask'] or row.get('preshared_key_mask_set') is not False):
        return False
    if observation['returned_mask'] == 0:
        return (observation['state'] == 'empty' and observation['no_password_cache_proven'] is True
                and report.get('credential_state') == 'empty' and report.get('postdial_no_cached_password_proven') is True)
    if observation['returned_mask'] == L2TP_OBSERVED_POSTPROJECTION_MASK:
        return (report.get('l2tp_observed_postprojection_mask_opt_in') is True
                and report.get('l2tp_server_auth_attestation_opt_in') is True
                and observation['state'] == 'observed-undocumented-mask' and observation['no_password_cache_proven'] is False
                and report.get('credential_state') == 'unknown-high-bit-mask'
                and report.get('postdial_no_cached_password_proven') is False)
    return False


def l2tp_observe_postprojection_credentials(api, book, report, evidence, allow_observed_mask=False):
    # Evaluate the complete six-step evidence before adding the seventh GET.
    # A failed or undocumented GET is never converted into cached_password=False.
    l2tp_require_book(book, report)
    eligible_prefix = l2tp_server_auth_eligible(report)
    result = l2tp_get_mask(api, book, report, evidence, 'password-after-projection', 2)
    check_rc(result['rc'], 'credential_check_failed')
    if result['returned_mask'] == 0:
        observation = {'state': 'empty', 'requested_mask': 2, 'returned_mask': 0,
                       'no_password_cache_proven': True, 'content_read': False}
        report.update(credential_state='empty', postdial_no_cached_password_proven=True)
    elif (result['returned_mask'] == L2TP_OBSERVED_POSTPROJECTION_MASK and allow_observed_mask is True
          and report.get('l2tp_observed_postprojection_mask_opt_in') is True and eligible_prefix):
        observation = {'state': 'observed-undocumented-mask', 'requested_mask': 2,
                       'returned_mask': L2TP_OBSERVED_POSTPROJECTION_MASK,
                       'no_password_cache_proven': False, 'content_read': False}
        report.update(credential_state='unknown-high-bit-mask', postdial_no_cached_password_proven=False)
    elif result['returned_mask'] == 2:
        raise PeerError('password_was_cached')
    else:
        raise PeerError('credential_check_scope_invalid')
    report['postprojection_credential_observation'] = observation
    evidence.save(report)
    return dict(observation)


def l2tp_server_auth_eligible(report, after_projection_cache=False):
    """A request for independent proof, never an authentication conclusion."""
    if type(report) is not dict or type(report.get('l2tp_peer_evidence')) is not dict:
        return False
    if (report.get('protocol') != 'l2tp-ipsec' or report.get('l2tp_server_auth_attestation_opt_in') is not True
        or any(report.get(key) is not True for key in ('windows_entry_policy_verified',
            'l2tp_fresh_empty_private_book_verified', 'l2tp_baseline_persisted_before_entry_write',
            'psk_temporarily_stored', 'temporary_psk_set_returned_success', 'dial_attempted', 'connected'))
        or report.get('initial_psk_get_absence_claimed') is not False
        or report.get('l2tp_evidence_write_failed', False) is not False
        or report.get('l2tp_peer_evidence', {}).get('entry_policy_verified_before_psk_write') is not True):
        return False
    projection = report.get('projection', {})
    if type(projection) is not dict:
        return False
    if projection.get('mschapv2') is not False or not all(type(projection.get(key)) is int and projection[key] == value
                                                        for key, value in L2TP_ATTESTED_LCP.items()):
        return False
    stages = ['enum-before', 'enum-created', 'get-before', 'set-key', 'get-after', 'password-before-dial']
    if after_projection_cache:
        stages.append('password-after-projection')
    operations = report.get('psk_operations')
    fields = {'stage', 'rc', 'requested_mask', 'returned_mask', 'preshared_key_mask_set', 'entry_count'}
    if type(operations) is not list or any(type(row) is not dict or set(row) != fields for row in operations):
        return False
    if [row['stage'] for row in operations] != stages:
        return False
    expected = {'enum-before': (None, None, 0), 'enum-created': (None, None, 1),
                'set-key': (16, None, None), 'get-after': (16, 16, None),
                'password-before-dial': (2, 0, None), 'password-after-projection': (2, 0, None)}
    def exact(actual, wanted):
        return actual is None if wanted is None else type(actual) is int and actual == wanted
    for row in operations:
        if type(row['rc']) is not int or not 0 <= row['rc'] < 2**32:
            return False
        if row['stage'] == 'get-before':
            if not exact(row['requested_mask'], 16) or row['entry_count'] is not None:
                return False
            if row['rc'] == 0:
                if not exact(row['returned_mask'], 0) or row['preshared_key_mask_set'] is not False:
                    return False
            elif row['returned_mask'] is not None or row['preshared_key_mask_set'] is not None:
                return False
            continue
        requested, returned, count = expected[row['stage']]
        if row['stage'] == 'password-after-projection':
            if not l2tp_postprojection_observation_matches(report, row):
                return False
            if row['returned_mask'] == L2TP_OBSERVED_POSTPROJECTION_MASK:
                continue  # Explicit unknown observation, not no-cache or auth proof.
        flag = None if returned is None else bool(returned & 16)
        if (row['rc'] != 0 or not exact(row['requested_mask'], requested) or not exact(row['returned_mask'], returned)
            or not exact(row['entry_count'], count) or row['preshared_key_mask_set'] is not flag):
            return False
    return True


def l2tp_clear_delete(api, book, report, evidence, allow_delete):
    l2tp_require_book(book, report)
    successful = True
    for mask, stage in [(16, 'clear-key'), (7, 'clear-user')]:
        row = sized(RASCREDENTIALSW)
        row.dwMask = mask
        try:
            rc = int(api.dll.RasSetCredentialsW(str(book.pbk), book.name, C.byref(row), True))
        finally:
            C.memset(C.byref(row), 0, C.sizeof(row))
        l2tp_record(report, evidence, stage, rc, requested=mask)
        successful = successful and rc == 0
    report['psk_cleared'] = any(r['stage'] == 'clear-key' and r['rc'] == 0 for r in report['psk_operations'])
    if not successful:
        raise PeerError('l2tp_private_credentials_clear_not_proven')
    if not allow_delete:
        raise PeerError('l2tp_private_entry_delete_requires_disconnect')
    l2tp_require_book(book, report)
    entries = l2tp_private_entries(api, book, report, evidence, 'enum-before-delete')
    if len(entries) != 1 or entries[0].szEntryName != book.name or entries[0].dwFlags != 0:
        raise PeerError('l2tp_private_entry_changed_before_delete')
    rc = int(api.dll.RasDeleteEntryW(str(book.pbk), book.name))
    l2tp_record(report, evidence, 'delete-entry', rc)
    check_rc(rc, 'l2tp_private_entry_delete_failed')
    if l2tp_private_entries(api, book, report, evidence, 'enum-empty'):
        raise PeerError('l2tp_private_phonebook_not_empty')
    report['l2tp_private_credentials_deleted_and_enum_empty'] = True
    evidence.save(report)


def l2tp_finish(api, book, handle, created, report, evidence, baseline, on_disconnected):
    try:
        api.hangup(handle)
    except (Exception, KeyboardInterrupt):
        report['ok'], report['cleanup_error'] = False, 'owned_ras_disconnect_not_proven'
    finally:
        api.wipe()
    try:
        if any(os.path.normcase(pbk) == os.path.normcase(str(book.pbk)) or name == book.name
               for _handle, pbk, name in api.connections()):
            raise PeerError('owned_connection_still_present')
        report['disconnected'] = True
    except (Exception, KeyboardInterrupt):
        report['ok'], report['cleanup_error'] = False, 'owned_ras_disconnect_not_proven'
    try:
        if on_disconnected(json.loads(json.dumps(report))) is not True:
            raise PeerError('router_test_key_revocation_not_proven')
        report['router_test_key_revoked'] = True
    except (Exception, KeyboardInterrupt):
        report['ok'], report['revocation_error'] = False, 'router_test_key_revocation_not_proven'
        report['router_test_key_revoked'] = False
    if created:
        try:
            l2tp_clear_delete(api, book, report, evidence, report['disconnected'] is True)
        except (Exception, KeyboardInterrupt) as error:
            report['ok'] = False
            report['cleanup_error'] = error.code if isinstance(error, PeerError) else 'l2tp_private_cleanup_failed'
    try:
        after = network_snapshot()
        report['after'] = preservation(baseline['network'], after)
        report['network_diffs']['after'] = network_differences(baseline['network'], after)
        profiles, connections = api.profiles(), api.connections()
        phonebooks = default_pbk_fingerprints(baseline['extra_phonebooks'])
        report['after']['default_phonebooks_unchanged'] = baseline['phonebooks'] == phonebooks
        report['after']['original_profiles_unchanged'] = baseline['profiles'] == profiles
        report['after']['other_ras_connections_unchanged'] = baseline['connections'] == connections
        report['l2tp_peer_evidence']['after_sha256'] = evidence.write('after.private.json', {
            'network': after, 'default_phonebooks': phonebooks, 'default_profiles_sha256': _l2tp_hash(profiles),
            'default_profile_count': len(profiles), 'ras_connections_sha256': _l2tp_hash(connections),
            'ras_connection_count': len(connections)})
        if not all(report['after'].values()):
            raise PeerError('original_network_not_restored')
        if created and report.get('l2tp_private_credentials_deleted_and_enum_empty') is not True:
            raise PeerError('l2tp_private_book_retained_for_recovery')
        l2tp_require_book(book, report)
        if {path.name for path in book.path.iterdir()} - {'owner', 'peer.pbk'}:
            raise PeerError('temporary_book_unexpected_files')
        book.cleanup()
        report['temporary_book_removed'] = True
    except (Exception, KeyboardInterrupt) as error:
        report['ok'] = False
        report['cleanup_error'] = error.code if isinstance(error, PeerError) else 'l2tp_after_state_or_file_cleanup_failed'
    finally:
        api.wipe()
        if report.get('l2tp_evidence_write_failed'):
            report['ok'], report['cleanup_error'] = False, 'l2tp_evidence_write_failed'
        evidence.save(report)


def safe_directory(path):
    info = path.lstat()
    return stat.S_ISDIR(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400


class OwnedBook:
    def __init__(self, workspace):
        workspace = Path(workspace).resolve(strict=True)
        if not workspace.is_relative_to(ROOT) or not safe_directory(workspace):
            raise PeerError('workspace_invalid')
        self.path = Path(tempfile.mkdtemp(prefix='mp716-vpn-peer-', dir=workspace))
        self.identity = self.path.stat().st_ino
        self.token = secrets.token_hex(32)
        self.name = 'mp716-test-' + secrets.token_hex(16)
        self.owner = self.path / 'owner'
        self.owner.write_text(self.token, encoding='ascii')
        self.pbk = self.path / 'peer.pbk'
        self.pbk.touch(exist_ok=False)

    def verify(self):
        if (not safe_directory(self.path) or self.path.stat().st_ino != self.identity
            or self.owner.is_symlink() or self.owner.read_text(encoding='ascii') != self.token):
            raise PeerError('temporary_book_ownership_lost')

    def cleanup(self):
        self.verify()
        children = list(self.path.iterdir())
        if any(p.name not in ('owner', 'peer.pbk', 'peer.pbk.bak') or not p.is_file()
               or getattr(p.lstat(), 'st_file_attributes', 0) & 0x400 for p in children):
            raise PeerError('temporary_book_unexpected_files')
        for p in children:
            if p.name != 'owner':
                p.unlink()
        self.owner.unlink()
        self.path.rmdir()


def validate_credentials(value):
    if not isinstance(value, dict) or set(value) != {'username', 'password'}:
        raise PeerError('credential_input_invalid')
    for field in ('username', 'password'):
        text = value[field]
        if (not isinstance(text, str) or not 1 <= len(text.encode('utf-16-le')) // 2 <= 256
            or any(ord(c) < 32 or ord(c) == 127 for c in text)):
            raise PeerError('credential_input_invalid')
    return value['username'], value['password']


def icmp_probe(source, destination, count=3, dll=None):
    """Synchronous source-bound IPv4 echo; never mutates a route or interface.

    Microsoft IcmpSendEcho2Ex / Ipexport.h. Only the common fixed 14-byte
    address/status/RTT/size prefix is read: pointer-bearing ICMP_ECHO_REPLY32
    differs on x64. A 4096-byte reply buffer exceeds both ABI minimum sizes.
    """
    if dll is None:
        dll = C.WinDLL('iphlpapi.dll', use_last_error=True)
    dll.IcmpCreateFile.argtypes, dll.IcmpCreateFile.restype = [], P
    dll.IcmpCloseHandle.argtypes, dll.IcmpCloseHandle.restype = [P], D
    dll.IcmpSendEcho2Ex.argtypes = [P, P, P, P, D, D, P, C.c_uint16, P, P, D, D]
    dll.IcmpSendEcho2Ex.restype = D
    handle = dll.IcmpCreateFile()
    if handle in (None, C.c_void_p(-1).value):
        raise PeerError('icmp_handle_failed')
    result = {'sent': count, 'received': 0, 'statuses': [], 'round_trip_ms': []}
    payload = C.create_string_buffer(b'MP716-PPTP-' + secrets.token_bytes(16))
    source_ip = int.from_bytes(ipaddress.IPv4Address(source).packed, 'little')
    destination_ip = int.from_bytes(ipaddress.IPv4Address(destination).packed, 'little')
    try:
        for _ in range(count):
            reply = C.create_string_buffer(4096)
            received = dll.IcmpSendEcho2Ex(handle, None, None, None, source_ip, destination_ip,
                payload, len(payload.raw) - 1, None, reply, len(reply), 1000)
            if received:
                address, status, delay, size = struct.unpack_from('<IIIH', reply.raw)
                result['statuses'].append(status)
                if address == destination_ip and status == 0 and size == len(payload.raw) - 1:
                    result['received'] += 1
                    result['round_trip_ms'].append(delay)
            else:
                result['statuses'].append(C.get_last_error())
    finally:
        if not dll.IcmpCloseHandle(handle):
            raise PeerError('icmp_handle_close_failed')
    return result


def probe_io(diagnostic, stage, operation, *args):
    """Fixed operation labels and bounded OS numbers, never exception text."""
    allowed = {'route.query', 'socket.create', 'socket.timeout', 'socket.set_interface',
               'socket.get_interface_before', 'socket.bind', 'socket.connect',
               'socket.get_interface_after', 'socket.get_local', 'socket.get_peer',
               'socket.send_http', 'socket.receive_http', 'icmp.echo'}
    if stage not in allowed:
        raise PeerError('invalid_probe_diagnostic_stage')
    diagnostic['probe_stage'] = stage
    try:
        return operation(*args)
    except OSError as error:
        def number(value):
            return value if type(value) is int and -(2**31) <= value < 2**31 else None
        diagnostic['os_error'] = {'stage': stage, 'winerror': number(getattr(error, 'winerror', None)),
                                  'errno': number(getattr(error, 'errno', None)),
                                  'timed_out': isinstance(error, TimeoutError)}
        raise


def peer_probe(before, connected, projection, peer_ip, port, allow_interface_bound_probe=False, diagnostic=None):
    ipaddress.IPv4Address(projection['local_ip'])
    ipaddress.IPv4Address(peer_ip)
    if allow_interface_bound_probe and port != 80:
        raise PeerError('interface_bound_probe_http_port_not_approved')
    new = [r for r in rows(connected['addresses']) if r['IPAddress'] == projection['local_ip']
           and r['InterfaceIndex'] not in {a['InterfaceIndex'] for a in rows(before['interfaces'])}]
    if len(new) != 1:
        raise PeerError('ras_interface_not_unique')
    interface_index = new[0]['InterfaceIndex']
    if type(interface_index) is not int or not 0 < interface_index < 2**31:
        raise PeerError('ras_interface_index_invalid')
    if allow_interface_bound_probe:
        original = {r['InterfaceIndex'] for r in rows(before['interfaces'])}
        for key in ('adapters', 'addresses', 'dns', 'routes'):
            original.update(r['ifIndex' if key == 'adapters' else 'InterfaceIndex'] for r in rows(before[key]))
        if (interface_index in original or new[0].get('AddressFamily') != 2
            or len([r for r in rows(connected['interfaces']) if r.get('InterfaceIndex') == interface_index and r.get('AddressFamily') == 2]) != 1):
            raise PeerError('ras_interface_not_unique')
    result = diagnostic if diagnostic is not None else {}
    result.update(source_bound_tcp_connected=False, ras_interface_route_verified=False,
                  interface_index=interface_index, interface_bound_probe_opt_in=allow_interface_bound_probe,
                  socket_binding_verified=False, datapath_basis=None,
                  route_query={'status': 'not-completed', 'interface_indices': None, 'error': None})
    try:
        route = probe_io(result, 'route.query', powershell, f"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Find-NetRoute -RemoteIPAddress '{peer_ip}' -LocalIPAddress '{projection['local_ip']}' | ForEach-Object InterfaceIndex | Select-Object -Unique) | ConvertTo-Json -Compress")
    except PeerError as error:
        if error.code not in ('network_inventory_failed', 'network_inventory_invalid'):
            raise
        result['route_query'] = {'status': 'query_error', 'interface_indices': None, 'error': error.code}
        if not allow_interface_bound_probe:
            raise
    else:
        indices = rows(route)
        if (len(indices) > 32 or any(type(index) is not int or not 0 < index < 2**31 for index in indices)
            or len(set(indices)) != len(indices)):
            result['route_query']['error'] = 'peer_route_query_result_invalid'
            raise PeerError('peer_route_query_result_invalid')
        verified = indices == [interface_index]
        result['ras_interface_route_verified'] = verified
        result['route_query'] = {'status': 'verified' if verified else 'different_interface',
                                 'interface_indices': indices, 'error': None}
        if not verified and not allow_interface_bound_probe:
            raise PeerError('peer_route_not_ras_interface')
    with probe_io(result, 'socket.create', socket.socket, socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe_io(result, 'socket.timeout', probe.settimeout, 5)
        # SDK ws2ipdef.h IP_UNICAST_IF=31, documented network-byte-order DWORD.
        probe_io(result, 'socket.set_interface', probe.setsockopt, socket.IPPROTO_IP, 31, struct.pack('!I', interface_index))
        if allow_interface_bound_probe:
            # Microsoft specifies GET in host order; Python without buflen
            # returns the native integer directly, with no network conversion.
            selected = probe_io(result, 'socket.get_interface_before', probe.getsockopt, socket.IPPROTO_IP, 31)
            result['socket_binding'] = {'option': 31, 'set_interface_index': interface_index,
                'set_network_byte_order': True, 'get_before_connect': selected, 'get_host_byte_order': True}
            if type(selected) is not int or selected != interface_index:
                raise PeerError('socket_interface_readback_mismatch')
        probe_io(result, 'socket.bind', probe.bind, (projection['local_ip'], 0))
        probe_io(result, 'socket.connect', probe.connect, (peer_ip, port))
        if allow_interface_bound_probe:
            selected = probe_io(result, 'socket.get_interface_after', probe.getsockopt, socket.IPPROTO_IP, 31)
            local = probe_io(result, 'socket.get_local', probe.getsockname)
            remote = probe_io(result, 'socket.get_peer', probe.getpeername)
            result['socket_binding'].update(get_after_connect=selected,
                local_ip=local[0], local_port=local[1], peer_ip=remote[0], peer_port=remote[1])
            if type(selected) is not int or selected != interface_index:
                raise PeerError('socket_interface_changed_after_connect')
            if (local[0] != projection['local_ip'] or type(local[1]) is not int or not 0 < local[1] <= 65535
                or remote != (peer_ip, port)):
                raise PeerError('socket_endpoint_mismatch')
            result['socket_binding_verified'] = True
        probe_io(result, 'socket.send_http', probe.sendall, f'GET / HTTP/1.0\r\nHost: {peer_ip}\r\nConnection: close\r\n\r\n'.encode('ascii'))
        response = probe_io(result, 'socket.receive_http', probe.recv, 4096)
    header = response.split(b'\r\n', 1)[0].split(b' ')
    if len(header) < 2 or header[0] not in (b'HTTP/1.0', b'HTTP/1.1') or not header[1].isdigit():
        raise PeerError('peer_http_response_invalid')
    status_code = int(header[1])
    if not 100 <= status_code <= 599:
        raise PeerError('peer_http_response_invalid')
    result.update(http_status=status_code, received_bytes=len(response))
    if allow_interface_bound_probe and not 200 <= status_code <= 399:
        raise PeerError('peer_http_status_not_successful')
    result.update(source_bound_tcp_connected=True,
        datapath_basis='route-query-and-source-bound-socket' if result['ras_interface_route_verified'] else 'interface-and-source-bound-socket',
        icmp_source_ip=projection['local_ip'], icmp_peer_ip=peer_ip,
        icmp=probe_io(result, 'icmp.echo', icmp_probe, projection['local_ip'], peer_ip))
    result['probe_stage'] = 'complete'
    return result




def run_peer(api, server, peer_ip, control_ifindex, credentials, workspace, timeout=35, hold=0, probe_port=80, on_connected=None,
             protocol='pptp', preshared_key=None, on_disconnected=None, authentication_validator=None,
             allow_interface_bound_probe=False, allow_class_based_test_route=False, allow_l2tp_server_auth_attestation=False,
             allow_l2tp_observed_postprojection_mask=False):
    # All identities/ownership and all cleanup flags remain in process memory.
    server, peer_ip = str(ipaddress.IPv4Address(server)), str(ipaddress.IPv4Address(peer_ip))
    if not isinstance(control_ifindex, int) or control_ifindex <= 0:
        raise PeerError('control_interface_invalid')
    if protocol not in ('pptp', 'l2tp-ipsec'):
        raise PeerError('vpn_protocol_unsupported')
    if protocol == 'l2tp-ipsec':
        if (not isinstance(preshared_key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', preshared_key)
            or not callable(on_disconnected) or not callable(on_connected)):
            raise PeerError('l2tp_requires_random_key_and_sa_revoke_controller')
    elif preshared_key is not None:
        raise PeerError('pptp_does_not_use_psk')
    if type(allow_l2tp_server_auth_attestation) is not bool or (allow_l2tp_server_auth_attestation
        and (protocol != 'l2tp-ipsec' or not callable(authentication_validator))):
        raise PeerError('l2tp_server_auth_attestation_requires_explicit_validator')
    if type(allow_l2tp_observed_postprojection_mask) is not bool or (allow_l2tp_observed_postprojection_mask
        and (protocol != 'l2tp-ipsec' or allow_l2tp_server_auth_attestation is not True or not callable(authentication_validator))):
        raise PeerError('l2tp_observed_mask_requires_explicit_attestation_scope')
    validator_protocol_allowed = protocol == 'pptp' or protocol == 'l2tp-ipsec' and allow_l2tp_server_auth_attestation
    if authentication_validator is not None and (not validator_protocol_allowed or not callable(authentication_validator)):
        raise PeerError('authentication_validator_invalid')
    if type(allow_class_based_test_route) is not bool or (allow_class_based_test_route
        and (protocol != 'l2tp-ipsec' or peer_ip != CLASS_TEST_PEER
             or not callable(on_connected) or not callable(on_disconnected))):
        raise PeerError('class_route_requires_explicit_l2tp_test')
    bound_protocol_allowed = protocol == 'pptp' or protocol == 'l2tp-ipsec' and allow_class_based_test_route
    if type(allow_interface_bound_probe) is not bool or (allow_interface_bound_probe
        and (not bound_protocol_allowed or not callable(on_connected) or probe_port != 80)):
        raise PeerError('interface_bound_probe_requires_pptp_controller')
    report = {'ok': False, 'protocol': protocol, 'error': None, 'ras_error': None,
              'connected': False, 'disconnected': False, 'temporary_book_removed': False, 'dial_attempted': False,
              'windows_entry_policy_verified': False, 'server_attested_client_mschapv2': False,
              'network_diffs': {}, 'interface_bound_probe_opt_in': allow_interface_bound_probe,
              'class_based_test_route_opt_in': allow_class_based_test_route,
              'l2tp_server_auth_attestation_opt_in': allow_l2tp_server_auth_attestation,
              'l2tp_observed_postprojection_mask_opt_in': allow_l2tp_observed_postprojection_mask}
    before = network_snapshot()
    if allow_class_based_test_route:
        report['class_based_test_route_preflight'] = class_based_test_route_preflight(before)
        if report['class_based_test_route_preflight'].get('verified') is not True:
            raise PeerError('class_test_subnet_conflict_or_invalid_inventory')
    report['outer_server_preflight'] = outer_server_preflight(before, server, control_ifindex)
    original_profiles = api.profiles()
    original_pbks = {path for path, _name, _flags in original_profiles if path}
    default_pbk = default_pbk_fingerprints(original_pbks)
    original_connections = api.connections()
    dns_rows = [r for r in rows(before['dns']) if r['InterfaceIndex'] == control_ifindex and int(r['AddressFamily']) == 2]
    if len(dns_rows) != 1 or not rows(dns_rows[0]['ServerAddresses']):
        raise PeerError('control_ipv4_dns_missing')
    dns = rows(dns_rows[0]['ServerAddresses'])[0]
    ipaddress.IPv4Address(dns)
    device_kind = '(PPTP)' if protocol == 'pptp' else '(L2TP)'
    devices = sorted({name for kind, name in api.devices() if kind == 'vpn' and device_kind in name.upper()})
    if len(devices) != 1:
        raise PeerError('vpn_device_not_unique')
    baseline = {'network': before, 'profiles': original_profiles, 'phonebooks': default_pbk,
                'extra_phonebooks': original_pbks, 'connections': original_connections}
    evidence = L2tpEvidence(workspace, baseline, report) if protocol == 'l2tp-ipsec' else None
    book, handle, created = OwnedBook(workspace), P(), False
    try:
        book.verify()
        if protocol == 'l2tp-ipsec':
            report['psk_operations'] = []
            report['l2tp_peer_evidence']['private_book'] = l2tp_book_identity(book)
            if any(name == book.name for _path, name, _flags in original_profiles):
                raise PeerError('l2tp_private_entry_nonce_default_profile_collision')
            if l2tp_private_entries(api, book, report, evidence, 'enum-before'):
                raise PeerError('l2tp_fresh_private_phonebook_not_empty')
            report['l2tp_fresh_empty_private_book_verified'] = True
            evidence.save(report, strict=True)
        created = True  # Include partially-created entry failures in cleanup.
        report['windows_entry_policy_verified'] = api.create(book.pbk, book.name, make_entry(server, devices[0], dns, protocol,
            allow_class_based_test_route=allow_class_based_test_route)) is True
        if allow_interface_bound_probe and report['windows_entry_policy_verified'] is not True:
            raise PeerError('interface_bound_probe_entry_policy_unproven')
        if protocol == 'l2tp-ipsec':
            if report['windows_entry_policy_verified'] is not True:
                raise PeerError('l2tp_strict_entry_policy_not_proven')
            entries = l2tp_private_entries(api, book, report, evidence, 'enum-created')
            if len(entries) != 1 or entries[0].szEntryName != book.name or entries[0].dwFlags != 0:
                raise PeerError('l2tp_created_private_entry_not_exact')
            report['l2tp_peer_evidence']['entry_policy_verified_before_psk_write'] = True
            evidence.save(report, strict=True)
            l2tp_set_fresh_psk(api, book, preshared_key, report, evidence)
        cached = l2tp_cached_password(api, book, report, evidence, 'password-before-dial') if protocol == 'l2tp-ipsec' else api.cached_password(book.pbk, book.name)
        if cached:
            raise PeerError('unexpected_cached_password')
        report['dial_attempted'] = True
        api.start(book.pbk, book.name, credentials, handle)
        api.wait(timeout)
        report['connected'] = True
        projection = api.projection(handle) if protocol == 'pptp' else api.projection(handle, protocol=protocol)
        report['projection'] = projection
        security_keys = ['mschapv2', 'mppe128_send', 'mppe128_receive'] if protocol == 'pptp' else ['mschapv2']
        # This narrow case asks the controller to prove actual client MSCHAPv2
        # using the owned server's exact live policy and authenticated session.
        # The legacy RAS server fields alone never prove client authentication.
        observed_lcp = {'lcp_authentication_protocol': 0, 'lcp_authentication_data': 0,
                        'lcp_eap_type_id': 0, 'lcp_server_authentication_protocol': 0xC223,
                        'lcp_server_authentication_data': 0x81, 'lcp_server_eap_type_id': 0,
                        'lcp_local_options': 0, 'lcp_peer_options': 0}
        attestation_requested = (protocol == 'pptp' and callable(authentication_validator)
            and report['windows_entry_policy_verified'] is True and projection.get('mschapv2') is False
            and projection.get('mppe128_send') is True and projection.get('mppe128_receive') is True
            and all(type(projection.get(k)) is int and projection[k] == v for k, v in observed_lcp.items()))
        l2tp_attestation_requested = (protocol == 'l2tp-ipsec' and allow_l2tp_server_auth_attestation
            and callable(authentication_validator) and l2tp_server_auth_eligible(report))
        native_security = projection.get('mschapv2') is True if protocol == 'l2tp-ipsec' else all(projection[k] for k in security_keys)
        if not native_security and not attestation_requested and not l2tp_attestation_requested:
            raise PeerError('negotiated_security_mismatch')
        if projection['peer_ip'] and projection['peer_ip'] != peer_ip:
            raise PeerError('ppp_peer_address_mismatch')
        if protocol == 'l2tp-ipsec':
            l2tp_observe_postprojection_credentials(api, book, report, evidence,
                                                   allow_observed_mask=allow_l2tp_observed_postprojection_mask)
        elif api.cached_password(book.pbk, book.name):
            raise PeerError('password_was_cached')
        if l2tp_attestation_requested and not l2tp_server_auth_eligible(report, after_projection_cache=True):
            raise PeerError('l2tp_server_auth_prerequisites_not_proven')
        if protocol == 'l2tp-ipsec' and projection.get('mschapv2') is True:
            report['authentication_basis'] = 'windows-client-projection'
        connected = network_snapshot()
        report['during'] = preservation(before, connected, active=True)
        report['network_diffs']['during'] = network_differences(before, connected)
        report['during_effective'] = dict(report['during'])
        report['automatic_outer_host_route_proof'] = None
        if allow_class_based_test_route:
            proof = class_based_test_route_proof(before, connected, projection, peer_ip, server, control_ifindex,
                report['class_based_test_route_preflight'])
            report['class_based_test_route_proof'] = proof
            if proof is None:
                raise PeerError('class_test_route_not_exact_expected_ras_routes')
        if (protocol == 'pptp' or allow_class_based_test_route) and report['windows_entry_policy_verified'] is True and report['during'].get('routes_unchanged') is False:
            proof = automatic_outer_host_route_proof(before, connected, projection, server, control_ifindex, report['outer_server_preflight'])
            if proof is not None:
                report['automatic_outer_host_route_proof'] = proof
                report['during_effective']['routes_unchanged'] = True
        report['original_network_preserved'] = all(value is True for value in report['during_effective'].values())
        if not report['original_network_preserved']:
            raise PeerError('original_network_changed_during_tunnel')
        if attestation_requested or l2tp_attestation_requested:
            if l2tp_attestation_requested and not l2tp_server_auth_eligible(report, after_projection_cache=True):
                raise PeerError('l2tp_server_auth_prerequisites_not_proven')
            try:
                attested = authentication_validator(json.loads(json.dumps(report))) is True
            except (Exception, KeyboardInterrupt):
                raise PeerError('server_client_authentication_not_proven') from None
            if not attested:
                raise PeerError('server_client_authentication_not_proven')
            report['server_attested_client_mschapv2'] = True
            if l2tp_attestation_requested:
                report['authentication_basis'] = 'owned-l2tp-server-attestation'
        report['probe'] = {}
        probe = peer_probe(before, connected, projection, peer_ip, probe_port,
            allow_interface_bound_probe=allow_interface_bound_probe, diagnostic=report['probe'])
        report['probe'] = probe
        if allow_interface_bound_probe and probe.get('socket_binding_verified') is not True:
            raise PeerError('interface_bound_socket_proof_missing')
        if report['probe'].get('icmp', {}).get('received') != 3:
            raise PeerError('icmp_roundtrip_incomplete')
        if allow_interface_bound_probe and probe.get('icmp', {}).get('sent') != 3:
            raise PeerError('icmp_roundtrip_incomplete')
        needs_controller_proof = allow_interface_bound_probe and probe.get('ras_interface_route_verified') is not True
        report['controller_data_path_proof_required'] = needs_controller_proof
        report['controller_data_path_proven'] = False
        report['datapath_basis'] = probe.get('datapath_basis')
        # Synchronous controller hook: do router-side observations while this
        # connection is alive. Returning (or raising) always enters cleanup.
        if on_connected is not None:
            sa_proven = on_connected(json.loads(json.dumps(report)))
            if needs_controller_proof:
                if sa_proven is not True:
                    raise PeerError('controller_data_path_not_proven')
                report['controller_data_path_proven'] = True
                report['datapath_basis'] = 'interface-bound-socket-and-controller-ppp-proof'
            if protocol == 'l2tp-ipsec':
                if sa_proven is not True:
                    raise PeerError('router_ipsec_sa_not_proven')
                report['router_ipsec_sa_proven'] = True
        if hold:
            time.sleep(hold)
        report['ok'] = True
    except (Exception, KeyboardInterrupt) as exc:
        report['error'] = exc.code if isinstance(exc, PeerError) else 'interrupted' if isinstance(exc, KeyboardInterrupt) else 'peer_operation_failed'
        report['ras_error'] = exc.ras_error if isinstance(exc, PeerError) else None
    finally:
        if protocol == 'l2tp-ipsec':
            l2tp_finish(api, book, handle, created, report, evidence, baseline, on_disconnected)
        else:
            try:
                api.hangup(handle)
                api.wipe()
                # Never close any enumerated handle. Enumeration only proves ours gone.
                if any(os.path.normcase(pbk) == os.path.normcase(str(book.pbk)) or name == book.name
                       for _h, pbk, name in api.connections()):
                    raise PeerError('owned_connection_still_present')
                report['disconnected'] = True
                book.verify()
                if protocol == 'l2tp-ipsec':
                    # Always try local secret removal even if device revocation
                    # fails. That failure still prevents an overall success.
                    try:
                        if on_disconnected(json.loads(json.dumps(report))) is not True:
                            raise PeerError('router_test_key_revocation_not_proven')
                        report['router_test_key_revoked'] = True
                    except (Exception, KeyboardInterrupt):
                        report['ok'] = False
                        report['revocation_error'] = 'router_test_key_revocation_not_proven'
                    if created:
                        api.clear_psk(book.pbk, book.name)
                        report['psk_cleared'] = True
                if created:
                    api.erase(book.pbk, book.name)
                after = network_snapshot()
                report['after'] = preservation(before, after)
                report['network_diffs']['after'] = network_differences(before, after)
                report['after']['default_phonebooks_unchanged'] = default_pbk == default_pbk_fingerprints(original_pbks)
                report['after']['original_profiles_unchanged'] = original_profiles == api.profiles()
                report['after']['other_ras_connections_unchanged'] = original_connections == api.connections()
                book.cleanup()
                report['temporary_book_removed'] = True
                if not all(report['after'].values()):
                    raise PeerError('original_network_not_restored')
            except (PeerError, OSError, ValueError) as exc:
                report['ok'] = False
                report['cleanup_error'] = exc.code if isinstance(exc, PeerError) else 'cleanup_failed'
            finally:
                api.wipe()

    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('preflight', help='read-only device/connection inventory; never creates a PBK')
    run = sub.add_parser('run', help='create and dial one temporary PPTP entry, then clean up')
    run.add_argument('--server', required=True, type=ipaddress.IPv4Address)
    run.add_argument('--peer-ip', required=True, type=ipaddress.IPv4Address)
    run.add_argument('--protocol', choices=['pptp'], default='pptp')
    run.add_argument('--control-ifindex', type=int, required=True)
    run.add_argument('--credentials-stdin', action='store_true')
    run.add_argument('--workspace', type=Path, default=ROOT / 'build')
    run.add_argument('--timeout', type=int, choices=range(5, 61), default=35, metavar='5..60')
    run.add_argument('--hold', type=int, choices=range(0, 31), default=0, metavar='0..30')
    run.add_argument('--probe-port', type=int, choices=range(1, 65536), default=80, metavar='PORT')
    args = parser.parse_args()
    try:
        api = RasApi()
        if args.command == 'preflight':
            devices, connections, profiles = api.devices(), api.connections(), api.profiles()
            result = {'ok': True, 'read_only': True, 'ras_devices': [{'type': a, 'name': b} for a, b in devices],
                      'active_connection_count': len(connections), 'abi_checked': True,
                      'existing_profile_count': len(profiles),
                      'pptp_available': any(a == 'vpn' and '(PPTP)' in b.upper() for a, b in devices)}
        else:
            if args.credentials_stdin:
                raw = sys.stdin.read(8193)
                if len(raw) > 8192:
                    raise PeerError('credential_input_too_large')
                value = json.loads(raw)
                del raw
            else:
                value = {'username': getpass.getpass('Temporary VPN username: '), 'password': getpass.getpass('Temporary VPN password: ')}
            credentials = validate_credentials(value)
            value.clear()
            result = run_peer(api, str(args.server), str(args.peer_ip), args.control_ifindex, credentials,
                              args.workspace, args.timeout, args.hold, args.probe_port)
            del credentials
    except (PeerError, ValueError, OSError, EOFError):
        # Deliberately avoid exception text, traceback and stdin echo.
        exc = sys.exception()
        result = {'ok': False, 'error': exc.code if isinstance(exc, PeerError) else 'peer_input_or_platform_failed',
                  'ras_error': exc.ras_error if isinstance(exc, PeerError) else None}
    print(json.dumps(result, sort_keys=True))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
