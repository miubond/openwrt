"""Exercise the real worker startup protocol with probes replaced, no network I/O."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

PROJECT=Path(__file__).resolve().parents[2]
BASH=shutil.which('bash') or (r'D:\Program Files\Git\bin\bash.exe' if os.name=='nt' else None)
def shell_path(path):
    value=path.resolve().as_posix()
    return '/'+value[0].lower()+value[2:] if len(value)>1 and value[1]==':' else value

@unittest.skipUnless(BASH and Path(BASH).is_file(),'bash not available')
class DiagnosticWorkerTests(unittest.TestCase):
    def setUp(self):
        parent=PROJECT/'build/diagnostic-worker-fixtures';parent.mkdir(parents=True,exist_ok=True)
        self.temporary=tempfile.TemporaryDirectory(dir=parent);self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);self.stage=self.root/'stage';self.stage.mkdir()
        self.events=self.root/'events';self.events.write_text('')
        busybox=self.root/'busybox';busybox.write_text('''#!/bin/bash
set -eu
command=$1; shift
case "$command" in
 sleep) sleep 0.05 ;;
 timeout) shift; exec "$@" ;;
 ping) printf 'probe\n' >> "$EVENTS"; printf 'fixture pong\n' ;;
 *) exit 2 ;;
esac
''',newline='\n');busybox.chmod(0o755)
        body=(PROJECT/'integration/ram-web/diagnostic-worker.sh').read_text()
        body=body.replace('/tmp/mp716-diagnostics/*',shell_path(self.root)+'/*').replace('/bin/busybox',shell_path(busybox))
        self.worker=self.root/'worker.sh';self.worker.write_text(body,newline='\n')
    def launch(self,asynchronous=True,stage=None):
        env={**os.environ,'EVENTS':shell_path(self.events),'MP716_DIAG_ASYNC':'1' if asynchronous else '0'}
        return subprocess.Popen([BASH,shell_path(self.worker),shell_path(stage or self.stage),'ping','127.0.0.1','1',''],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    def ready(self,process):
        deadline=time.monotonic()+3
        while time.monotonic()<deadline and not (self.stage/'ready').exists():
            if process.poll() is not None:break
            time.sleep(0.01)
        self.assertTrue((self.stage/'ready').exists(),'Worker did not announce its real PID')
        self.assertGreater(int((self.stage/'ready').read_text()),1)
    def test_async_does_not_probe_before_controller_authorization(self):
        process=self.launch()
        try:
            self.ready(process);self.assertEqual(self.events.read_text(),'')
            (self.stage/'authorized').write_text('1\n')
            stdout,stderr=process.communicate(timeout=5)
            self.assertEqual(process.returncode,0,stderr.decode());self.assertEqual((self.stage/'exit').read_text().strip(),'0')
            self.assertEqual(self.events.read_text().strip(),'probe');self.assertIn('fixture pong',(self.stage/'output').read_text())
        finally:
            if process.poll() is None:process.kill();process.communicate()
    def test_missing_authorization_exits_without_any_probe(self):
        process=self.launch();stdout,stderr=process.communicate(timeout=5)
        self.assertEqual(process.returncode,1,stderr.decode());self.assertEqual(self.events.read_text(),'')
        self.assertEqual((self.stage/'exit').read_text().strip(),'1')
    def test_synchronous_worker_can_complete_without_async_ticket(self):
        process=self.launch(False);stdout,stderr=process.communicate(timeout=5)
        self.assertEqual(process.returncode,0,stderr.decode());self.assertFalse((self.stage/'ready').exists())
        self.assertEqual(self.events.read_text().strip(),'probe')
    def test_stage_outside_private_root_is_rejected(self):
        process=self.launch(stage=PROJECT/'build');stdout,stderr=process.communicate(timeout=5)
        self.assertEqual(process.returncode,2,stderr.decode());self.assertEqual(self.events.read_text(),'')

if __name__=='__main__':unittest.main()
