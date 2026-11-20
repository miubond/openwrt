#!/usr/bin/env python3
"""Read-only MP716 switch evidence; never infer chassis labels from VLAN roles.

capture requires an explicit SSH host, pinned known_hosts and trusted PC MAC.
compare is offline. A label alone is insufficient: --confirm-physical-label and
the declared plug/unplug transition must match one unique stable link change.
Unknown link/ARL formats remain unknown. No device configuration is written.
"""
import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import ipaddress
import json
import math
from pathlib import Path
import re
import socket
import struct
import sys

RAW_SCHEMA = "mp716-switch-raw/v1"
REPORT_SCHEMA = "mp716-port-map/v1"
LABELS = {"LAN1", "LAN2", "LAN3", "LAN4", "WAN"}
DEFAULT_PORTS = tuple(range(7))


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def mac_address(value):
    require(isinstance(value, str) and re.fullmatch(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", value),
            "Expected an explicit colon-separated MAC")
    value = value.upper()
    require(not int(value[:2], 16) & 1 and value != "00:00:00:00:00:00", "Expected a unicast control MAC")
    return value


def port_list(value):
    require(isinstance(value, list) and value and all(type(p) is int and 0 <= p <= 31 for p in value)
            and len(value) == len(set(value)), "Invalid/duplicate switch port list")
    return sorted(value)


def parse_link(text, expected_port):
    """Accept only explicit swconfig port/link records, including explicit down."""
    require(isinstance(text, str), "Missing link output")
    match = re.fullmatch(r"(?:link:\s*)?port:(\d+)\s+link:(up|down)"
                         r"(?:\s+speed:(10|100|1000|2500|5000|10000)baseT"
                         r"\s+(full-duplex|half-duplex)(?:\s+(?:auto|txflow|rxflow))*)?", text.strip())
    require(match and int(match[1]) == expected_port, "Unknown/mismatched swconfig link format")
    require((match[2] == "up") == (match[3] is not None), "Incomplete or contradictory link state")
    return {"state": match[2], "speed_mbps": int(match[3]) if match[3] else None,
            "duplex": match[4]}


def parse_vlans(text, *, rt305x_index_is_vid=False):
    """Parse explicit VID and member tokens from swconfig show VLAN sections."""
    require(isinstance(text, str), "Missing VLAN output")
    blocks = list(re.finditer(r"^VLAN\s+(\d+):\s*$", text, re.M))
    require(blocks, "No explicit VLAN sections")
    result, indices = [], set()
    for i, item in enumerate(blocks):
        index = int(item[1])
        require(index not in indices, "Duplicate VLAN table index")
        indices.add(index)
        body = text[item.end():blocks[i + 1].start() if i + 1 < len(blocks) else len(text)]
        vids = re.findall(r"^\s*vid:\s*(\d+)\s*$", body, re.M)
        members = re.findall(r"^\s*ports:\s*([^\r\n]*)$", body, re.M)
        if not vids and rt305x_index_is_vid:
            vids = [str(index)]
        require(len(vids) == len(members) == 1 and 1 <= int(vids[0]) <= 4094,
                "Missing/duplicate/invalid VID or members")
        ports = []
        for token in members[0].split():
            match = re.fullmatch(r"(\d+)(t)?", token)
            require(match and 0 <= int(match[1]) <= 31, "Unknown VLAN member token")
            ports.append({"port": int(match[1]), "tagged": bool(match[2])})
        require(ports and len({p["port"] for p in ports}) == len(ports), "Empty/duplicate VLAN members")
        result.append({"vid": int(vids[0]), "members": sorted(ports, key=lambda p: p["port"])})
    require(len({row["vid"] for row in result}) == len(result), "Duplicate VID")
    return sorted(result, key=lambda row: row["vid"])


def parse_arl(text):
    """Narrow named-record format only; opaque driver output is not guessed.

Accepted rows explicitly say mac:xx:.. vlan:N port:N or ports:N,N. This does
not claim every MT7628 driver implements arl_table or emits this format.
Unsupported/empty/table/bitmap output must remain unknown with raw evidence.
"""
    require(isinstance(text, str) and text.strip(), "ARL output is unavailable/empty")
    if text.strip() == "No ARL entries":
        return []
    rows = []
    for line in text.splitlines():
        match = re.fullmatch(r"\s*mac:\s*((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})"
                             r"\s+vlan:\s*(\d+)\s+ports?:\s*(\d+(?:,\d+)*)\s*", line)
        require(match, "Unknown ARL format; no bitmap/column inference")
        require(1 <= int(match[2]) <= 4094, "Invalid ARL VLAN")
        rows.append({"mac": mac_address(match[1]), "vid": int(match[2]),
                     "ports": port_list([int(p) for p in match[3].split(",")])})
    return rows


def command_text(commands, name):
    row = commands.get(name)
    require(isinstance(row, dict) and type(row.get("exit_code")) is int
            and row["exit_code"] == 0 and isinstance(row.get("stdout"), str),
            "Command failed/missing: " + name)
    return row["stdout"]


def snapshot(raw):
    require(isinstance(raw, dict) and raw.get("schema") == RAW_SCHEMA, "Unrecognized raw snapshot schema")
    ports = port_list(raw.get("ports"))
    cpus = port_list(raw.get("cpu_ports"))
    require(set(cpus) < set(ports), "CPU ports must be an explicit subset")
    control = mac_address(raw.get("control_mac"))
    key = raw.get("host_key_sha256", "")
    require(isinstance(key, str) and re.fullmatch(r"[a-f0-9]{64}", key), "Missing pinned SSH host key fingerprint")
    commands = raw.get("commands")
    require(isinstance(commands, dict), "Missing command records")
    boot = command_text(commands, "boot_before").strip()
    require(re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", boot)
            and command_text(commands, "boot_after").strip() == boot, "Boot changed/invalid during sample")
    board = json.loads(command_text(commands, "board"))
    require(isinstance(board, dict) and board.get("board_name") == "yunxm,mp716", "Unexpected board")
    board_config = json.loads(command_text(commands, "board_config"))
    require(isinstance(board_config, dict), "Missing board configuration identity")
    device_mac = mac_address(board_config.get("network", {}).get("lan", {}).get("macaddr"))
    times = []
    for name in ("uptime_before", "uptime_after"):
        values = command_text(commands, name).split()
        require(values and re.fullmatch(r"\d+(?:\.\d+)?", values[0]), "Invalid uptime")
        value = float(values[0])
        require(math.isfinite(value) and 0 <= value < 1e12, "Invalid uptime range")
        times.append(value)
    require(0 <= times[1] - times[0] <= 60, "Non-monotonic or excessively long sample")
    errors, links = [], {}
    for port in ports:
        try:
            first = parse_link(command_text(commands, f"link_before:{port}"), port)
            second = parse_link(command_text(commands, f"link_after:{port}"), port)
            require(first == second, "Link changed within sample")
            links[str(port)] = first
        except ValueError as error:
            links[str(port)] = {"state": "unknown", "speed_mbps": None, "duplex": None}
            errors.append({"port": port, "error": str(error)})
    vlans = None
    try:
        # rt305x's 4096-entry table exposes no remapped VID attribute. Only
        # its exact help identity allows the printed VLAN index as the VID;
        # generic drivers still require an explicit vid field.
        help_text = command_text(commands, "help")
        rt305x = bool(re.search(r"^switch0: rt305x\(rt305x-esw\), ports: 7 \(cpu @ 6\), vlans: 4096\s*$",
                               help_text, re.M))
        require(not rt305x or ports == list(DEFAULT_PORTS) and cpus == [6],
                "The sampled port set disagrees with the rt305x help identity")
        vlans = parse_vlans(command_text(commands, "show_before"), rt305x_index_is_vid=rt305x)
        require(vlans == parse_vlans(command_text(commands, "show_after"), rt305x_index_is_vid=rt305x), "VLANs changed within sample")
        require(all(p["port"] in ports for v in vlans for p in v["members"]), "VLAN names an unsampled port")
    except ValueError as error:
        errors.append({"field": "vlans", "error": str(error)})
        vlans = None
    arl, arl_error = None, None
    try:
        arl = parse_arl(command_text(commands, "arl"))
        require(all(p in ports for row in arl for p in row["ports"]), "ARL names an unsampled port")
    except ValueError as error:
        arl, arl_error = None, str(error)
    control_ports = sorted({p for row in arl or [] if row["mac"] == control for p in row["ports"]})
    return {"schema": "mp716-switch-snapshot/v1", "raw_sha256": digest(raw), "boot_id": boot,
            "board_name": board["board_name"], "device_mac": device_mac, "host_key_sha256": key, "switch": "switch0",
            "control_mac": control, "ports": ports, "cpu_ports": cpus,
            "uptime_before": times[0], "uptime_after": times[1], "links": links, "vlans": vlans,
            "stable": not errors, "errors": errors, "arl_known": arl is not None,
            "arl_error": arl_error, "control_mac_arl_ports": control_ports,
            "arl_is_corrob_or_stale_only": True, "mappingVerified": False}


def compare(before_raw, after_raw, *, label=None, transition=None, confirm=False,
            from_label=None, to_label=None, previous=None):
    before, after = snapshot(before_raw), snapshot(after_raw)
    if label is not None:
        require(label in LABELS, "Only an explicitly observed LAN1..LAN4/WAN chassis label is accepted")
    require(transition in (None, "plug", "unplug", "move"), "Unknown physical action")
    moving = transition == "move"
    require(from_label is None and to_label is None or moving and label is None
            and from_label in LABELS and to_label in LABELS and from_label != to_label,
            "Move labels require two distinct explicitly observed chassis labels")
    require(not moving or label is None, "A move requires from/to labels, not one label")
    require(not confirm or (from_label in LABELS and to_label in LABELS if moving
                            else label is not None and transition is not None),
            "Verification requires explicit chassis label and plug/unplug attestation")
    reasons = []
    for key in ("board_name", "device_mac", "boot_id", "host_key_sha256", "switch", "control_mac", "ports", "cpu_ports"):
        if before[key] != after[key]:
            reasons.append("identity_changed:" + key)
    if not before["stable"] or not after["stable"]:
        reasons.append("unknown_or_unstable_sample")
    if after["uptime_before"] < before["uptime_after"]:
        reasons.append("overlapping_or_reversed_samples")
    if before["vlans"] != after["vlans"] or before["vlans"] is None:
        reasons.append("unknown_or_changed_vlans")
    changes = [{"port": p, "before": before["links"].get(str(p)), "after": after["links"].get(str(p))}
               for p in before["ports"] if before["links"].get(str(p)) != after["links"].get(str(p))]
    candidates = []
    expected_count = 2 if moving else 1
    if len(changes) != expected_count:
        reasons.append("expected_one_unplug_and_one_plug" if moving else "expected_exactly_one_link_change")
    changes_with_actions = []
    for row in changes:
        edge = (row["before"]["state"], row["after"]["state"]) if row["after"] else None
        action = "unplug" if edge == ("up", "down") else "plug" if edge == ("down", "up") else None
        changes_with_actions.append((row, action))
        if row["port"] in before["cpu_ports"]:
            reasons.append("cpu_port_is_not_a_chassis_mapping")
        elif row["port"] not in range(5):
            reasons.append("outside_front_panel_candidate_ports")
        if action is None:
            reasons.append("not_an_explicit_up_down_transition")
        if not moving and transition is not None and action != transition:
            reasons.append("declared_action_does_not_match")
    if moving and sorted(action or "unknown" for _, action in changes_with_actions) != ["plug", "unplug"]:
        reasons.append("move_requires_one_down_edge_and_one_up_edge")
    if not reasons:
        for row, action in changes_with_actions:
            observed_label = from_label if moving and action == "unplug" else to_label if moving else label
            candidates.append({"switch_port": row["port"], "transition": action,
                               "logical_vlan_ids": [v["vid"] for v in before["vlans"]
                                                    if any(p["port"] == row["port"] for p in v["members"])],
                               "label": observed_label, "mappingVerified": bool(confirm),
                               "evidence": {"before_sha256": before["raw_sha256"],
                                            "after_sha256": after["raw_sha256"],
                                            "physical_action": "move" if moving else action,
                                            "manual_label_confirmed": bool(confirm)}})
    mappings = []
    if previous is not None:
        require(isinstance(previous, dict) and previous.get("schema") == REPORT_SCHEMA
                and previous.get("device_identity") == {k: before[k] for k in
                    ("board_name", "device_mac", "boot_id", "host_key_sha256", "control_mac")},
                "Existing mapping belongs to another device/boot/control host")
        mappings = list(previous.get("verified_mappings", []))
    require(all(isinstance(m, dict) and m.get("mappingVerified") is True and m.get("label") in LABELS
                and type(m.get("switch_port")) is int and m["switch_port"] in before["ports"]
                and m["switch_port"] not in before["cpu_ports"]
                and isinstance(m.get("evidence"), dict) and m["evidence"].get("manual_label_confirmed") is True
                and all(re.fullmatch(r"[a-f0-9]{64}", m["evidence"].get(k, ""))
                        for k in ("before_sha256", "after_sha256")) for m in mappings), "Invalid existing verified mappings")
    for candidate in candidates if confirm else []:
        for old in mappings:
            require(old["label"] != candidate["label"] or old["switch_port"] == candidate["switch_port"], "Chassis label conflicts with an earlier mapping")
            require(old["switch_port"] != candidate["switch_port"] or old["label"] == candidate["label"], "Switch port conflicts with an earlier mapping")
        if not any(m["label"] == candidate["label"] for m in mappings):
            mappings.append(candidate)
    require(len({m["label"] for m in mappings}) == len(mappings)
            and len({m["switch_port"] for m in mappings}) == len(mappings), "Ambiguous existing mappings")
    if candidates and not confirm:
        reasons.append("manual_label_confirmation_required")
    return {"schema": REPORT_SCHEMA, "status": "VERIFIED" if candidates and confirm else "CANDIDATE" if candidates else "INCONCLUSIVE",
            "device_identity": {k: before[k] for k in ("board_name", "device_mac", "boot_id", "host_key_sha256", "control_mac")},
            "candidate": candidates[0] if len(candidates) == 1 else None,
            "candidates": candidates, "reasons": reasons, "link_changes": changes,
            "verified_mappings": sorted(mappings, key=lambda row: row["label"]),
            "mapping_complete": {m["label"] for m in mappings} == LABELS,
            "arl_evidence": {"before_known": before["arl_known"], "after_known": after["arl_known"],
                             "before_control_ports": before["control_mac_arl_ports"],
                             "after_control_ports": after["control_mac_arl_ports"],
                             "alone_proves_mapping": False},
            "before": before, "after": after, "device_configuration_written": False,
            "flash_write": False, "reboot": False, "hardware_acceptance_complete": False}


def capture(host, username, known_hosts, control_mac, source_address, *, interface_index=None, password=None):
    """Only fixed read-only commands; unknown SSH host keys are rejected."""
    import paramiko  # Optional dependency, only needed for explicit capture.
    ipaddress.IPv4Address(host)
    ipaddress.IPv4Address(source_address)
    require(re.fullmatch(r"[a-z_][a-z0-9_-]*", username), "Invalid SSH username")
    control_mac = mac_address(control_mac)
    require(Path(known_hosts).is_file(), "A pinned known_hosts file is required")
    require(interface_index is None or type(interface_index) is int and 0 < interface_index < 65536
            and sys.platform == "win32", "Interface-index binding requires a valid Windows interface")
    if password is None:
        password = getpass.getpass("MP716 SSH password (memory only): ")
    client = paramiko.SSHClient()
    client.load_host_keys(str(known_hosts))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as transport:
            transport.settimeout(10)
            if interface_index is not None:
                transport.setsockopt(socket.IPPROTO_IP, 31, struct.pack("!I", interface_index))
            transport.bind((source_address, 0))
            transport.connect((host, 22))
            client.connect(host, username=username, password=password, timeout=10,
                           allow_agent=False, look_for_keys=False, sock=transport)
            result = capture_commands(client, control_mac)
            result["transport"] = {"source_ipv4": source_address, "interface_index": interface_index,
                                   "host_key_policy": "reject_unknown"}
            return result
    finally:
        password = None
        client.close()


def capture_commands(client, control_mac):
    """One connected, pinned SSH session; no shell fragments are supplied by callers."""
    key = client.get_transport().get_remote_server_key().asbytes()
    commands = [("boot_before", "cat /proc/sys/kernel/random/boot_id"),
                ("uptime_before", "cat /proc/uptime"), ("board", "ubus call system board"),
                ("board_config", "cat /etc/board.json"),
                ("help", "/sbin/swconfig dev switch0 help"),
                ("show_before", "/sbin/swconfig dev switch0 show")]
    commands += [(f"link_before:{p}", f"/sbin/swconfig dev switch0 port {p} get link") for p in DEFAULT_PORTS]
    commands += [("arl", "/sbin/swconfig dev switch0 get arl_table")]
    commands += [(f"link_after:{p}", f"/sbin/swconfig dev switch0 port {p} get link") for p in DEFAULT_PORTS]
    commands += [("show_after", "/sbin/swconfig dev switch0 show"),
                 ("uptime_after", "cat /proc/uptime"), ("boot_after", "cat /proc/sys/kernel/random/boot_id")]
    records = {}
    for name, command in commands:
        try:
            stdin, stdout, stderr = client.exec_command(command, timeout=5)
            stdin.close()
            out, err = stdout.read(262145), stderr.read(16385)
            require(len(out) <= 262144 and len(err) <= 16384, "Unexpectedly large SSH evidence")
            records[name] = {"command": command, "exit_code": stdout.channel.recv_exit_status(),
                             "stdout": out.decode("utf-8", errors="replace"), "stderr": err.decode("utf-8", errors="replace")}
        except Exception as error:
            records[name] = {"command": command, "exit_code": None, "stdout": "",
                             "stderr": "Read-only capture failed: " + type(error).__name__}
    raw = {"schema": RAW_SCHEMA, "captured_at": datetime.now(timezone.utc).isoformat(),
           "ports": list(DEFAULT_PORTS), "cpu_ports": [6], "control_mac": control_mac,
           "host_key_sha256": hashlib.sha256(key).hexdigest(), "commands": records}
    try:
        return {"raw": raw, "parsed": snapshot(raw)}
    except (ValueError, KeyError, TypeError) as error:
        return {"raw": raw, "parsed": None, "validation_error": str(error)}


def read_raw(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    return value["raw"] if isinstance(value, dict) and "raw" in value else value


def save_result(path, result):
    with Path(path).open("x", encoding="utf-8") as output:
        json.dump(result, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.write("\n")


def sample_session(args):
    """Explicit sample commands only; reconnect after cable movement, no writes."""
    directory = Path(args.output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    password = getpass.getpass("MP716 SSH password (memory only for this session): ")
    identity = None
    try:
        print(json.dumps({"ok": True, "event": "READY", "commands": ["sample(label)", "quit"],
                          "device_configuration_written": False}), flush=True)
        for line in sys.stdin:
            try:
                message = json.loads(line)
                require(isinstance(message, dict), "Expected JSON command object")
                if message.get("command") == "quit":
                    return 0
                require(message.get("command") == "sample", "Use sample(label) or quit")
                label = message.get("label", "")
                require(isinstance(label, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,47}", label), "Unsafe sample label")
                destination = directory / (label + ".json")
                require(not destination.exists(), "An existing sample must not be overwritten")
                result = capture(args.host, args.user, args.known_hosts, args.control_mac,
                                 args.source_address, interface_index=args.interface_index, password=password)
                parsed = result.get("parsed")
                current = {k: parsed[k] for k in ("board_name", "boot_id", "host_key_sha256", "control_mac")} if parsed else None
                if identity is not None and current != identity:
                    result["validation_error"] = "Session device/boot/control identity changed"
                if identity is None and parsed and parsed["stable"]:
                    identity = current
                save_result(destination, result)
                print(json.dumps({"ok": not result.get("validation_error") and bool(parsed and parsed["stable"]),
                                  "event": "SAMPLE_SAVED", "label": label, "output": str(destination),
                                  "stable": bool(parsed and parsed["stable"]),
                                  "arl_known": bool(parsed and parsed["arl_known"]),
                                  "device_configuration_written": False}), flush=True)
            except Exception as error:
                # Do not expose authentication data or arbitrary SSH exception bodies.
                print(json.dumps({"ok": False, "event": "SAMPLE_REFUSED", "error_type": type(error).__name__,
                                  "device_configuration_written": False}), flush=True)
        return 1
    finally:
        password = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    collect = modes.add_parser("capture", help="Explicit SSH read-only sample; no config writes")
    session = modes.add_parser("session", help="Getpass once; explicit sample(label) commands reconnect read-only SSH")
    for mode in (collect, session):
        mode.add_argument("--host", required=True)
        mode.add_argument("--user", default="root")
        mode.add_argument("--known-hosts", required=True)
        mode.add_argument("--control-mac", required=True)
        mode.add_argument("--source-address", required=True, help="Explicit local wired control IPv4")
        mode.add_argument("--interface-index", type=int, help="Optional Windows IP_UNICAST_IF binding")
    collect.add_argument("--output", required=True)
    session.add_argument("--output-dir", required=True)
    inspect = modes.add_parser("inspect", help="Parse local raw JSON, without SSH")
    inspect.add_argument("snapshot")
    inspect.add_argument("--output", required=True)
    diff = modes.add_parser("compare", help="Compare two local samples; labels require human attestation")
    diff.add_argument("before")
    diff.add_argument("after")
    diff.add_argument("--label", choices=sorted(LABELS))
    diff.add_argument("--transition", choices=["plug", "unplug", "move"])
    diff.add_argument("--from-label", choices=sorted(LABELS))
    diff.add_argument("--to-label", choices=sorted(LABELS))
    diff.add_argument("--confirm-physical-label", action="store_true")
    diff.add_argument("--previous", help="Previous mapping report from this same device/boot")
    diff.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        if args.mode == "session":
            return sample_session(args)
        require(not Path(args.output).exists(), "An existing output must not be overwritten")
        if args.mode == "capture":
            result = capture(args.host, args.user, args.known_hosts, args.control_mac, args.source_address,
                             interface_index=args.interface_index)
        elif args.mode == "inspect":
            result = snapshot(read_raw(args.snapshot))
        else:
            previous = json.loads(Path(args.previous).read_text()) if args.previous else None
            result = compare(read_raw(args.before), read_raw(args.after), label=args.label,
                             transition=args.transition, from_label=args.from_label, to_label=args.to_label,
                             confirm=args.confirm_physical_label, previous=previous)
        save_result(args.output, result)
        print(json.dumps({"ok": not result.get("validation_error"), "output": args.output, "device_configuration_written": False,
                          "flash_write": False, "reboot": False}))
        return 2 if result.get("validation_error") else 0
    except (ValueError, OSError, KeyError) as error:
        print(json.dumps({"ok": False, "error": str(error), "flash_write": False}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
