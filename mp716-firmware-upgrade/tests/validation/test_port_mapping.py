"""Pure offline switch correlation tests; no SSH/socket/WLAN/device operation."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("mp716_port_mapping", ROOT / "scripts/mp716-port-map.py")
PORTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PORTS)
BOOT = "01234567-0123-4567-89ab-0123456789ab"
MAC = "02:11:22:33:44:55"
HELP = "switch0: rt305x(rt305x-esw), ports: 7 (cpu @ 6), vlans: 4096\n --vlan\n Attribute 1 (ports): ports (VLAN port mapping)\n --port\n"
SHOW = "Global attributes:\n enable_vlan: 1\nVLAN 1:\n ports: 0 1 2 3 5 6t\nVLAN 2:\n ports: 4 6t\n"


def raw(up=(3, 4, 6), uptime=100):
    def record(text, code=0):
        return {"exit_code": code, "stdout": text, "stderr": ""}
    commands = {"boot_before": record(BOOT), "boot_after": record(BOOT),
                "uptime_before": record(str(uptime) + " 0"), "uptime_after": record(str(uptime + 1) + " 0"),
                "board": record(json.dumps({"board_name": "yunxm,mp716"})),
                "board_config": record(json.dumps({"network": {"lan": {"macaddr": "02:AA:BB:CC:DD:EE"}}})),
                "help": record(HELP), "show_before": record(SHOW), "show_after": record(SHOW),
                "arl": record("", 255)}
    for port in range(7):
        link = f"port:{port} link:" + (f"up speed:{1000 if port == 6 else 100}baseT full-duplex " if port in up else "down")
        for phase in ("before", "after"):
            commands[f"link_{phase}:{port}"] = record(link)
    return {"schema": PORTS.RAW_SCHEMA, "ports": list(range(7)), "cpu_ports": [6],
            "control_mac": MAC, "host_key_sha256": "a" * 64, "commands": commands}


class PortMappingTests(unittest.TestCase):
    def test_real_rt305x_shape_and_unsupported_arl_are_preserved(self):
        value = PORTS.snapshot(raw())
        self.assertTrue(value["stable"])
        self.assertFalse(value["arl_known"])
        self.assertEqual(value["links"]["5"]["state"], "down")
        self.assertEqual(value["vlans"][1], {"vid": 2, "members": [{"port": 4, "tagged": False}, {"port": 6, "tagged": True}]})

    def test_unknown_link_is_unknown_never_down(self):
        value = raw(); value["commands"]["link_after:2"]["stdout"] = "driver returned something new"
        parsed = PORTS.snapshot(value)
        self.assertFalse(parsed["stable"])
        self.assertEqual(parsed["links"]["2"]["state"], "unknown")
        self.assertIsNone(parsed["links"]["2"]["speed_mbps"])

    def test_failed_link_command_cannot_supply_a_down_proof(self):
        value = raw(); value["commands"]["link_after:2"]["exit_code"] = 1
        self.assertFalse(PORTS.snapshot(value)["stable"])
        self.assertEqual(PORTS.compare(raw(), value)["status"], "INCONCLUSIVE")

    def test_incomplete_up_or_wrong_port_is_rejected(self):
        for text in ("port:0 link:up", "port:1 link:down", "port:0 link:down speed:100baseT full-duplex"):
            with self.subTest(text=text), self.assertRaises(ValueError): PORTS.parse_link(text, 0)

    def test_unknown_driver_needs_explicit_vid_not_index_guess(self):
        value = raw(); value["commands"]["help"]["stdout"] = "unknown switch driver"
        self.assertFalse(PORTS.snapshot(value)["stable"])
        with self.assertRaises(ValueError): PORTS.parse_vlans(SHOW)

    def test_explicit_vid_and_duplicate_member_validation(self):
        self.assertEqual(PORTS.parse_vlans("VLAN 0:\n vid: 12\n ports: 0 6t\n")[0]["vid"], 12)
        with self.assertRaises(ValueError): PORTS.parse_vlans("VLAN 0:\n vid: 12\n ports: 0 0 6t\n")

    def test_link_flap_within_capture_rejects_verification(self):
        second = raw(up=(1, 4, 6), uptime=200)
        second["commands"]["link_before:1"]["stdout"] = "port:1 link:down"
        result = PORTS.compare(raw(), second, transition="move", from_label="LAN4", to_label="LAN3", confirm=True)
        self.assertEqual(result["status"], "INCONCLUSIVE")
        self.assertEqual(result["verified_mappings"], [])

    def test_single_edge_with_label_stays_candidate_without_confirmation(self):
        result = PORTS.compare(raw(), raw(up=(4, 6), uptime=200), label="LAN4", transition="unplug")
        self.assertEqual(result["status"], "CANDIDATE")
        self.assertFalse(result["candidate"]["mappingVerified"])
        self.assertEqual(result["verified_mappings"], [])

    def test_single_edge_manual_verified_does_not_label_p4_wan(self):
        result = PORTS.compare(raw(), raw(up=(4, 6), uptime=200), label="LAN4", transition="unplug", confirm=True)
        self.assertEqual([(r["label"], r["switch_port"]) for r in result["verified_mappings"]], [("LAN4", 3)])
        self.assertFalse(result["mapping_complete"])

    def test_move_two_edges_and_explicit_two_labels(self):
        result = PORTS.compare(raw(), raw(up=(1, 4, 6), uptime=200), transition="move",
                               from_label="LAN4", to_label="LAN3", confirm=True)
        self.assertEqual(result["status"], "VERIFIED")
        self.assertEqual({r["label"]: r["switch_port"] for r in result["verified_mappings"]}, {"LAN4": 3, "LAN3": 1})
        self.assertFalse(result["mapping_complete"])
        self.assertFalse(result["hardware_acceptance_complete"])

    def test_move_without_human_labels_remains_unverified(self):
        result = PORTS.compare(raw(), raw(up=(1, 4, 6), uptime=200), transition="move")
        self.assertEqual(result["status"], "CANDIDATE")
        self.assertTrue(all(not r["mappingVerified"] for r in result["candidates"]))
        with self.assertRaises(ValueError): PORTS.compare(raw(), raw(), transition="move", confirm=True)

    def test_move_wrong_edges_extra_link_or_speed_change_refused(self):
        for second in (raw(up=(0, 1, 4, 6), uptime=200), raw(up=(1, 3, 4, 6), uptime=200)):
            self.assertEqual(PORTS.compare(raw(), second, transition="move")["status"], "INCONCLUSIVE")
        second = raw(up=(1, 4, 6), uptime=200)
        for phase in ("before", "after"):
            second["commands"][f"link_{phase}:4"]["stdout"] = "port:4 link:up speed:10baseT half-duplex"
        self.assertEqual(PORTS.compare(raw(), second, transition="move")["status"], "INCONCLUSIVE")

    def test_wrong_declared_transition_refused(self):
        self.assertEqual(PORTS.compare(raw(), raw(up=(4, 6), uptime=200), transition="plug")["status"], "INCONCLUSIVE")

    def test_cpu_or_p5_edges_never_front_panel_verified(self):
        for up in ((3, 4), (3, 4, 5, 6)):
            result = PORTS.compare(raw(), raw(up=up, uptime=200), label="WAN", transition="unplug" if 6 not in up else "plug", confirm=True)
            self.assertEqual(result["status"], "INCONCLUSIVE")

    def test_identity_and_order_must_match(self):
        for field, value in (("host_key_sha256", "b" * 64), ("control_mac", "02:00:00:00:00:01")):
            second = raw(up=(4, 6), uptime=200); second[field] = value
            self.assertEqual(PORTS.compare(raw(), second)["status"], "INCONCLUSIVE")
        second = raw(up=(4, 6), uptime=200)
        second["commands"]["board_config"]["stdout"] = '{"network":{"lan":{"macaddr":"02:00:00:00:00:02"}}}'
        self.assertEqual(PORTS.compare(raw(), second)["status"], "INCONCLUSIVE")
        self.assertEqual(PORTS.compare(raw(), raw(up=(4, 6), uptime=99))["status"], "INCONCLUSIVE")

    def test_changed_boot_and_vlan_fail_closed(self):
        second = raw(); second["commands"]["boot_after"]["stdout"] = BOOT[:-1] + "0"
        with self.assertRaises(ValueError): PORTS.snapshot(second)
        second = raw(up=(4, 6), uptime=200)
        for key in ("show_before", "show_after"): second["commands"][key]["stdout"] = SHOW.replace("ports: 4 6t", "ports: 3 4 6t")
        self.assertEqual(PORTS.compare(raw(), second)["status"], "INCONCLUSIVE")

    def test_arl_control_mac_is_only_corroboration(self):
        first, second = raw(), raw(uptime=200)
        first["commands"]["arl"] = {"exit_code": 0, "stdout": f"mac:{MAC} vlan:1 ports:3,6"}
        parsed = PORTS.snapshot(first)
        self.assertTrue(parsed["arl_known"])
        self.assertEqual(parsed["control_mac_arl_ports"], [3, 6])
        self.assertEqual(PORTS.compare(first, second)["status"], "INCONCLUSIVE")
        with self.assertRaises(ValueError): PORTS.parse_arl("portmask=0x08 mac=001122334455")

    def test_existing_mapping_conflicts_rejected_without_mutation(self):
        before, after = raw(), raw(up=(1, 4, 6), uptime=200)
        old = PORTS.compare(before, after, transition="move", from_label="LAN4", to_label="LAN3", confirm=True)
        untouched = copy.deepcopy(old)
        with self.assertRaises(ValueError):
            PORTS.compare(after, raw(up=(0, 4, 6), uptime=300), transition="move", from_label="LAN4", to_label="LAN2", confirm=True, previous=old)
        self.assertEqual(old, untouched)

    def test_session_uses_one_password_but_fresh_sample_calls_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = type("Args", (), dict(output_dir=temporary, host="192.0.2.1", user="root", known_hosts="unused",
                                       control_mac=MAC, source_address="192.0.2.2", interface_index=9))()
            fake = {"raw": raw(), "parsed": PORTS.snapshot(raw())}
            lines = '{"command":"sample","label":"before"}\n{"command":"sample","label":"before"}\n{"command":"sample","label":"after"}\n{"command":"quit"}\n'
            with patch.object(PORTS.getpass, "getpass", return_value="fake-only") as password, \
                 patch.object(PORTS, "capture", return_value=fake) as capture, \
                 patch.object(PORTS.sys, "stdin", io.StringIO(lines)), patch("sys.stdout", new_callable=io.StringIO) as output:
                self.assertEqual(PORTS.sample_session(args), 0)
            self.assertEqual(password.call_count, 1)
            self.assertEqual(capture.call_count, 2)
            self.assertTrue((Path(temporary) / "before.json").is_file())
            self.assertIn('"event": "SAMPLE_REFUSED"', output.getvalue())
            self.assertNotIn("fake-only", output.getvalue())


if __name__ == "__main__":
    unittest.main()
