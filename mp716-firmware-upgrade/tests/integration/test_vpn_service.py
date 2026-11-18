"""Exercise service orchestration with every service/network/mount command stubbed."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'integration/ram-web/mp716-vpn.init'
BASH = shutil.which('bash') or (r'D:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else None)

def shell_path(path):
    value=path.resolve().as_posix()
    return '/'+value[0].lower()+value[2:] if len(value)>1 and value[1]==':' else value

@unittest.skipUnless(BASH and Path(BASH).is_file(), 'bash not available')
class VpnServiceTests(unittest.TestCase):
    def exercise(self, enabled=False, guard='', reject_guard=False, mount_fail=False, pptp_client=False, l2tp_client=False, fifo_ready=True):
        parent=ROOT/'build/vpn-service-fixtures';parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            root=Path(temporary);(root/'runtime').mkdir();(root/'chap-secrets').write_text('legacy account remains\n')
            script=SOURCE.read_text().replace('/usr/bin/ucode','mock_ucode').replace('/bin/ubus','mock_ubus').replace('/etc/init.d/firewall','mock_firewall')
            script=script.replace('/etc/ppp/chap-secrets',shell_path(root/'chap-secrets'))
            script=script.replace('/var/run/xl2tpd',shell_path(root/'xl2tpd'))
            (root/'xl2tpd').mkdir()
            fifo=root/'xl2tpd/l2tp-control'
            if fifo_ready:
                if os.name=='nt':
                    # MSYS cannot create a native Windows FIFO. The Linux CI
                    # exercises the real -p readiness check with os.mkfifo.
                    fifo.write_text('')
                    script=script.replace('[ ! -p ', '[ ! -f ')
                else:os.mkfifo(fifo,0o600)
            (root/'service.sh').write_text(script,newline='\n')
            harness=r'''
set -eu
source "$STAGE/service.sh"
runtime="$STAGE/runtime"
events="$STAGE/events"
touch "$events"; printf 'managed credentials\n' > "$runtime/chap-secrets"
printf 'table inet mp716_vpn_guard {}\n' > "$runtime/guard.nft"
json_value() { case "$1" in guard) printf '%s\n' "$GUARD" ;; pptpClient) printf '%s\n' "$PPTP_CLIENT" ;; l2tpClient) printf '%s\n' "$L2TP_CLIENT" ;; l2tp) printf '%s\n' "$L2TP_DAEMON" ;; *) printf '%s\n' "$ENABLED" ;; esac; }
mock_ucode() { printf 'render\n' >> "$events"; }
mock_ubus() { printf 'network %s\n' "$*" >> "$events"; }
mock_firewall() { printf 'firewall\n' >> "$events"; }
sleep() { :; }
mount() { printf 'mount %s\n' "$*" >> "$events"; [ "$MOUNT_FAIL" != 1 ]; }
umount() { printf 'umount %s\n' "$*" >> "$events"; }
nft() {
 printf 'nft %s\n' "$*" >> "$events"
 case "$1" in list) return 1 ;; esac
 if [ "$REJECT_GUARD" = 1 ] && [ "${2:-}" = "$runtime/guard-apply.nft" ]; then return 1; fi
}
logger() { :; }
procd_open_instance() { printf 'instance %s\n' "$1" >> "$events"; }
procd_set_param() { printf 'procd %s\n' "$*" >> "$events"; }
procd_close_instance() { :; }
status=0; start_service || status=$?
wait
printf '%s\n' "$status" > "$STAGE/status"
'''
            env={**os.environ,'STAGE':shell_path(root),'ENABLED':'true' if enabled else 'false','GUARD':guard,'REJECT_GUARD':'1' if reject_guard else '0','MOUNT_FAIL':'1' if mount_fail else '0',
                 'PPTP_CLIENT':'true' if pptp_client else 'false','L2TP_CLIENT':'true' if l2tp_client else 'false','L2TP_DAEMON':'true' if enabled or l2tp_client else 'false'}
            result=subprocess.run([BASH,'-c',harness],env=env,text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            return (root/'events').read_text(),int((root/'status').read_text()),(root/'chap-secrets').read_text(),(root/'runtime/chap-target').exists()

    def test_disabled_services_do_not_mount_or_launch_instances(self):
        events,status,chap,mounted=self.exercise()
        self.assertEqual(status,0);self.assertNotIn('instance ',events);self.assertNotIn('mount ',events)
        self.assertNotIn('network ',events);self.assertNotIn('firewall\n',events)
        self.assertEqual(chap,'legacy account remains\n');self.assertFalse(mounted)

    def test_service_plan_preserves_secrets_and_keeps_commands_in_procd(self):
        events,status,chap,mounted=self.exercise(True,'input')
        self.assertEqual(status,0);self.assertTrue(mounted);self.assertEqual(chap,'legacy account remains\n')
        for name in ['pptp','l2tp','ipsec','openvpn']:self.assertIn('instance '+name,events)
        self.assertLess(events.index('guard-deny.nft'),events.index('instance pptp'))
        self.assertIn('STRONGSWAN_CONF=',events)

    def test_missing_xfrm_fails_closed_before_starting_any_service(self):
        events,status,chap,mounted=self.exercise(True,'input',True)
        self.assertNotEqual(status,0);self.assertIn('guard-deny.nft',events);self.assertNotIn('instance ',events)
        self.assertFalse(mounted);self.assertEqual(chap,'legacy account remains\n')

    def test_mount_failure_does_not_mark_secrets_as_mounted(self):
        events,status,chap,mounted=self.exercise(True,'',False,True)
        self.assertNotEqual(status,0);self.assertFalse(mounted);self.assertNotIn('instance ',events)
        self.assertEqual(chap,'legacy account remains\n')

    def test_pptp_client_only_reloads_and_starts_short_netifd_interface(self):
        events,status,chap,mounted=self.exercise(pptp_client=True)
        self.assertEqual(status,0);self.assertFalse(mounted);self.assertNotIn('instance ',events)
        self.assertIn('network call network reload',events)
        self.assertIn('network call network.interface.mp716pptp up',events)
        self.assertEqual(chap,'legacy account remains\n')

    def test_l2tp_client_waits_for_its_control_fifo(self):
        events,status,chap,mounted=self.exercise(l2tp_client=True)
        self.assertEqual(status,0);self.assertFalse(mounted)
        self.assertIn('instance l2tp',events)
        self.assertLess(events.index('instance l2tp'),events.index('network call network.interface.mp716l2tp up'))

    def test_missing_l2tp_control_fifo_does_not_start_netifd_client(self):
        events,status,chap,mounted=self.exercise(l2tp_client=True,fifo_ready=False)
        self.assertEqual(status,0);self.assertNotIn('network call network.interface.mp716l2tp up',events)

if __name__=='__main__':unittest.main()
