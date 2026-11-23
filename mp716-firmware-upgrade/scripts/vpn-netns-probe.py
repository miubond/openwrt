#!/usr/bin/env python3
"""Probe an already established, isolated Linux VPN peer without changing it.

``plan`` is portable and has no system effects. ``probe`` requires an existing
network namespace named mp716-vpn-<8..16 lower hex digits> and a real PPP/TUN
interface. It never creates namespaces, starts VPN servers, installs packages,
edits a route/DNS/firewall, reads a credential, or accesses a router API.

This verifies only tunnel routing and bidirectional ICMP/HTTP data. A successful
result deliberately does not attest peer authentication or protocol identity.
Combine it with independently captured daemon authentication/IPsec evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time

PROTOCOLS = ("pptp", "l2tp", "l2tp-ipsec", "openvpn")
MAX_OUTPUT = 8 * 1024 * 1024


class ProbeError(Exception):
    def __init__(self, stage: str, reason: str):
        self.stage, self.reason = stage, reason
        super().__init__(reason)


def validate(namespace: str, interface: str, peer: str, port: int):
    if not re.fullmatch(r"mp716-vpn-[0-9a-f]{8,16}", namespace):
        raise ProbeError("arguments", "dedicated_lab_namespace_required")
    if len(interface) > 15 or not re.fullmatch(r"ppp[0-9]+|tun(?:[0-9]+|-mp716)", interface):
        raise ProbeError("arguments", "real_ppp_or_tun_interface_required")
    try:
        address = ipaddress.IPv4Address(peer)
    except ipaddress.AddressValueError:
        raise ProbeError("arguments", "literal_private_ipv4_peer_required") from None
    if not any(address in ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ProbeError("arguments", "literal_private_ipv4_peer_required")
    if not 1 <= port <= 65535:
        raise ProbeError("arguments", "invalid_http_port")


def canonical_hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def stable_rules(value, parent=""):
    """Ignore traffic counters and nft metadata, preserve rule semantics."""
    if isinstance(value, list):
        return [stable_rules(v, parent) for v in value if not isinstance(v, dict) or "metainfo" not in v]
    if isinstance(value, dict):
        return {k: stable_rules(v, k) for k, v in value.items()
                if not (parent == "counter" and k in ("packets", "bytes"))}
    return value


class Linux:
    def run(self, argv, stage, timeout=12):
        try:
            result = subprocess.run(argv, capture_output=True, timeout=timeout,
                                    env={**os.environ, "LC_ALL": "C"}, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise ProbeError(stage, "command_unavailable_or_timeout") from None
        # Never propagate commands, stderr, certificate/secret contents or raw
        # xfrm output into exception messages or public test results.
        if result.returncode or len(result.stdout) > MAX_OUTPUT:
            raise ProbeError(stage, "command_failed_or_output_limit")
        return result.stdout.decode("utf-8", errors="strict")

    def json(self, argv, stage, timeout=12):
        try:
            return json.loads(self.run(argv, stage, timeout))
        except (ValueError, UnicodeError):
            raise ProbeError(stage, "invalid_command_json") from None

    def host_snapshot(self):
        routes = [self.json(["ip", "-j", family, "route", "show", "table", "all"], "host_routes")
                  for family in ("-4", "-6")]
        rules = [self.json(["ip", "-j", family, "rule", "show"], "host_policy_rules")
                 for family in ("-4", "-6")]
        try:
            p = Path("/etc/resolv.conf")
            dns = {"sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                   "symlink": os.readlink(p) if p.is_symlink() else None}
        except OSError:
            raise ProbeError("host_dns", "cannot_read_dns_baseline") from None
        nft = self.json(["nft", "--json", "list", "ruleset"], "host_firewall")
        return {"routes": canonical_hash(routes), "policy_rules": canonical_hash(rules),
                "dns": canonical_hash(dns), "firewall": canonical_hash(stable_rules(nft))}

    def assert_isolated(self, namespace):
        expected = f"/run/netns/{namespace}"
        try:
            # A named namespace mount must refer to a different network ns.
            inode, current = os.stat(expected).st_ino, os.stat("/proc/self/ns/net").st_ino
        except OSError:
            raise ProbeError("namespace", "namespace_not_available") from None
        actual = self.run(["ip", "netns", "exec", namespace, "readlink", "/proc/self/ns/net"], "namespace").strip()
        if inode == current or actual != f"net:[{inode}]":
            raise ProbeError("namespace", "namespace_is_not_separate_from_host")
        return inode

    def http(self, namespace, interface, peer, port, inode):
        # Run the socket inside the selected netns; no shell or dynamic code.
        return self.json(["ip", "netns", "exec", namespace, sys.executable,
                          str(Path(__file__).resolve()), "_http", "--interface", interface,
                          "--peer", peer, "--port", str(port), "--inode", str(inode)], "http_data", 10)


def link_and_route(linux, namespace, interface, peer, protocol):
    links = linux.json(["ip", "-n", namespace, "-j", "-d", "link", "show", "dev", interface], "tunnel_link")
    if not isinstance(links, list) or len(links) != 1:
        raise ProbeError("tunnel_link", "one_tunnel_interface_required")
    link = links[0]
    is_ppp = link.get("link_type") == "ppp"
    is_tun = link.get("linkinfo", {}).get("info_kind") == "tun"
    if "UP" not in link.get("flags", []) or not (is_tun if protocol == "openvpn" else is_ppp):
        raise ProbeError("tunnel_link", "real_up_protocol_tunnel_required_dev_null_is_not_data_plane")
    routes = linux.json(["ip", "-n", namespace, "-j", "route", "get", peer], "tunnel_route")
    if not isinstance(routes, list) or len(routes) != 1 or routes[0].get("dev") != interface:
        raise ProbeError("tunnel_route", "peer_route_bypasses_selected_tunnel")
    return {"ifindex": link.get("ifindex"), "mtu": link.get("mtu"), "kind": "tun" if is_tun else "ppp"}


def xfrm_summary(text, reqid):
    # Always request `nokeys` from iproute2. Only return numeric counters and
    # state counts; never return captured text even if a host prints extra data.
    states = re.split(r"(?m)^src ", text)
    count = packets = 0
    for state in states:
        if not re.search(rf"\bproto esp\b[^\n]*\breqid {reqid}\b[^\n]*\bmode transport\b", state):
            continue
        count += 1
        match = re.search(r"lifetime current:\s*[^\n]*?([0-9]+)\(packets\)", state)
        if match:
            packets += int(match.group(1))
    return {"esp_transport_states": count, "packets": packets}


def probe(linux, namespace, interface, peer, port, protocol, reqid=902):
    validate(namespace, interface, peer, port)
    if protocol not in PROTOCOLS or not 1 <= reqid <= 2**32 - 1:
        raise ProbeError("arguments", "invalid_protocol_or_reqid")
    inode = linux.assert_isolated(namespace)
    before = linux.host_snapshot()
    result = {"schema": "mp716-vpn-netns-probe/v1", "protocol_selected_by_operator": protocol,
              "namespace": namespace, "interface": interface, "data_plane_passed": False,
              "protocol_identity_or_authentication_attested": False,
              "device_api_called": False, "services_started": False,
              "configuration_commands_executed": False, "credentials_read": False}
    failure = None
    try:
        result["tunnel"] = link_and_route(linux, namespace, interface, peer, protocol)
        start = None
        if protocol == "l2tp-ipsec":
            start = xfrm_summary(linux.run(["ip", "-n", namespace, "-s", "xfrm", "state", "list", "nokeys"], "xfrm_before"), reqid)
            if start["esp_transport_states"] < 2:
                raise ProbeError("xfrm_before", "two_transport_esp_states_required")
        ping = linux.run(["ip", "netns", "exec", namespace, "ping", "-n", "-c", "3", "-W", "2", "-I", interface, peer], "icmp_data", 12)
        if not re.search(r"3 packets transmitted, 3 (?:packets )?received, 0% packet loss", ping):
            raise ProbeError("icmp_data", "three_bidirectional_icmp_responses_required")
        result["icmp_sent"] = result["icmp_received"] = 3
        http = linux.http(namespace, interface, peer, port, inode)
        if not (http.get("same_namespace") is True and http.get("bound_to_interface") == interface
                and 200 <= http.get("http_status", 0) < 400 and http.get("received_bytes", 0) > 0):
            raise ProbeError("http_data", "bound_tunnel_http_response_required")
        result["http"] = {k: http[k] for k in ("http_status", "received_bytes", "bound_to_interface")}
        if start is not None:
            end = xfrm_summary(linux.run(["ip", "-n", namespace, "-s", "xfrm", "state", "list", "nokeys"], "xfrm_after"), reqid)
            if end["esp_transport_states"] < 2 or end["packets"] <= start["packets"]:
                raise ProbeError("xfrm_after", "encrypted_transport_packet_growth_required")
            result["ipsec"] = {"reqid": reqid, "esp_transport_states": end["esp_transport_states"],
                               "packet_delta": end["packets"] - start["packets"]}
        result["data_plane_passed"] = True
    except ProbeError as error:
        failure = error
    finally:
        after = linux.host_snapshot()
        result["host_unchanged"] = {key: before[key] == after[key] for key in before}
        if not all(result["host_unchanged"].values()):
            result["data_plane_passed"] = False
            failure = ProbeError("host_guard", "routing_dns_or_firewall_changed_do_not_blindly_restore")
    if failure:
        result.update(status="FAIL", failed_stage=failure.stage, failure_reason=failure.reason)
    else:
        result["status"] = "DATA_PLANE_PASS_AUTHENTICATION_REQUIRES_INDEPENDENT_EVIDENCE"
    return result


def socket_probe(interface, peer, port, inode):
    """Internal worker: no files, secret inputs, HTTP auth or redirects."""
    validate("mp716-vpn-00000000", interface, peer, port)
    if sys.platform != "linux" or os.stat("/proc/self/ns/net").st_ino != inode:
        raise ProbeError("http_data", "network_namespace_identity_changed")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(4)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, interface.encode() + b"\0")
        sock.connect((peer, port))
        sock.sendall(b"GET / HTTP/1.0\r\nHost: mp716-vpn-lab\r\nConnection: close\r\n\r\n")
        data = sock.recv(8192)
    match = re.match(rb"HTTP/1\.[01] ([0-9]{3})\b", data)
    return {"same_namespace": True, "bound_to_interface": interface,
            "http_status": int(match[1]) if match else 0, "received_bytes": len(data)}


def plan():
    return {"schema": "mp716-vpn-netns-plan/v1", "executed": False,
            "test_matrix": ["MP716 PPTP server <-> Linux PPP client", "MP716 PPTP client <-> isolated Linux PPTPD",
                            "MP716 L2TP server/client <-> isolated XL2TPD", "L2TP/IPsec: IKEv1 PSK transport + ESP packet counters",
                            "MP716 OpenVPN TUN client <-> isolated certificate-authenticated OpenVPN server"],
            "requires": ["Linux iproute2, nft, iputils ping and a pre-established, distinct mp716-vpn-<hex> netns",
                         "A real up pppN or tunN/tun-mp716 device; dev null cannot pass",
                         "Independent peer authentication plus MP716 online/runtime evidence; this probe does not infer it"],
            "peer_preparation_policy": ["Dedicated wired underlay/macvlan; do not move or reconfigure host management NIC",
                                        "PPP global chap-secrets and hooks must be confined to private mount namespace",
                                        "Keep credentials in private tmpfs; never print passwords/PSKs/private keys",
                                        "PPTP routeType=0, empty static routes; no default route or peer DNS",
                                        "OpenVPN no redirect-gateway/DNS pushes; use route-nopull for test client",
                                        "No router API automation, service startup, package installation or Flash action in this tool"],
            "usage": "sudo python3 scripts/vpn-netns-probe.py probe --protocol pptp --namespace mp716-vpn-a1b2c3d4 --interface ppp0 --peer 10.71.60.1"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("plan")
    p = sub.add_parser("probe")
    p.add_argument("--protocol", choices=PROTOCOLS, required=True)
    p.add_argument("--namespace", required=True)
    p.add_argument("--interface", required=True)
    p.add_argument("--peer", required=True)
    p.add_argument("--port", type=int, default=80)
    p.add_argument("--xfrm-reqid", type=int, default=902)
    worker = sub.add_parser("_http", help=argparse.SUPPRESS)
    for flag in ("interface", "peer"):
        worker.add_argument("--" + flag, required=True)
    worker.add_argument("--port", type=int, required=True)
    worker.add_argument("--inode", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        if args.action == "plan":
            result = plan()
        elif args.action == "_http":
            result = socket_probe(args.interface, args.peer, args.port, args.inode)
        else:
            if sys.platform != "linux":
                raise ProbeError("platform", "linux_peer_required_no_device_command_executed")
            result = probe(Linux(), args.namespace, args.interface, args.peer, args.port, args.protocol, args.xfrm_reqid)
    except (ProbeError, OSError) as error:
        result = {"status": "FAIL", "failed_stage": error.stage if isinstance(error, ProbeError) else "http_data",
                  "failure_reason": error.reason if isinstance(error, ProbeError) else "socket_failed"}
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 1 if result.get("status") == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())
