import importlib.util,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('native_services',ROOT/'scripts/prepare-native-services.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NativeServiceBuildTests(unittest.TestCase):
 def fixture(self):
  self.tmp=tempfile.TemporaryDirectory(dir=ROOT/'build');self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name)
  (root/'include').mkdir();(root/'package').mkdir()
  (root/'include/rootfs.mk').write_text('if ! echo " $(3) "; then $$script enable; else $$script disable; fi')
  for name,call in m.CALLS.items():(root/name).write_text(call+'\n')
  return root
 def test_only_image_delivery_calls_change_and_operation_is_idempotent(self):
  root=self.fixture();original=(root/'include/rootfs.mk').read_bytes();m.prepare(root);m.prepare(root)
  for name in m.CALLS:self.assertIn(',$(MP716_DISABLED_SERVICES))',(root/name).read_text())
  self.assertEqual(original,(root/'include/rootfs.mk').read_bytes())
 def test_unexpected_pinned_call_fails_before_any_file_is_changed(self):
  root=self.fixture();original=(root/'package/Makefile').read_bytes();(root/'include/image.mk').write_text('unexpected')
  with self.assertRaises(ValueError):m.prepare(root)
  self.assertEqual(original,(root/'package/Makefile').read_bytes())
