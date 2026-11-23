"""Compile and exercise DHCP packet parsing without opening a socket."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]

class DhcpProbeTests(unittest.TestCase):
    def test_discover_only_and_untrusted_offer_packets(self):
        cc=os.environ.get('CC') or shutil.which('clang') or shutil.which('gcc')
        if not cc and Path(r'C:\Program Files\LLVM\bin\clang.exe').exists():
            cc=r'C:\Program Files\LLVM\bin\clang.exe'
        if not cc:self.skipTest('No host C compiler')
        with tempfile.TemporaryDirectory() as temporary:
            binary=Path(temporary)/('dhcp-probe-test.exe' if os.name=='nt' else 'dhcp-probe-test')
            subprocess.run([cc,'-std=c99','-Wall','-Wextra','-Werror',str(ROOT/'tests/native/dhcp-probe-test.c'),'-o',str(binary)],check=True,capture_output=True)
            result=subprocess.run([str(binary)],capture_output=True,text=True,check=True)
            self.assertIn('"packet_cases":18',result.stdout)
            self.assertIn('"network_io":false',result.stdout)

if __name__=='__main__':unittest.main()
