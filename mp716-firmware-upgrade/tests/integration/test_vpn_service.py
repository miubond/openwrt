"""Run the real pinned JSON parser; stub only service/network/mount effects."""
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
BOOL_FIELDS = ('pptp', 'l2tp', 'ipsec', 'openvpn', 'pptpClient', 'l2tpClient', 'chap')


def jsonfilter_tool():
    configured = os.environ.get('JSONFILTER')
    if configured:
        return shutil.which(configured) or (configured if Path(configured).is_file() else None)
    found = shutil.which('jsonfilter')
    if found:
        return found
    for path in (ROOT/'build/jsonfilter-host/jsonfilter.exe', ROOT/'build/host-tools/jsonfilter'):
        if path.is_file():
            return str(path)
    return None


def shell_path(path):
    value=Path(path).resolve().as_posix()
    return '/'+value[0].lower()+value[2:] if len(value)>1 and value[1]==':' else value


def plan(**changes):
    return {**{name:False for name in BOOL_FIELDS}, 'guard':'', **changes}


class VpnServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.jsonfilter = jsonfilter_tool()
        strict = os.environ.get('CI','').lower() == 'true' or os.environ.get('MP716_REQUIRE_JSONFILTER') == '1'
        if not BASH or not Path(BASH).is_file() or not cls.jsonfilter:
            message='Real jsonfilter and bash are required; set JSONFILTER (see tests/README-jsonfilter.md)'
            if strict:
                raise RuntimeError(message)
            raise unittest.SkipTest(message)

    def exercise(self, enabled=False, guard='', reject_guard=False, mount_fail=False,
                 pptp_client=False, l2tp_client=False, fifo_ready=True, old_raw=None,
                 new_raw=None, action='start', sentinels=False, fail_field='', parser_failure=False, render_missing=False,
                 value_failure=False, read_failure=False,
                 legacy_selector=False, legacy_guard_separator=False, existing_guard=False):
        parent=ROOT/'build/vpn-service-fixtures';parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            root=Path(temporary);(root/'runtime').mkdir();(root/'chap-secrets').write_text('legacy account remains\n')
            script=SOURCE.read_text().replace('/usr/bin/ucode','mock_ucode').replace('/bin/ubus','mock_ubus').replace('/etc/init.d/firewall','mock_firewall')
            if legacy_guard_separator:
                self.assertEqual(script.count('drop; }\\n}\\n'),1)
                script=script.replace('drop; }\\n}\\n','drop; } }\\n')
            if legacy_selector:
                self.assertEqual(script.count('"@.$1"'),2,'The temporary mutation must target both actual field selectors')
                script=script.replace('"@.$1"','"@$1"')
            script=script.replace('/usr/bin/jsonfilter','real_jsonfilter')
            script=script.replace('/etc/ppp/chap-secrets',shell_path(root/'chap-secrets'))
            script=script.replace('/var/run/xl2tpd',shell_path(root/'xl2tpd'))
            (root/'xl2tpd').mkdir()
            fifo=root/'xl2tpd/l2tp-control'
            if fifo_ready:
                if os.name=='nt':
                    fifo.write_text('')
                    script=script.replace('[ ! -p ', '[ ! -f ')
                else:os.mkfifo(fifo,0o600)
            (root/'service.sh').write_text(script,newline='\n')
            generated=plan(pptp=enabled,l2tp=enabled or l2tp_client,ipsec=enabled,openvpn=enabled,
                           pptpClient=pptp_client,l2tpClient=l2tp_client,chap=enabled,guard=guard)
            (root/'new-plan.json').write_bytes(new_raw if isinstance(new_raw,bytes) else
                                              (new_raw if new_raw is not None else json.dumps(generated)).encode())
            old_bytes=old_raw if isinstance(old_raw,bytes) else old_raw.encode() if old_raw is not None else None
            if old_bytes is not None:
                (root/'runtime/services.json').write_bytes(old_bytes)
            protected={}
            if sentinels:
                for name,raw in {'chap-target':shell_path(root/'chap-secrets')+'\n',
                                 'chap-original':'preserved original secret file\n',
                                 'guard.nft':'preserved IPsec deny guard\n'}.items():
                    (root/'runtime'/name).write_text(raw,newline='\n');protected[name]=raw
            harness=r"""
set -eu
source "$STAGE/service.sh"
runtime="$STAGE/runtime"
events="$STAGE/events"
touch "$events"; printf 'managed credentials\n' > "$runtime/chap-secrets"
[ -f "$runtime/guard.nft" ] || printf 'table inet mp716_vpn_guard {}\n' > "$runtime/guard.nft"
real_jsonfilter() {
 local selector
 selector=${!#}
 if [ "$PARSER_FAILURE" = 1 ] || { [ -n "$FAIL_FIELD" ] && [ "$selector" = "@.$FAIL_FIELD" ]; }; then
  printf 'false\n'; return 77
 fi
 # Windows' host build uses a stdio-only LF shim; parser/main are unchanged.
 # Do not pipe/filter stdout: that would alter CR data or hide parser failure.
 if [ "$VALUE_FAILURE" = 1 ] && [ "$selector" = '@.chap' ]; then
  "$REAL_JSONFILTER" "$@" || return "$?"
  return 77
 fi
 "$REAL_JSONFILTER" "$@"
}
cat() {
 if [ "$READ_FAILURE" = 1 ] && [ "$#" = 1 ] && [ "$1" = "$runtime/services.json" ]; then return 74; fi
 command cat "$@"
}
mock_ucode() {
 printf 'render\n' >> "$events"
 if [ "$RENDER_MISSING" = 1 ]; then rm -f "$runtime/services.json"; else cp "$STAGE/new-plan.json" "$runtime/services.json"; fi
}
mock_ubus() { printf 'network %s\n' "$*" >> "$events"; }
mock_firewall() { printf 'firewall\n' >> "$events"; }
sleep() { :; }
mount() { printf 'mount %s\n' "$*" >> "$events"; [ "$MOUNT_FAIL" != 1 ]; }
umount() { printf 'umount %s\n' "$*" >> "$events"; }
nft() {
 printf 'nft %s\n' "$*" >> "$events"
 case "$1" in list) [ "$EXISTING_GUARD" = 1 ]; return "$?" ;; esac
 if [ "$1" = -f ]; then cp "$2" "$STAGE/nft-input-$(basename "$2")"; fi
 if [ "$REJECT_GUARD" = 1 ] && [ "${2:-}" = "$runtime/guard-apply.nft" ]; then return 1; fi
}
logger() { :; }
procd_open_instance() { printf 'instance %s\n' "$1" >> "$events"; }
procd_set_param() { printf 'procd %s\n' "$*" >> "$events"; }
procd_close_instance() { :; }
status=0
if [ "$ACTION" = read ]; then
 read_service_plan || status=$?
 if [ "$status" = 0 ]; then
  printf '%s\n' "pptp=$plan_pptp" "l2tp=$plan_l2tp" "ipsec=$plan_ipsec" "openvpn=$plan_openvpn" \
   "pptpClient=$plan_pptp_client" "l2tpClient=$plan_l2tp_client" "chap=$plan_chap" "guard=$plan_guard" > "$STAGE/parsed"
 fi
else
 start_service || status=$?
fi
wait
printf '%s\n' "$status" > "$STAGE/status"
"""
            env={**os.environ,'STAGE':shell_path(root),'REAL_JSONFILTER':shell_path(self.jsonfilter),
                 'ACTION':action,
                 'REJECT_GUARD':'1' if reject_guard else '0','MOUNT_FAIL':'1' if mount_fail else '0',
                 'FAIL_FIELD':fail_field,'PARSER_FAILURE':'1' if parser_failure else '0',
                 'VALUE_FAILURE':'1' if value_failure else '0','READ_FAILURE':'1' if read_failure else '0',
                 'EXISTING_GUARD':'1' if existing_guard else '0',
                 'RENDER_MISSING':'1' if render_missing else '0'}
            result=subprocess.run([BASH,'-c',harness],env=env,text=True,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            parsed=dict(line.split('=',1) for line in (root/'parsed').read_text().splitlines()) if (root/'parsed').exists() else None
            return {'events':(root/'events').read_text(),'status':int((root/'status').read_text()),
                    'chap':(root/'chap-secrets').read_text(),'mounted':(root/'runtime/chap-target').exists(),
                    'parsed':parsed,'stderr':result.stderr,
                    'nft_inputs':{path.name.removeprefix('nft-input-'):path.read_text() for path in root.glob('nft-input-*')},
                    'old_plan_unchanged':old_bytes is not None and (root/'runtime/services.json').is_file() and (root/'runtime/services.json').read_bytes()==old_bytes,
                    'protected_equal':all((root/'runtime'/name).is_file() and (root/'runtime'/name).read_text()==raw for name,raw in protected.items())}

    def assert_no_service_effects(self,result):
        self.assertNotEqual(result['status'],0)
        self.assertTrue(result['protected_equal'])
        self.assertEqual(result['chap'],'legacy account remains\n')
        for event in ['nft ','mount ','umount ','instance ','procd ','network ','firewall\n']:
            self.assertNotIn(event,result['events'])

    def test_all_eight_fields_use_the_real_parser_including_false_and_empty_guard(self):
        original=plan()
        result=self.exercise(old_raw=json.dumps(original),action='read')
        self.assertEqual(result['status'],0,result['stderr'])
        self.assertEqual(result['parsed'],{**{name:'false' for name in BOOL_FIELDS},'guard':''})
        for field in BOOL_FIELDS:
            with self.subTest(field=field):
                result=self.exercise(old_raw=json.dumps(plan(**{field:True})),action='read')
                self.assertEqual(result['status'],0,result['stderr']);self.assertEqual(result['parsed'][field],'true')
        for guard in ['input','output']:
            result=self.exercise(old_raw=json.dumps(plan(guard=guard)),action='read')
            self.assertEqual(result['status'],0,result['stderr']);self.assertEqual(result['parsed']['guard'],guard)

    def test_disabled_first_boot_needs_no_old_plan_and_launches_no_instances(self):
        result=self.exercise()
        self.assertEqual(result['status'],0,result['stderr']);self.assertFalse(result['mounted'])
        for text in ['instance ','mount ','network ','firewall\n']:self.assertNotIn(text,result['events'])
        self.assertEqual(result['chap'],'legacy account remains\n')

    def test_real_parser_enabled_plan_preserves_secrets_and_registers_procd_commands(self):
        result=self.exercise(True,'input')
        self.assertEqual(result['status'],0,result['stderr']);self.assertTrue(result['mounted'])
        self.assertEqual(result['chap'],'legacy account remains\n')
        for name in ['pptp','l2tp','ipsec','openvpn']:self.assertIn('instance '+name,result['events'])
        self.assertLess(result['events'].index('guard-deny.nft'),result['events'].index('instance pptp'))
        self.assertIn('STRONGSWAN_CONF=',result['events'])

    def test_temporary_legacy_selector_mutation_is_caught_by_the_enabled_positive_plan(self):
        result=self.exercise(True,'input',legacy_selector=True)
        self.assert_no_service_effects(result)
        self.assertIn('render\n',result['events'])
        self.assertIn('Syntax error',result['stderr'])
        self.assertIn('@pptp',result['stderr'])

    def test_missing_xfrm_fails_closed_before_starting_any_service(self):
        result=self.exercise(True,'input',reject_guard=True)
        self.assertNotEqual(result['status'],0);self.assertIn('guard-deny.nft',result['events'])
        self.assertNotIn('instance ',result['events']);self.assertFalse(result['mounted'])

    def test_actual_deny_input_separates_nested_chain_and_table_before_full_guard(self):
        for hook in ('input','output'):
            for existing in (False,True):
                with self.subTest(hook=hook,existing=existing):
                    result=self.exercise(True,hook,existing_guard=existing)
                    self.assertEqual(result['status'],0,result['stderr'])
                    deny=result['nft_inputs']['guard-deny.nft']
                    prefix='delete table inet mp716_vpn_guard\n' if existing else ''
                    self.assertEqual(deny,prefix+'table inet mp716_vpn_guard { chain '+hook+
                        ' { type filter hook '+hook+' priority -5; policy accept; udp dport 1701 drop; }\n}\n')
                    self.assertNotRegex(deny,r'}[ \t]+}')
                    self.assertEqual(result['nft_inputs']['guard-apply.nft'],
                        'delete table inet mp716_vpn_guard\ntable inet mp716_vpn_guard {}\n')
                    self.assertLess(result['events'].index('guard-deny.nft'),result['events'].index('guard-apply.nft'))
                    self.assertLess(result['events'].index('guard-apply.nft'),result['events'].index('mount '))

    def test_temporary_old_separator_mutation_reproduces_the_actual_bad_nft_input(self):
        result=self.exercise(True,'input',legacy_guard_separator=True)
        self.assertRegex(result['nft_inputs']['guard-deny.nft'],r'drop; }[ \t]+}\n$')

    def test_mount_failure_does_not_mark_secrets_as_mounted(self):
        result=self.exercise(True,mount_fail=True)
        self.assertNotEqual(result['status'],0);self.assertFalse(result['mounted'])
        self.assertNotIn('instance ',result['events']);self.assertEqual(result['chap'],'legacy account remains\n')

    def test_pptp_client_only_reloads_and_starts_short_netifd_interface(self):
        result=self.exercise(pptp_client=True)
        self.assertEqual(result['status'],0,result['stderr']);self.assertFalse(result['mounted'])
        self.assertNotIn('instance ',result['events']);self.assertIn('network call network.interface.mp716pptp up',result['events'])

    def test_l2tp_client_waits_for_its_control_fifo(self):
        result=self.exercise(l2tp_client=True)
        self.assertEqual(result['status'],0,result['stderr']);self.assertFalse(result['mounted'])
        self.assertLess(result['events'].index('instance l2tp'),result['events'].index('network call network.interface.mp716l2tp up'))

    def test_missing_l2tp_control_fifo_does_not_start_netifd_client(self):
        result=self.exercise(l2tp_client=True,fifo_ready=False)
        self.assertEqual(result['status'],0,result['stderr'])
        self.assertNotIn('network call network.interface.mp716l2tp up',result['events'])

    def test_valid_previous_active_plan_reloads_when_new_plan_is_disabled(self):
        result=self.exercise(old_raw=json.dumps(plan(pptpClient=True)))
        self.assertEqual(result['status'],0,result['stderr']);self.assertIn('network call network reload',result['events'])
        self.assertNotIn('instance ',result['events'])

    def test_valid_disabled_plan_removes_old_guard_and_chap_mount_without_touching_original_secret(self):
        result=self.exercise(old_raw=json.dumps(plan(pptp=True,chap=True,guard='input')),sentinels=True)
        self.assertEqual(result['status'],0,result['stderr'])
        self.assertIn('nft delete table inet mp716_vpn_guard',result['events'])
        self.assertIn('umount ',result['events']);self.assertFalse(result['mounted'])
        self.assertEqual(result['chap'],'legacy account remains\n')
        self.assertIn('network call network reload',result['events'])
        self.assertNotIn('instance ',result['events'])

    def test_malformed_or_nonobject_existing_plan_never_renders_or_changes_guard_chap(self):
        valid=json.dumps(plan())
        bad=['', '{', '[]', 'null', 'true', valid+'TRAILING', valid+'\n'+valid, valid+'\nnull',
             valid+'\x00TRAILING', valid[:-1]+',"guard\\u0000extra":"input"}',
             json.dumps(plan(chap='false')), json.dumps(plan(guard='input\n'))]
        for raw in bad:
            with self.subTest(raw=repr(raw)):
                result=self.exercise(old_raw=raw,sentinels=True)
                self.assert_no_service_effects(result);self.assertNotIn('render\n',result['events'])
                self.assertTrue(result['old_plan_unchanged'])

    def test_missing_fields_in_old_or_rendered_plan_leave_guard_and_chap_untouched(self):
        for field in BOOL_FIELDS+('guard',):
            value=plan();value.pop(field)
            for previous in [True,False]:
                with self.subTest(field=field,previous=previous):
                    result=self.exercise(old_raw=json.dumps(value) if previous else json.dumps(plan()),
                                         new_raw=None if previous else json.dumps(value),sentinels=True)
                    self.assert_no_service_effects(result)
                    self.assertEqual('render\n' in result['events'],not previous)

    def test_wrong_boolean_types_never_disable_guard_or_unmount_chap(self):
        for field in BOOL_FIELDS:
            for value in ['true','false',0,1,None,[],{}]:
                with self.subTest(field=field,value=value):
                    result=self.exercise(new_raw=json.dumps(plan(**{field:value})),sentinels=True)
                    self.assert_no_service_effects(result)

    def test_guard_wrong_types_nul_and_whitespace_are_rejected(self):
        for value in [None,False,0,[],{},'bad','\n','input\n','output\n\n','input\r','\rinput','input\t',' input','input ','input\x00bad','\x00']:
            with self.subTest(value=repr(value)):
                result=self.exercise(new_raw=json.dumps(plan(guard=value)),sentinels=True)
                self.assert_no_service_effects(result)

    def test_malformed_new_plan_is_rejected_before_any_guard_or_chap_change(self):
        for raw in ['{',json.dumps(plan())+'TRAILING',json.dumps(plan())+'\nnull']:
            result=self.exercise(new_raw=raw,sentinels=True)
            self.assert_no_service_effects(result);self.assertIn('render\n',result['events'])

    def test_renderer_success_without_a_plan_is_not_treated_as_disabled(self):
        result=self.exercise(render_missing=True,sentinels=True)
        self.assert_no_service_effects(result);self.assertIn('render\n',result['events'])

    def test_real_parser_failure_even_with_false_output_is_not_treated_as_disabled(self):
        result=self.exercise(old_raw=json.dumps(plan()),parser_failure=True,sentinels=True)
        self.assert_no_service_effects(result);self.assertNotIn('render\n',result['events'])
        for field in ['chap','guard']:
            result=self.exercise(fail_field=field,sentinels=True)
            self.assert_no_service_effects(result);self.assertIn('render\n',result['events'])
        result=self.exercise(value_failure=True,sentinels=True)
        self.assert_no_service_effects(result);self.assertIn('render\n',result['events'])
        result=self.exercise(old_raw=json.dumps(plan()),read_failure=True,sentinels=True)
        self.assert_no_service_effects(result);self.assertNotIn('render\n',result['events'])
        self.assertTrue(result['old_plan_unchanged'])


if __name__=='__main__':unittest.main()
